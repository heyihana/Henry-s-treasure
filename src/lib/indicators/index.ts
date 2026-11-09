/**
 * 技术指标库。所有函数返回与输入等长的数组，指标尚未形成的位置为 NaN。
 * 计算口径尽量与国内主流行情软件（通达信 / 同花顺）保持一致。
 */

export type Series = number[];

const nanArray = (n: number): Series => new Array<number>(n).fill(NaN);

/** 简单移动平均 MA */
export function sma(values: Series, n: number): Series {
  const out = nanArray(values.length);
  if (n <= 0) return out;
  let sum = 0;
  let count = 0; // 窗口内有效值数量
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (Number.isFinite(v)) {
      sum += v;
      count++;
    }
    if (i >= n) {
      const old = values[i - n];
      if (Number.isFinite(old)) {
        sum -= old;
        count--;
      }
    }
    if (i >= n - 1 && count === n) out[i] = sum / n;
  }
  return out;
}

/**
 * 指数移动平均 EMA：Y = (2X + (N-1)Y') / (N+1)，以第一个有效值作为初值（与国内软件一致）。
 */
export function ema(values: Series, n: number): Series {
  const out = nanArray(values.length);
  const alpha = 2 / (n + 1);
  let prev = NaN;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    prev = Number.isFinite(prev) ? alpha * v + (1 - alpha) * prev : v;
    out[i] = prev;
  }
  return out;
}

/**
 * 国内软件中的 SMA(X, N, M)：Y = (M*X + (N-M)*Y') / N。
 * M=1 时等价于 Wilder 平滑，用于 RSI、KDJ。
 */
export function cnSma(values: Series, n: number, m = 1, seed?: number): Series {
  const out = nanArray(values.length);
  let prev = seed ?? NaN;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    prev = Number.isFinite(prev) ? (m * v + (n - m) * prev) / n : v;
    out[i] = prev;
  }
  return out;
}

/** 加权移动平均 WMA */
export function wma(values: Series, n: number): Series {
  const out = nanArray(values.length);
  const denom = (n * (n + 1)) / 2;
  for (let i = n - 1; i < values.length; i++) {
    let s = 0;
    let ok = true;
    for (let j = 0; j < n; j++) {
      const v = values[i - j];
      if (!Number.isFinite(v)) {
        ok = false;
        break;
      }
      s += v * (n - j);
    }
    if (ok) out[i] = s / denom;
  }
  return out;
}

/** 滚动总体标准差 */
export function stdev(values: Series, n: number): Series {
  const out = nanArray(values.length);
  for (let i = n - 1; i < values.length; i++) {
    let s = 0;
    let s2 = 0;
    let ok = true;
    for (let j = i - n + 1; j <= i; j++) {
      const v = values[j];
      if (!Number.isFinite(v)) {
        ok = false;
        break;
      }
      s += v;
      s2 += v * v;
    }
    if (!ok) continue;
    const mean = s / n;
    out[i] = Math.sqrt(Math.max(0, s2 / n - mean * mean));
  }
  return out;
}

/** N 周期最高值（含当前） */
export function highest(values: Series, n: number): Series {
  const out = nanArray(values.length);
  for (let i = n - 1; i < values.length; i++) {
    let m = -Infinity;
    for (let j = i - n + 1; j <= i; j++) if (values[j] > m) m = values[j];
    out[i] = m;
  }
  return out;
}

/** N 周期最低值（含当前） */
export function lowest(values: Series, n: number): Series {
  const out = nanArray(values.length);
  for (let i = n - 1; i < values.length; i++) {
    let m = Infinity;
    for (let j = i - n + 1; j <= i; j++) if (values[j] < m) m = values[j];
    out[i] = m;
  }
  return out;
}

/** 序列整体右移 k 位（REF） */
export function ref(values: Series, k = 1): Series {
  const out = nanArray(values.length);
  for (let i = k; i < values.length; i++) out[i] = values[i - k];
  return out;
}

export interface MACDResult {
  dif: Series;
  dea: Series;
  /** 柱状图，国内口径为 2*(DIF-DEA) */
  hist: Series;
}

export function macd(close: Series, fast = 12, slow = 26, signal = 9): MACDResult {
  const ef = ema(close, fast);
  const es = ema(close, slow);
  const dif = close.map((_, i) => ef[i] - es[i]);
  const dea = ema(dif, signal);
  const hist = dif.map((d, i) => 2 * (d - dea[i]));
  return { dif, dea, hist };
}

/** RSI（Wilder 平滑） */
export function rsi(close: Series, n = 14): Series {
  const len = close.length;
  const gain = nanArray(len);
  const loss = nanArray(len);
  for (let i = 1; i < len; i++) {
    const d = close[i] - close[i - 1];
    gain[i] = Math.max(d, 0);
    loss[i] = Math.max(-d, 0);
  }
  const ag = cnSma(gain, n, 1);
  const al = cnSma(loss, n, 1);
  const out = nanArray(len);
  for (let i = n; i < len; i++) {
    const g = ag[i];
    const l = al[i];
    if (!Number.isFinite(g) || !Number.isFinite(l)) continue;
    out[i] = g + l === 0 ? 50 : (100 * g) / (g + l);
  }
  return out;
}

export interface BandResult {
  upper: Series;
  mid: Series;
  lower: Series;
}

/** 布林带 */
export function boll(close: Series, n = 20, k = 2): BandResult {
  const mid = sma(close, n);
  const sd = stdev(close, n);
  return {
    mid,
    upper: mid.map((m, i) => m + k * sd[i]),
    lower: mid.map((m, i) => m - k * sd[i]),
  };
}

export interface KDJResult {
  k: Series;
  d: Series;
  j: Series;
}

