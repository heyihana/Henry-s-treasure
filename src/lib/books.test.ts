import { describe, expect, it } from 'vitest';
import { runBacktest, volTargetPositions } from './backtest/engine';
import { expectedMaxSharpe, normCdf, normInv, probabilisticSharpe } from './backtest/metrics';
import { DEFAULT_CONFIG, type BacktestConfig } from './backtest/types';
import { DEMO_SPECS, generateDemoBars, getDemoBars } from './data/demo';
import { regressionMomentum } from './indicators';
import { runOptimize } from './optimize';
import { DEFAULT_ROTATION, runRotation } from './portfolio';
import { carverEwmac, clenowMomentum, mrMarket } from './strategies/books';
import { defaultParams } from './strategies/types';
import type { Bar } from './types';

const noCost: BacktestConfig = {
  ...DEFAULT_CONFIG,
  commissionRate: 0,
  minCommission: 0,
  stampTaxRate: 0,
  slippage: 0,
  lotSize: 1,
  tPlusOne: false,
  limitCheck: false,
  riskFreeRate: 0,
};

describe('statistics', () => {
  it('normal cdf / inverse', () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 6);
    expect(normCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normInv(0.975)).toBeCloseTo(1.96, 2);
    expect(normInv(0.01)).toBeCloseTo(-2.326, 2);
  });

  it('PSR rises with sample length and DSR threshold rises with trials', () => {
    const short = probabilisticSharpe(0.05, 0, 100, 0, 3);
    const long = probabilisticSharpe(0.05, 0, 2000, 0, 3);
    expect(long).toBeGreaterThan(short);
    expect(expectedMaxSharpe(0.001, 1000)).toBeGreaterThan(expectedMaxSharpe(0.001, 10));
  });
});

describe('engine extensions', () => {
  const bars: Bar[] = Array.from({ length: 30 }, (_, i) => ({ date: `2024-02-${String(i + 1).padStart(2, '0')}`, open: 10, high: 10.1, low: 9.9, close: 10, volume: 1 }));

  it('time barrier exits after maxHoldBars and waits for signal reset', () => {
    const res = runBacktest(bars, bars.map(() => 1), { ...noCost, maxHoldBars: 5 });
    const sells = res.fills.filter((f) => f.side === 'sell');
    expect(sells[0].reason).toBe('timeExit');
    expect(sells[0].index - res.fills[0].index).toBe(5);
    expect(res.fills.filter((f) => f.side === 'buy')).toHaveLength(1);
  });

  it('vol targeting scales down volatile assets', () => {
    const demo = getDemoBars('DEMO01');
    const pos = volTargetPositions(demo, demo.map(() => 1), 0.1, 20, 252);
    const tail = pos.slice(100);
    expect(Math.max(...tail)).toBeLessThanOrEqual(1);
    expect(tail.reduce((a, b) => a + b, 0) / tail.length).toBeLessThan(0.7);
    for (const x of tail) expect(Math.round(x * 10)).toBeCloseTo(x * 10, 6);
    const r = runBacktest(demo, demo.map(() => 1), { ...DEFAULT_CONFIG, volTarget: 0.15 });
    const full = runBacktest(demo, demo.map(() => 1), DEFAULT_CONFIG);
    expect(r.metrics.annualVolatility).toBeLessThan(full.metrics.annualVolatility);
  });

  it('kelly / merton / psr reported', () => {
    const demo = getDemoBars('DEMO01');
    const r = runBacktest(demo, carverEwmac.run(demo, defaultParams(carverEwmac)).position, DEFAULT_CONFIG);
    expect(r.metrics.psr).toBeGreaterThanOrEqual(0);
    expect(r.metrics.psr).toBeLessThanOrEqual(1);
    expect(Number.isFinite(r.metrics.kelly)).toBe(true);
    expect(Number.isFinite(r.metrics.merton)).toBe(true);
    expect(r.metrics.kurtosis).toBeGreaterThan(0);
  });
});

