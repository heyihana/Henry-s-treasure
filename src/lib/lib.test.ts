import { describe, expect, it } from 'vitest';
import * as ta from './indicators';
import { runBacktest } from './backtest/engine';
import { DEFAULT_CONFIG, type BacktestConfig } from './backtest/types';
import { maxDrawdownInfo, periodReturns, sharpeRatio } from './backtest/metrics';
import { backtestStrategy, rangeToIndex } from './backtest/run';
import { BUILTIN_STRATEGIES, defaultParams, resolveStrategy } from './strategies';
import { runRules, SAMPLE_RULES } from './strategies/rules';
import { CODE_TEMPLATE, parseCodeParams, runCode } from './strategies/code';
import { runOptimize } from './optimize';
import { monteCarlo } from './montecarlo';
import { runRotation, DEFAULT_ROTATION } from './portfolio';
import { diagnose, stockStats } from './analysis';
import { DEMO_SPECS, generateDemoBars, getDemoBars } from './data/demo';
import { parseCsv } from './data/csv';
import { guessSecid, parseEastmoneyKlines, parseSuggest } from './data/eastmoney';
import { parseTencentKlines, secidToTencent } from './data/tencent';
import type { Bar } from './types';

const close = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19];

function mkBars(closes: number[], opts: Partial<Bar> = {}): Bar[] {
  return closes.map((c, i) => ({
    date: `2024-01-${String(i + 1).padStart(2, '0')}`,
    open: c,
    high: c * 1.01,
    low: c * 0.99,
    close: c,
    volume: 1000,
    ...opts,
  }));
}

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