/** KDJ 随机指标，K、D 初值为 50 */
export function kdj(high: Series, low: Series, close: Series, n = 9, m1 = 3, m2 = 3): KDJResult {
  const hh = highest(high, n);
  const ll = lowest(low, n);
  const rsv = close.map((c, i) => {
    const range = hh[i] - ll[i];
    if (!Number.isFinite(range)) return NaN;
    return range === 0 ? 50 : ((c - ll[i]) / range) * 100;
  });
  const k = cnSma(rsv, m1, 1, 50);
  const d = cnSma(k, m2, 1, 50);
  const j = k.map((kv, i) => 3 * kv - 2 * d[i]);
  return { k, d, j };
}

/** 真实波幅 TR */
export function trueRange(high: Series, low: Series, close: Series): Series {
  return high.map((h, i) => {
    if (i === 0) return h - low[i];
    const pc = close[i - 1];
    return Math.max(h - low[i], Math.abs(h - pc), Math.abs(low[i] - pc));
  });
}

/** 平均真实波幅 ATR（Wilder 平滑） */
export function atr(high: Series, low: Series, close: Series, n = 14): Series {
  const tr = trueRange(high, low, close);
  const out = cnSma(tr, n, 1);
  for (let i = 0; i < Math.min(n - 1, out.length); i++) out[i] = NaN;
  return out;
}

/** 变动率 ROC（%） */
export function roc(close: Series, n = 12): Series {
  const out = nanArray(close.length);
  for (let i = n; i < close.length; i++) {
    const base = close[i - n];
    if (base) out[i] = ((close[i] - base) / base) * 100;
  }
  return out;
}

/** 乖离率 BIAS（%） */
export function bias(close: Series, n = 6): Series {
  const ma = sma(close, n);
  return close.map((c, i) => ((c - ma[i]) / ma[i]) * 100);
}

/** 顺势指标 CCI */
export function cci(high: Series, low: Series, close: Series, n = 14): Series {
  const tp = close.map((c, i) => (high[i] + low[i] + c) / 3);
  const ma = sma(tp, n);
  const out = nanArray(close.length);
  for (let i = n - 1; i < close.length; i++) {
    let md = 0;
    for (let j = i - n + 1; j <= i; j++) md += Math.abs(tp[j] - ma[i]);
    md /= n;
    out[i] = md === 0 ? 0 : (tp[i] - ma[i]) / (0.015 * md);
  }
  return out;
}

/** 能量潮 OBV */
export function obv(close: Series, volume: Series): Series {
  const out = nanArray(close.length);
  let acc = 0;
  for (let i = 0; i < close.length; i++) {
    if (i > 0) {
      if (close[i] > close[i - 1]) acc += volume[i];
      else if (close[i] < close[i - 1]) acc -= volume[i];
    }
    out[i] = acc;
  }
  return out;
}

/** 威廉指标 WR（0~100，越大越超卖，国内口径） */
export function williamsR(high: Series, low: Series, close: Series, n = 14): Series {
  const hh = highest(high, n);
  const ll = lowest(low, n);
  return close.map((c, i) => {
    const r = hh[i] - ll[i];
    if (!Number.isFinite(r)) return NaN;
    return r === 0 ? 50 : ((hh[i] - c) / r) * 100;
  });
}

export interface SuperTrendResult {
  line: Series;
  /** 1 = 多头，-1 = 空头 */
  direction: Series;
}

/** SuperTrend 超级趋势 */
export function superTrend(high: Series, low: Series, close: Series, n = 10, mult = 3): SuperTrendResult {
  const len = close.length;
  const a = atr(high, low, close, n);
  const line = nanArray(len);
  const direction = nanArray(len);
  let upper = NaN;
  let lower = NaN;
  let dir = 1;
  for (let i = 0; i < len; i++) {
    if (!Number.isFinite(a[i])) continue;
    const mid = (high[i] + low[i]) / 2;
    const bu = mid + mult * a[i];
    const bl = mid - mult * a[i];
    const pc = i > 0 ? close[i - 1] : close[i];
    upper = !Number.isFinite(upper) || bu < upper || pc > upper ? bu : upper;
    lower = !Number.isFinite(lower) || bl > lower || pc < lower ? bl : lower;
    if (Number.isFinite(line[i - 1])) {
      if (dir === 1 && close[i] < lower) dir = -1;
      else if (dir === -1 && close[i] > upper) dir = 1;
    } else {
      dir = close[i] >= mid ? 1 : -1;
    }
    line[i] = dir === 1 ? lower : upper;
    direction[i] = dir;
  }
  return { line, direction };
}

/** a 在第 i 根上穿 b */
export function crossOver(a: Series, b: Series, i: number): boolean {
  return i > 0 && a[i] > b[i] && a[i - 1] <= b[i - 1];
}

/** a 在第 i 根下穿 b */
export function crossUnder(a: Series, b: Series, i: number): boolean {
  return i > 0 && a[i] < b[i] && a[i - 1] >= b[i - 1];
}

/** 常数序列 */
export function constant(n: number, v: number): Series {
  return new Array<number>(n).fill(v);
}

/** 便捷取 OHLCV 列 */
export function columns(bars: { open: number; high: number; low: number; close: number; volume: number }[]) {
  const n = bars.length;
  const open = new Array<number>(n);
  const high = new Array<number>(n);
  const low = new Array<number>(n);
  const close = new Array<number>(n);
  const volume = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const b = bars[i];
    open[i] = b.open;
    high[i] = b.high;
    low[i] = b.low;
    close[i] = b.close;
    volume[i] = b.volume;
  }
  return { open, high, low, close, volume };
}
