import type { Fill, Metrics, Trade } from './types';

export function mean(xs: number[]): number {
  if (!xs.length) return NaN;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/** 样本标准差 */
export function std(xs: number[]): number {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) * (x - m);
  return Math.sqrt(s / (xs.length - 1));
}

export function returnsOf(series: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < series.length; i++) {
    const prev = series[i - 1];
    out.push(prev > 0 ? series[i] / prev - 1 : 0);
  }
  return out;
}

/** 回撤序列（≤ 0） */
export function drawdownSeries(equity: number[]): number[] {
  let peak = -Infinity;
  return equity.map((e) => {
    if (e > peak) peak = e;
    return peak > 0 ? e / peak - 1 : 0;
  });
}

export interface MaxDrawdownInfo {
  maxDrawdown: number;
  peakIndex: number;
  troughIndex: number;
  longestDuration: number;
}

export function maxDrawdownInfo(equity: number[]): MaxDrawdownInfo {
  let peak = -Infinity;
  let peakIdx = 0;
  let mdd = 0;
  let mddPeak = 0;
  let mddTrough = 0;
  let longest = 0;
  for (let i = 0; i < equity.length; i++) {
    const e = equity[i];
    if (e >= peak) {
      peak = e;
      peakIdx = i;
    } else {
      longest = Math.max(longest, i - peakIdx);
    }
    const dd = peak > 0 ? e / peak - 1 : 0;
    if (dd < mdd) {
      mdd = dd;
      mddPeak = peakIdx;
      mddTrough = i;
    }
  }
  return { maxDrawdown: mdd, peakIndex: mddPeak, troughIndex: mddTrough, longestDuration: longest };
}

/** 根据日期计算年数，无法解析时退回 K 线数 / 年化系数 */
export function yearsBetween(dates: string[], ppy: number): number {
  if (dates.length < 2) return 0;
  const a = Date.parse(dates[0]);
  const b = Date.parse(dates[dates.length - 1]);
  if (Number.isFinite(a) && Number.isFinite(b) && b > a) return (b - a) / (365.25 * 86400000);
  return (dates.length - 1) / ppy;
}

export function annualize(totalReturn: number, years: number): number {
  if (years <= 0 || totalReturn <= -1) return totalReturn <= -1 ? -1 : 0;
  return Math.pow(1 + totalReturn, 1 / years) - 1;
}

export function sharpeRatio(rets: number[], ppy: number, rf: number): number {
  const s = std(rets);
  if (!(s > 0)) return 0;
  return ((mean(rets) - rf / ppy) / s) * Math.sqrt(ppy);
}

export function sortinoRatio(rets: number[], ppy: number, rf: number): number {
  if (!rets.length) return 0;
  const r0 = rf / ppy;
  let s = 0;
  for (const r of rets) {
    const d = Math.min(0, r - r0);
    s += d * d;
  }
  const dd = Math.sqrt(s / rets.length);
  if (!(dd > 0)) return 0;
  return ((mean(rets) - r0) / dd) * Math.sqrt(ppy);
}

export interface MetricsInput {
  dates: string[];
  equity: number[];
  benchmark: number[];
  exposure: number[];
  trades: Trade[];
  fills: Fill[];
  initialCapital: number;
  periodsPerYear: number;
  riskFreeRate: number;
}