describe('indicators', () => {
  it('sma', () => {
    const s = ta.sma(close, 3);
    expect(s[0]).toBeNaN();
    expect(s[1]).toBeNaN();
    expect(s[2]).toBeCloseTo(11);
    expect(s[9]).toBeCloseTo(18);
  });

  it('ema seeds with first value', () => {
    const e = ta.ema([1, 2, 3], 3);
    expect(e[0]).toBe(1);
    expect(e[1]).toBeCloseTo(1.5);
    expect(e[2]).toBeCloseTo(2.25);
  });

  it('rsi is 100 for monotonic rise and in range', () => {
    const r = ta.rsi(close, 5);
    expect(r[9]).toBeCloseTo(100);
    const bars = getDemoBars('DEMO02');
    const r2 = ta.rsi(bars.map((b) => b.close), 14);
    for (const v of r2.slice(20)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });

  it('macd hist = 2*(dif-dea)', () => {
    const m = ta.macd(close);
    expect(m.hist[5]).toBeCloseTo(2 * (m.dif[5] - m.dea[5]));
  });

  it('boll bands around mid', () => {
    const b = ta.boll(close, 5, 2);
    expect(b.upper[9]).toBeGreaterThan(b.mid[9]);
    expect(b.lower[9]).toBeLessThan(b.mid[9]);
    expect(b.mid[9]).toBeCloseTo(17);
  });

  it('kdj K/D within 0..100', () => {
    const bars = getDemoBars('DEMO01');
    const c = ta.columns(bars);
    const k = ta.kdj(c.high, c.low, c.close);
    for (let i = 10; i < bars.length; i++) {
      expect(k.k[i]).toBeGreaterThanOrEqual(0);
      expect(k.k[i]).toBeLessThanOrEqual(100);
    }
  });

  it('highest / lowest / ref / cross', () => {
    expect(ta.highest([1, 3, 2, 5, 4], 2)).toEqual([NaN, 3, 3, 5, 5]);
    expect(ta.lowest([1, 3, 2, 5, 4], 2)).toEqual([NaN, 1, 2, 2, 4]);
    expect(ta.ref([1, 2, 3], 1)).toEqual([NaN, 1, 2]);
    expect(ta.crossOver([1, 3], [2, 2], 1)).toBe(true);
    expect(ta.crossUnder([3, 1], [2, 2], 1)).toBe(true);
  });

  it('atr and supertrend produce finite values', () => {
    const c = ta.columns(getDemoBars('DEMO03'));
    const a = ta.atr(c.high, c.low, c.close, 14);
    expect(a[12]).toBeNaN();
    expect(a[100]).toBeGreaterThan(0);
    const st = ta.superTrend(c.high, c.low, c.close, 10, 3);
    expect([1, -1]).toContain(st.direction[200]);
  });
});

describe('backtest engine', () => {
  it('buy & hold without costs matches price return (next open)', () => {
    const bars = mkBars(close);
    const res = runBacktest(bars, bars.map(() => 1), noCost);
    // 第 0 根收盘信号，第 1 根开盘(11)买入，最后收盘 19
    const sh = Math.floor(100000 / 11);
    expect(res.metrics.finalEquity).toBeCloseTo(sh * 19 + (100000 - sh * 11), 6);
    expect(res.fills).toHaveLength(1);
    expect(res.fills[0].price).toBe(11);
    expect(res.trades[0].open).toBe(true);
  });

  it('close execution buys at signal bar close', () => {
    const bars = mkBars(close);
    const res = runBacktest(bars, bars.map(() => 1), { ...noCost, execution: 'close' });
    expect(res.fills[0].price).toBe(10);
    expect(res.metrics.totalReturn).toBeCloseTo(0.9, 5);
  });

  it('respects lot size and fees', () => {
    const bars = mkBars([10, 10, 10, 10]);
    const cfg: BacktestConfig = { ...noCost, lotSize: 100, commissionRate: 0.001, minCommission: 5, initialCapital: 10555 };
    const res = runBacktest(bars, [1, 1, 1, 1], cfg);
    expect(res.fills[0].shares % 100).toBe(0);
    expect(res.fills[0].shares).toBe(1000);
    expect(res.fills[0].fee).toBeCloseTo(10);
  });

  it('charges stamp tax only on sell for A-share preset', () => {
    const bars = mkBars([10, 10, 10, 10, 10]);
    const cfg: BacktestConfig = { ...noCost, stampTaxRate: 0.001, lotSize: 100 };
    const res = runBacktest(bars, [1, 0, 0, 0, 0], cfg);
    const buy = res.fills.find((f) => f.side === 'buy')!;
    const sell = res.fills.find((f) => f.side === 'sell')!;
    expect(buy.fee).toBe(0);
    expect(sell.fee).toBeCloseTo(sell.value * 0.001);
    expect(res.trades[0].pnl).toBeCloseTo(-sell.fee);
  });

  it('T+1 blocks same-day stop loss sell', () => {
    // 第1根开盘买入，当日最低价暴跌触发止损，但 T+1 不能卖；第2根才能卖
    const bars: Bar[] = [
      { date: '2024-01-01', open: 10, high: 10, low: 10, close: 10, volume: 1 },
      { date: '2024-01-02', open: 10, high: 10, low: 8, close: 9, volume: 1 },
      { date: '2024-01-03', open: 9, high: 9, low: 8.5, close: 8.8, volume: 1 },
    ];
    const cfg: BacktestConfig = { ...noCost, tPlusOne: true, stopLoss: 0.05 };
    const res = runBacktest(bars, [1, 1, 1], cfg);
    const sell = res.fills.find((f) => f.side === 'sell');
    expect(sell?.date).toBe('2024-01-03');
    expect(sell?.reason).toBe('stopLoss');
    // 止损后信号未归零，不应再次买入
    expect(res.fills.filter((f) => f.side === 'buy')).toHaveLength(1);

    const res2 = runBacktest(bars, [1, 1, 1], { ...cfg, tPlusOne: false });
    expect(res2.fills.find((f) => f.side === 'sell')?.date).toBe('2024-01-02');
    expect(res2.fills.find((f) => f.side === 'sell')?.price).toBeCloseTo(9.5);
  });

  it('take profit fills at target or gap open', () => {
    const bars: Bar[] = [
      { date: '2024-01-01', open: 10, high: 10, low: 10, close: 10, volume: 1 },
      { date: '2024-01-02', open: 10, high: 10.2, low: 9.9, close: 10.1, volume: 1 },
      { date: '2024-01-03', open: 12, high: 12.5, low: 11.8, close: 12, volume: 1 },
    ];
    const res = runBacktest(bars, [1, 1, 1], { ...noCost, takeProfit: 0.1 });
    const sell = res.fills.find((f) => f.side === 'sell')!;
    expect(sell.reason).toBe('takeProfit');
    expect(sell.price).toBe(12); // 跳空高开，以开盘价成交
  });

  it('limit-up blocks buying', () => {
    const bars: Bar[] = [
      { date: '2024-01-01', open: 10, high: 10, low: 10, close: 10, volume: 1 },
      { date: '2024-01-02', open: 11, high: 11, low: 11, close: 11, volume: 1 },
      { date: '2024-01-03', open: 11.2, high: 11.5, low: 11, close: 11.3, volume: 1 },
    ];
    const res = runBacktest(bars, [1, 1, 1], { ...noCost, limitCheck: true });
    expect(res.fills[0].date).toBe('2024-01-03');
  });

  it('partial positions rebalance only when target changes', () => {
    const bars = mkBars([10, 10, 10, 10, 10, 10]);
    const res = runBacktest(bars, [0.5, 0.5, 1, 1, 0, 0], noCost);
    expect(res.fills.map((f) => f.side)).toEqual(['buy', 'buy', 'sell']);
    expect(res.fills[0].shares).toBe(5000);
    expect(res.trades).toHaveLength(1);
  });

  it('respects date range', () => {
    const bars = mkBars(close);
    const { start, end } = rangeToIndex(bars, { start: '2024-01-03', end: '2024-01-08' });
    expect([start, end]).toEqual([2, 7]);
    const res = runBacktest(bars, bars.map(() => 1), noCost, { start, end });
    expect(res.dates[0]).toBe('2024-01-03');
    expect(res.dates.at(-1)).toBe('2024-01-08');
  });
});

describe('metrics', () => {
  it('max drawdown', () => {
    const info = maxDrawdownInfo([100, 120, 90, 110, 130, 65]);
    expect(info.maxDrawdown).toBeCloseTo(-0.5);
    expect(info.peakIndex).toBe(4);
    expect(info.troughIndex).toBe(5);
  });

  it('sharpe of constant positive returns is 0 (no variance)', () => {
    expect(sharpeRatio([0.01, 0.01, 0.01], 252, 0)).toBe(0);
  });

  it('period returns chain to total', () => {
    const dates = ['2024-01-30', '2024-01-31', '2024-02-01', '2024-02-29', '2024-03-01'];
    const eq = [100, 110, 121, 99, 108.9];
    const pr = periodReturns(dates, eq, 100, 'month');
    expect(pr.map((p) => p.key)).toEqual(['2024-01', '2024-02', '2024-03']);
    const total = pr.reduce((s, p) => s * (1 + p.ret), 1) - 1;
    expect(total).toBeCloseTo(0.089);
  });
});

describe('strategies', () => {
  const bars = getDemoBars('DEMO01');
  for (const def of BUILTIN_STRATEGIES) {
    it(`${def.name} produces valid positions`, () => {
      const out = def.run(bars, defaultParams(def));
      expect(out.position).toHaveLength(bars.length);
      for (const p of out.position) {
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThanOrEqual(1);
      }
      const run = backtestStrategy(def, bars, undefined, DEFAULT_CONFIG, 'day');
      expect(Number.isFinite(run.result.metrics.finalEquity)).toBe(true);
      expect(run.result.equity.every((e) => e > 0)).toBe(true);
    });
  }

  it('trend strategies trade on demo data', () => {
    const run = backtestStrategy(resolveStrategy({ type: 'builtin', id: 'ma_cross' }), bars, undefined, DEFAULT_CONFIG, 'day');
    expect(run.result.metrics.tradeCount).toBeGreaterThan(5);
  });

  it('rule builder', () => {
    const out = runRules(SAMPLE_RULES, bars);
    expect(out.position).toHaveLength(bars.length);
    expect(out.position.some((p) => p === 1)).toBe(true);
    expect(out.overlays.length).toBeGreaterThanOrEqual(3);
    expect(out.subLevels).toContain(70);
  });

  it('code strategy template', () => {
    const params = parseCodeParams(CODE_TEMPLATE);
    expect(params.map((p) => p.key)).toEqual(['fast', 'slow', 'rsiMax']);
    const p = Object.fromEntries(params.map((x) => [x.key, x.default]));
    const out = runCode(CODE_TEMPLATE, bars, p);
    expect(out.position).toHaveLength(bars.length);
    expect(out.overlays).toHaveLength(3);
    expect(() => runCode('return [1,2]', bars, {})).toThrow(/长度/);
    expect(() => runCode('return 5', bars, {})).toThrow();
  });
});

describe('optimizer / monte carlo / rotation', () => {
  const bars = getDemoBars('DEMO01');
  it('grid search with IS/OOS split', () => {
    const res = runOptimize({
      spec: { type: 'builtin', id: 'ma_cross' },
      bars,
      baseParams: { fast: 5, slow: 20, maType: 0 },
      axes: [
        { key: 'fast', from: 5, to: 20, step: 5 },
        { key: 'slow', from: 10, to: 60, step: 10 },
      ],
      config: DEFAULT_CONFIG,
      period: 'day',
      range: {},
      splitRatio: 0.7,
      objective: 'sharpe',
      minTrades: 1,
    });
    expect(res.total).toBe(24);
    expect(res.skipped).toBeGreaterThan(0); // fast >= slow 被跳过
    expect(res.rows.length + res.skipped).toBe(24);
    expect(res.rows[0].oos).toBeDefined();
    expect(res.rows[0].score).toBeGreaterThanOrEqual(res.rows[res.rows.length - 1].score);
  });

  it('monte carlo percentiles are ordered', () => {
    const run = backtestStrategy(BUILTIN_STRATEGIES[0], bars, undefined, DEFAULT_CONFIG, 'day');
    const mc = monteCarlo(run.result.equity, 300);
    const last = mc.steps.length - 1;
    expect(mc.bands.p5[last]).toBeLessThanOrEqual(mc.bands.p50[last]);
    expect(mc.bands.p50[last]).toBeLessThanOrEqual(mc.bands.p95[last]);
    expect(mc.bands.p50).toHaveLength(mc.steps.length);
    expect(mc.probLoss).toBeGreaterThanOrEqual(0);
  });

  it('rotation portfolio', () => {
    const assets = DEMO_SPECS.slice(0, 4).map((s) => ({ meta: s.meta, bars: generateDemoBars(s) }));
    const res = runRotation(assets, DEFAULT_ROTATION);
    expect(res.equity.length).toBeGreaterThan(100);
    expect(res.rebalances.length).toBeGreaterThan(10);
    for (let i = 0; i < res.dates.length; i++) {
      const w = Object.values(res.weights).reduce((s, arr) => s + arr[i], 0);
      expect(w).toBeLessThanOrEqual(1.0001);
    }
    expect(res.equity.every((e) => e > 0)).toBe(true);
  });

  it('diagnosis & stats', () => {
    const d = diagnose(bars);
    expect(d.items.length).toBeGreaterThan(5);
    expect(d.score).toBeGreaterThanOrEqual(0);
    expect(d.score).toBeLessThanOrEqual(100);
    const s = stockStats(bars);
    expect(s.high52).toBeGreaterThanOrEqual(s.low52);
  });
});

describe('data parsing', () => {
  it('eastmoney klines (open, close, high, low order)', () => {
    const r = parseEastmoneyKlines({
      rc: 0,
      data: {
        code: '600519',
        market: 1,
        name: '贵州茅台',
        klines: [
          '2024-01-02,1715.00,1685.01,1718.19,1678.10,32156,5440000000.00,2.36,-1.79,-30.79,0.26',
          '2024-01-03,1681.11,1694.00,1695.22,1676.33,20834,3520000000.00,1.12,0.53,8.99,0.17',
        ],
      },
    });
    expect(r.name).toBe('贵州茅台');
    expect(r.bars[0]).toMatchObject({ date: '2024-01-02', open: 1715, close: 1685.01, high: 1718.19, low: 1678.1, volume: 32156 });
    expect(r.bars[0].turnover).toBeCloseTo(0.26);
    expect(() => parseEastmoneyKlines({ rc: 0, data: null })).toThrow();
  });

  it('eastmoney suggest', () => {
    const r = parseSuggest({
      QuotationCodeTable: {
        Data: [
          { Code: '600519', Name: '贵州茅台', QuoteID: '1.600519', Classify: 'AStock', SecurityTypeName: '沪A' },
          { Code: '00700', Name: '腾讯控股', QuoteID: '116.00700', Classify: 'HK', SecurityTypeName: '港股' },
          { Code: 'AAPL', Name: '苹果', QuoteID: '105.AAPL', Classify: 'UsStock', SecurityTypeName: '美股' },
        ],
      },
    });
    expect(r.map((x) => x.market)).toEqual(['A', 'HK', 'US']);
  });

  it('tencent klines', () => {
    const bars = parseTencentKlines(
      { code: 0, data: { sh600519: { qfqday: [['2024-01-02', '1715.000', '1685.010', '1718.190', '1678.100', '32156.000']] } } },
      'sh600519',
    );
    expect(bars[0]).toMatchObject({ open: 1715, close: 1685.01, high: 1718.19, low: 1678.1 });
    expect(secidToTencent('1.600519')).toBe('sh600519');
    expect(secidToTencent('0.000001')).toBe('sz000001');
    expect(secidToTencent('116.00700')).toBe('hk00700');
    expect(secidToTencent('105.AAPL')).toBeNull();
  });

  it('guess secid', () => {
    expect(guessSecid('600519')).toBe('1.600519');
    expect(guessSecid('sz000001')).toBe('0.000001');
    expect(guessSecid('300750')).toBe('0.300750');
    expect(guessSecid('510300')).toBe('1.510300');
    expect(guessSecid('00700')).toBe('116.00700');
    expect(guessSecid('hk700')).toBe('116.00700');
    expect(guessSecid('aapl')).toBe('105.AAPL');
    expect(guessSecid('1.000300')).toBe('1.000300');
  });

  it('csv with chinese headers', () => {
    const csv = '﻿日期,开盘,最高,最低,收盘,成交量\n' + Array.from({ length: 12 }, (_, i) => `2024/1/${i + 1},10,11,9,10.5,"1,000"`).reverse().join('\n');
    const bars = parseCsv(csv);
    expect(bars).toHaveLength(12);
    expect(bars[0].date).toBe('2024-01-01');
    expect(bars[0].volume).toBe(1000);
    expect(() => parseCsv('a,b\n1,2')).toThrow();
  });

  it('demo data is deterministic and valid', () => {
    const a = generateDemoBars(DEMO_SPECS[0]);
    const b = generateDemoBars(DEMO_SPECS[0]);
    expect(a[500]).toEqual(b[500]);
    for (const bar of a) {
      expect(bar.high).toBeGreaterThanOrEqual(Math.max(bar.open, bar.close));
      expect(bar.low).toBeLessThanOrEqual(Math.min(bar.open, bar.close));
      expect(bar.low).toBeGreaterThan(0);
    }
  });
});
