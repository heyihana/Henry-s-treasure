import { computeMetrics, drawdownSeries } from './backtest/metrics';
import type { Metrics } from './backtest/types';
import { std } from './backtest/metrics';
import type { Bar, Period, StockMeta } from './types';
import { periodsPerYear } from './types';

export interface RotationAsset {
  meta: StockMeta;
  bars: Bar[];
}

export interface RotationConfig {
  /** 动量回看周期（K 线数） */
  lookback: number;
  /** 调仓间隔（K 线数） */
  rebalanceEvery: number;
  /** 持有排名前 N 的标的 */
  topN: number;
  /** 绝对动量过滤：动量 ≤ 0 的标的不持有，空出的仓位保留现金 */
  absoluteMomentum: boolean;
  /** 权重方式 */
  weighting: 'equal' | 'invVol';
  initialCapital: number;
  /** 交易费率（佣金 + 印花税等，单边） */
  feeRate: number;
  slippage: number;
  riskFreeRate: number;
  start?: string;
  end?: string;
}

export const DEFAULT_ROTATION: RotationConfig = {
  lookback: 60,
  rebalanceEvery: 10,
  topN: 1,
  absoluteMomentum: true,
  weighting: 'equal',
  initialCapital: 100000,
  feeRate: 0.0003,
  slippage: 0.001,
  riskFreeRate: 0.02,
};

export interface RebalanceRecord {
  date: string;
  scores: { code: string; name: string; score: number }[];
  weights: Record<string, number>;
  turnover: number;
}

export interface RotationResult {
  dates: string[];
  equity: number[];
  benchmark: number[];
  drawdown: number[];
  /** 每个标的每日的持仓权重 */
  weights: Record<string, number[]>;
  rebalances: RebalanceRecord[];
  metrics: Metrics;
  assets: StockMeta[];
  /** 每个标的区间收益 */
  assetReturns: { code: string; name: string; ret: number }[];
}

/** 取所有标的共同的交易日 */
export function alignAssets(assets: RotationAsset[]): { dates: string[]; idx: Map<string, number>[] } {
  const sets = assets.map((a) => new Set(a.bars.map((b) => b.date)));
  const dates = [...sets[0]].filter((d) => sets.every((s) => s.has(d))).sort();
  const idx = assets.map((a) => new Map(a.bars.map((b, i) => [b.date, i])));
  return { dates, idx };
}

/**
 * 动量轮动组合回测：每隔 rebalanceEvery 根 K 线，在收盘时按过去 lookback 的涨幅排名，
 * 次日开盘调仓为前 topN 名（等权或波动率倒数加权）。
 */
