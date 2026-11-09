import { returnsOf } from './backtest/metrics';
import { mulberry32 } from './random';

export interface MonteCarloResult {
  /** 路径上的检查点（K 线序号） */
  steps: number[];
  /** 各分位数的净值路径（初始为 1） */
  bands: { p5: number[]; p25: number[]; p50: number[]; p75: number[]; p95: number[] };
  finalReturns: number[];
  maxDrawdowns: number[];
  probLoss: number;
  /** 最终收益的 5% 分位（95% VaR） */
  var95: number;
  medianReturn: number;
  medianMaxDrawdown: number;
  worstMaxDrawdown5: number;
  sims: number;
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * 分块自助法（Block Bootstrap）蒙特卡洛：从策略历史日收益中按块随机重抽样，
 * 生成大量同长度的“平行世界”净值路径，评估收益与回撤的分布。
 */
export function monteCarlo(equity: number[], sims = 1000, blockSize = 5, seed = 42): MonteCarloResult {
  const rets = returnsOf(equity);
  const n = rets.length;
  if (n < 2) throw new Error('数据太短，无法进行蒙特卡洛模拟');
  const rand = mulberry32(seed);
  const checkpoints = Math.min(120, n);
  const steps: number[] = [];
  for (let k = 0; k <= checkpoints; k++) steps.push(Math.round((k / checkpoints) * n));
  const pathsAt: number[][] = steps.map(() => []);
  const finalReturns: number[] = [];
  const maxDrawdowns: number[] = [];

  for (let s = 0; s < sims; s++) {
    let eq = 1;
    let peak = 1;
    let mdd = 0;
    let ci = 0;
    if (steps[0] === 0) pathsAt[ci++].push(1);
    let t = 0;
    while (t < n) {
      const startIdx = Math.floor(rand() * Math.max(1, n - blockSize + 1));
      for (let b = 0; b < blockSize && t < n; b++, t++) {
        eq *= 1 + (rets[startIdx + b] ?? 0);
        if (eq > peak) peak = eq;
        const dd = eq / peak - 1;
        if (dd < mdd) mdd = dd;
        while (ci < steps.length && steps[ci] === t + 1) pathsAt[ci++].push(eq);
      }
    }
    finalReturns.push(eq - 1);
    maxDrawdowns.push(mdd);
  }

  const bands = { p5: [] as number[], p25: [] as number[], p50: [] as number[], p75: [] as number[], p95: [] as number[] };
  for (const arr of pathsAt) {
    const s = [...arr].sort((a, b) => a - b);
    bands.p5.push(quantile(s, 0.05));
    bands.p25.push(quantile(s, 0.25));
    bands.p50.push(quantile(s, 0.5));
    bands.p75.push(quantile(s, 0.75));
    bands.p95.push(quantile(s, 0.95));
  }
  const fr = [...finalReturns].sort((a, b) => a - b);
  const md = [...maxDrawdowns].sort((a, b) => a - b);
  return {
    steps,
    bands,
    finalReturns,
    maxDrawdowns,
    probLoss: finalReturns.filter((r) => r < 0).length / Math.max(1, sims),
    var95: quantile(fr, 0.05),
    medianReturn: quantile(fr, 0.5),
    medianMaxDrawdown: quantile(md, 0.5),
    worstMaxDrawdown5: quantile(md, 0.05),
    sims,
  };
}

/** 直方图分箱 */
export function histogram(values: number[], bins = 30): { x: number[]; count: number[]; width: number } {
  if (!values.length) return { x: [], count: [], width: 0 };
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (hi === lo) hi = lo + 1e-6;
  const width = (hi - lo) / bins;
  const count = new Array<number>(bins).fill(0);
  for (const v of values) count[Math.min(bins - 1, Math.floor((v - lo) / width))]++;
  return { x: count.map((_, i) => lo + (i + 0.5) * width), count, width };
}