describe('book strategies', () => {
  const demo = getDemoBars('DEMO01');
  it('regression momentum: steady exponential growth scores higher than noisy', () => {
    const smooth = Array.from({ length: 120 }, (_, i) => 10 * Math.exp(0.002 * i));
    const noisy = smooth.map((x, i) => x * (1 + (i % 2 ? 0.05 : -0.05)));
    const a = regressionMomentum(smooth, 90).at(-1)!;
    const b = regressionMomentum(noisy, 90).at(-1)!;
    expect(a).toBeCloseTo((Math.exp(0.002 * 252) - 1) * 100, 1);
    expect(a).toBeGreaterThan(b);
  });

  for (const s of [carverEwmac, clenowMomentum, mrMarket]) {
    it(`${s.name} valid positions`, () => {
      const out = s.run(demo, defaultParams(s));
      expect(out.position).toHaveLength(demo.length);
      for (const p of out.position) {
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThanOrEqual(1);
      }
      expect(out.position.some((p) => p > 0)).toBe(true);
    });
  }

  it('EWMAC uses graded positions', () => {
    const out = carverEwmac.run(demo, defaultParams(carverEwmac));
    const levels = new Set(out.position);
    expect(levels.size).toBeGreaterThan(2);
  });

  it('mr market adds on drawdowns', () => {
    const out = mrMarket.run(demo, defaultParams(mrMarket));
    expect(Math.max(...out.position)).toBe(1);
    expect(Math.min(...out.position)).toBeCloseTo(0.4);
  });
});

describe('optimizer & rotation extensions', () => {
  it('deflated sharpe reported', () => {
    const res = runOptimize({
      spec: { type: 'builtin', id: 'ma_cross' },
      bars: getDemoBars('DEMO01'),
      baseParams: { fast: 5, slow: 20, maType: 0 },
      axes: [
        { key: 'fast', from: 2, to: 20, step: 2 },
        { key: 'slow', from: 20, to: 120, step: 20 },
      ],
      config: DEFAULT_CONFIG,
      period: 'day',
      range: {},
      splitRatio: 0,
      objective: 'sharpe',
      minTrades: 0,
    });
    expect(res.deflated).toBeDefined();
    expect(res.deflated!.dsr).toBeLessThanOrEqual(res.deflated!.psr);
    expect(res.deflated!.luckSharpe).toBeGreaterThan(0);
  });

  it('safe asset receives unused weight; clenow scoring works', () => {
    const assets = DEMO_SPECS.slice(0, 4).map((s) => ({ meta: s.meta, bars: generateDemoBars(s) }));
    const res = runRotation(assets, { ...DEFAULT_ROTATION, safeAsset: 'DEMO04', scoring: 'clenow', absoluteMomentum: true });
    for (let i = 5; i < res.dates.length; i++) {
      const w = Object.values(res.weights).reduce((s, arr) => s + arr[i], 0);
      expect(w).toBeGreaterThan(0.9);
    }
    for (const r of res.rebalances) expect(r.scores.some((s) => s.code === 'DEMO04')).toBe(false);
  });
});

import { dcf, impliedGrowth, kellyFraction, mertonShare, qualityChecklist, retainedTest } from './valuation';

describe('valuation tools', () => {
  it('dcf with zero growth equals perpetuity', () => {
    const r = dcf({ ownerEarnings: 10, growth: 0, years: 10, terminalGrowth: 0, discount: 0.1 });
    expect(r.value).toBeCloseTo(100, 6);
  });
  it('implied growth inverts dcf', () => {
    const base = { ownerEarnings: 5, years: 10, terminalGrowth: 0.03, discount: 0.09 };
    const v = dcf({ ...base, growth: 0.12 }).value;
    expect(impliedGrowth(v, base)).toBeCloseTo(0.12, 4);
  });
  it('merton share example from The Missing Billionaires review', () => {
    expect(mertonShare(0.05, 0, 0.2, 2)).toBeCloseTo(0.625, 6);
    expect(kellyFraction(0.6, 1)).toBeCloseTo(0.2, 6);
    expect(retainedTest(100, 160, 40)).toBeCloseTo(1.5);
  });
  it('quality checklist scores only judged items', () => {
    const q = qualityChecklist({ roe: 0.2, grossMargin: 0.5, debtRatio: 0.3, fcfConversion: NaN, profitYears: 10, pe: 30, understand: true, integrity: true });
    expect(q.items.find((i) => i.key === 'fcf')!.pass).toBeNull();
    expect(q.score).toBe(86);
  });
});