export function computeMetrics(input: MetricsInput): Metrics {
  const { dates, equity, benchmark, exposure, trades, fills, initialCapital, periodsPerYear: ppy, riskFreeRate: rf } = input;
  const n = equity.length;
  const finalEquity = n ? equity[n - 1] : initialCapital;
  const totalReturn = finalEquity / initialCapital - 1;
  const years = yearsBetween(dates, ppy);
  const rs = returnsOf(equity);
  const rb = returnsOf(benchmark);

  const dd = maxDrawdownInfo(equity);
  const bdd = maxDrawdownInfo(benchmark);
  const annualReturn = annualize(totalReturn, years);
  const benchmarkReturn = n ? benchmark[n - 1] / initialCapital - 1 : 0;
  const benchmarkAnnualReturn = annualize(benchmarkReturn, years);

  // Alpha / Beta（日收益回归）
  let beta = 0;
  let alpha = 0;
  let informationRatio = 0;
  if (rs.length > 2) {
    const ms = mean(rs);
    const mb = mean(rb);
    let cov = 0;
    let varb = 0;
    for (let i = 0; i < rs.length; i++) {
      cov += (rs[i] - ms) * (rb[i] - mb);
      varb += (rb[i] - mb) * (rb[i] - mb);
    }
    beta = varb > 0 ? cov / varb : 0;
    const r0 = rf / ppy;
    alpha = (ms - r0 - beta * (mb - r0)) * ppy;
    const active = rs.map((r, i) => r - rb[i]);
    const te = std(active);
    informationRatio = te > 0 ? (mean(active) / te) * Math.sqrt(ppy) : 0;
  }

  const closed = trades.filter((t) => !t.open);
  const wins = closed.filter((t) => t.pnl > 0);
  const losses = closed.filter((t) => t.pnl <= 0);
  const grossWin = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const avgWin = wins.length ? mean(wins.map((t) => t.returnPct)) : 0;
  const avgLoss = losses.length ? Math.abs(mean(losses.map((t) => t.returnPct))) : 0;
  let streak = 0;
  let maxStreak = 0;
  for (const t of closed) {
    if (t.pnl <= 0) {
      streak++;
      maxStreak = Math.max(maxStreak, streak);
    } else streak = 0;
  }

  return {
    initialCapital,
    finalEquity,
    totalReturn,
    annualReturn,
    annualVolatility: rs.length > 1 ? std(rs) * Math.sqrt(ppy) : 0,
    sharpe: sharpeRatio(rs, ppy, rf),
    sortino: sortinoRatio(rs, ppy, rf),
    maxDrawdown: dd.maxDrawdown,
    maxDrawdownStart: dates[dd.peakIndex] ?? '',
    maxDrawdownEnd: dates[dd.troughIndex] ?? '',
    maxDrawdownDuration: dd.longestDuration,
    calmar: dd.maxDrawdown < 0 ? annualReturn / Math.abs(dd.maxDrawdown) : 0,
    benchmarkReturn,
    benchmarkAnnualReturn,
    benchmarkMaxDrawdown: bdd.maxDrawdown,
    benchmarkSharpe: sharpeRatio(rb, ppy, rf),
    excessReturn: totalReturn - benchmarkReturn,
    alpha,
    beta,
    informationRatio,
    tradeCount: closed.length,
    winRate: closed.length ? wins.length / closed.length : 0,
    profitLossRatio: avgLoss > 0 ? avgWin / avgLoss : wins.length ? Infinity : 0,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
    avgTradeReturn: closed.length ? mean(closed.map((t) => t.returnPct)) : 0,
    avgHoldingBars: closed.length ? mean(closed.map((t) => t.holdingBars)) : 0,
    maxConsecutiveLosses: maxStreak,
    exposure: exposure.length ? exposure.filter((x) => x > 0.001).length / exposure.length : 0,
    totalFees: fills.reduce((s, f) => s + f.fee, 0),
    bars: n,
    years,
  };
}

export interface PeriodReturn {
  key: string;
  ret: number;
}

/** 按月 / 按年汇总收益 */
export function periodReturns(dates: string[], equity: number[], initial: number, unit: 'month' | 'year'): PeriodReturn[] {
  const out: PeriodReturn[] = [];
  let prevEnd = initial;
  let curKey = '';
  let curLast = initial;
  for (let i = 0; i < dates.length; i++) {
    const key = unit === 'month' ? dates[i].slice(0, 7) : dates[i].slice(0, 4);
    if (key !== curKey) {
      if (curKey) {
        out.push({ key: curKey, ret: curLast / prevEnd - 1 });
        prevEnd = curLast;
      }
      curKey = key;
    }
    curLast = equity[i];
  }
  if (curKey) out.push({ key: curKey, ret: curLast / prevEnd - 1 });
  return out;
}
