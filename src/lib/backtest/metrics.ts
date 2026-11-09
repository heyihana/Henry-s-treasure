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

  const mo = moments(rs);
  const sdR = std(rs);
  const srPer = sdR > 0 ? (mean(rs) - rf / ppy) / sdR : 0;
  const plr = avgLoss > 0 ? avgWin / avgLoss : 0;
  const wr = closed.length ? wins.length / closed.length : 0;
  const varAnnual = rs.length > 1 ? sdR * sdR * ppy : 0;
  const exAnnual = rs.length ? mean(rs) * ppy - rf : 0;

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
    skew: mo.skew,
    kurtosis: mo.kurtosis,
    psr: probabilisticSharpe(srPer, 0, rs.length, mo.skew, mo.kurtosis),
    kelly: closed.length >= 5 && plr > 0 ? wr - (1 - wr) / plr : 0,
    merton: varAnnual > 0 ? exAnnual / (2 * varAnnual) : 0,
  };
}

/** 标准正态分布累积函数 */
export function normCdf(x: number): number {
  // Abramowitz-Stegun 7.1.26
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

/** 标准正态分布分位数（Acklam 近似） */
export function normInv(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - pl) return -normInv(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

export function moments(xs: number[]): { skew: number; kurtosis: number } {
  const n = xs.length;
  if (n < 4) return { skew: 0, kurtosis: 3 };
  const m = mean(xs);
  let m2 = 0;
  let m3 = 0;
  let m4 = 0;
  for (const x of xs) {
    const d = x - m;
    m2 += d * d;
    m3 += d * d * d;
    m4 += d * d * d * d;
  }
  m2 /= n;
  m3 /= n;
  m4 /= n;
  if (!(m2 > 0)) return { skew: 0, kurtosis: 3 };
  return { skew: m3 / Math.pow(m2, 1.5), kurtosis: m4 / (m2 * m2) };
}

/**
 * 概率夏普比率 PSR：考虑样本长度、偏度、峰度后，真实夏普比率超过基准 sr0 的概率。
 * sr、sr0 为单期（非年化）夏普。Bailey & López de Prado (2012)。
 */
export function probabilisticSharpe(sr: number, sr0: number, n: number, skew: number, kurtosis: number): number {
  if (n < 3) return 0.5;
  const denom = Math.sqrt(Math.max(1e-12, 1 - skew * sr + ((kurtosis - 1) / 4) * sr * sr));
  return normCdf(((sr - sr0) * Math.sqrt(n - 1)) / denom);
}

/**
 * 紧缩夏普比率 DSR 的基准：在做了 trials 次尝试、各次夏普方差为 varSr 时，
 * 单纯靠运气能得到的最大夏普期望值。Bailey & López de Prado (2014)。
 */
export function expectedMaxSharpe(varSr: number, trials: number): number {
  if (trials < 2 || !(varSr > 0)) return 0;
  const g = 0.5772156649;
  return Math.sqrt(varSr) * ((1 - g) * normInv(1 - 1 / trials) + g * normInv(1 - 1 / (trials * Math.E)));
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