export function runRotation(assets: RotationAsset[], cfg: RotationConfig, period: Period = 'day'): RotationResult {
  if (assets.length < 2) throw new Error('至少需要 2 个标的');
  const { dates: allDates, idx } = alignAssets(assets);
  if (allDates.length < cfg.lookback + 5) throw new Error('共同交易日太少，请检查标的或缩短回看周期');

  const N = assets.length;
  const closeAt = (a: number, t: number) => assets[a].bars[idx[a].get(allDates[t])!].close;
  const openAt = (a: number, t: number) => assets[a].bars[idx[a].get(allDates[t])!].open;

  let start = 0;
  let end = allDates.length - 1;
  if (cfg.start) start = Math.max(0, allDates.findIndex((d) => d >= cfg.start!));
  if (cfg.end) {
    for (let t = allDates.length - 1; t >= 0; t--)
      if (allDates[t] <= cfg.end) {
        end = t;
        break;
      }
  }
  start = Math.max(start, cfg.lookback); // 保证动量可计算
  if (start >= end) throw new Error('回测区间过短');

  let cash = cfg.initialCapital;
  const shares = new Array<number>(N).fill(0);
  let pending: number[] | null = null;
  const dates: string[] = [];
  const equity: number[] = [];
  const benchmark: number[] = [];
  const weights: Record<string, number[]> = {};
  assets.forEach((a) => (weights[a.meta.code] = []));
  const rebalances: RebalanceRecord[] = [];
  const baseClose = assets.map((_, a) => closeAt(a, start));

  for (let t = start; t <= end; t++) {
    // 1. 按上一次信号在开盘价调仓
    if (pending) {
      const eqOpen = cash + shares.reduce((s, q, a) => s + q * openAt(a, t), 0);
      // 先卖后买
      for (let a = 0; a < N; a++) {
        const price = openAt(a, t);
        const targetShares = (pending[a] * eqOpen) / (price * (1 + cfg.slippage));
        if (targetShares < shares[a]) {
          const q = shares[a] - targetShares;
          const value = q * price * (1 - cfg.slippage);
          cash += value - value * cfg.feeRate;
          shares[a] = targetShares;
        }
      }
      for (let a = 0; a < N; a++) {
        const price = openAt(a, t);
        const targetShares = (pending[a] * eqOpen) / (price * (1 + cfg.slippage));
        if (targetShares > shares[a]) {
          let q = targetShares - shares[a];
          let value = q * price * (1 + cfg.slippage);
          const need = value * (1 + cfg.feeRate);
          if (need > cash) {
            q *= cash / need;
            value = q * price * (1 + cfg.slippage);
          }
          cash -= value * (1 + cfg.feeRate);
          shares[a] += q;
        }
      }
      pending = null;
    }

    // 2. 收盘净值
    const eq = cash + shares.reduce((s, q, a) => s + q * closeAt(a, t), 0);
    dates.push(allDates[t]);
    equity.push(eq);
    benchmark.push(
      (cfg.initialCapital / N) * assets.reduce((s, _, a) => s + closeAt(a, t) / baseClose[a], 0),
    );
    assets.forEach((as, a) => weights[as.meta.code].push(eq > 0 ? (shares[a] * closeAt(a, t)) / eq : 0));

    // 3. 调仓日收盘计算信号
    if ((t - start) % cfg.rebalanceEvery === 0 && t < end) {
      const scores = assets.map((as, a) => ({
        a,
        code: as.meta.code,
        name: as.meta.name,
        score: closeAt(a, t) / closeAt(a, t - cfg.lookback) - 1,
      }));
      const ranked = [...scores].sort((x, y) => y.score - x.score);
      const picked = ranked.slice(0, cfg.topN).filter((s) => !cfg.absoluteMomentum || s.score > 0);
      const w = new Array<number>(N).fill(0);
      if (picked.length) {
        if (cfg.weighting === 'invVol') {
          const inv = picked.map((s) => {
            const rets: number[] = [];
            for (let k = Math.max(1, t - 19); k <= t; k++) rets.push(closeAt(s.a, k) / closeAt(s.a, k - 1) - 1);
            const v = std(rets);
            return v > 0 ? 1 / v : 1;
          });
          const sum = inv.reduce((x, y) => x + y, 0);
          picked.forEach((s, k) => (w[s.a] = inv[k] / sum));
        } else {
          picked.forEach((s) => (w[s.a] = 1 / cfg.topN));
        }
      }
      const cur = assets.map((_, a) => (eq > 0 ? (shares[a] * closeAt(a, t)) / eq : 0));
      const turnover = w.reduce((s, x, a) => s + Math.abs(x - cur[a]), 0) / 2;
      rebalances.push({
        date: allDates[t],
        scores: ranked.map(({ code, name, score }) => ({ code, name, score })),
        weights: Object.fromEntries(assets.map((as, a) => [as.meta.code, w[a]])),
        turnover,
      });
      if (turnover > 0.01) pending = w;
    }
  }

  const metrics = computeMetrics({
    dates,
    equity,
    benchmark,
    exposure: dates.map((_, i) => assets.reduce((s, as) => s + weights[as.meta.code][i], 0)),
    trades: [],
    fills: [],
    initialCapital: cfg.initialCapital,
    periodsPerYear: periodsPerYear(period),
    riskFreeRate: cfg.riskFreeRate,
  });
  metrics.tradeCount = rebalances.filter((r) => r.turnover > 0.01).length;

  return {
    dates,
    equity,
    benchmark,
    drawdown: drawdownSeries(equity),
    weights,
    rebalances,
    metrics,
    assets: assets.map((a) => a.meta),
    assetReturns: assets.map((as, a) => ({
      code: as.meta.code,
      name: as.meta.name,
      ret: closeAt(a, end) / baseClose[a] - 1,
    })),
  };
}
