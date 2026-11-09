import type { Adjust, Period, StockData, StockMeta } from '../types';
import { readCache, writeCache } from './cache';
import { getDemoBars } from './demo';
import { fetchEastmoneyKlines, marketFromSecid } from './eastmoney';
import { fetchTencentKlines } from './tencent';

export { DEMO_SPECS } from './demo';
export { POPULAR, DEFAULT_WATCHLIST, ROTATION_PRESETS } from './popular';
export { guessSecid, searchEastmoney, type SearchResult } from './eastmoney';
export { parseCsv, barsToCsv, toCsv, downloadText } from './csv';
export { clearCache } from './cache';

/** 缓存有效期：6 小时 */
const TTL = 6 * 3600 * 1000;

const csvStore = new Map<string, StockData>();

export function registerCsv(data: StockData) {
  csvStore.set(data.meta.secid, data);
}

function resample(data: StockData, period: Period): StockData {
  if (period === 'day' || data.period === period) return data;
  const out: typeof data.bars = [];
  const keyOf = (date: string) => {
    if (period === 'month') return date.slice(0, 7);
    const d = new Date(date + 'T00:00:00Z');
    const day = (d.getUTCDay() + 6) % 7; // 周一为 0
    d.setUTCDate(d.getUTCDate() - day);
    return d.toISOString().slice(0, 10);
  };
  let curKey = '';
  for (const b of data.bars) {
    const k = keyOf(b.date);
    const last = out[out.length - 1];
    if (k !== curKey || !last) {
      out.push({ ...b });
      curKey = k;
    } else {
      last.high = Math.max(last.high, b.high);
      last.low = Math.min(last.low, b.low);
      last.close = b.close;
      last.volume += b.volume;
      last.amount = (last.amount ?? 0) + (b.amount ?? 0);
      last.date = b.date;
    }
  }
  return { ...data, bars: out, period };
}

export interface LoadOptions {
  period?: Period;
  adjust?: Adjust;
  /** 忽略缓存强制刷新 */
  force?: boolean;
}

/** 加载行情：缓存 → 东方财富 → 腾讯（A股/港股备用） */
export async function loadStock(meta: StockMeta, opts: LoadOptions = {}): Promise<StockData> {
  const period = opts.period ?? 'day';
  const adjust = opts.adjust ?? 'qfq';

  if (meta.market === 'DEMO') {
    const base: StockData = { meta, bars: getDemoBars(meta.code), period: 'day', adjust: 'none', source: 'demo', fetchedAt: Date.now() };
    return resample(base, period);
  }
  if (meta.market === 'CSV') {
    const d = csvStore.get(meta.secid);
    if (!d) throw new Error('CSV 数据已失效，请重新导入');
    return resample(d, period);
  }

  const key = `${meta.secid}|${period}|${adjust}`;
  if (!opts.force) {
    const c = await readCache(key);
    if (c && Date.now() - c.fetchedAt < TTL) return c;
  }

  const errors: string[] = [];
  try {
    const r = await fetchEastmoneyKlines(meta.secid, period, adjust);
    const data: StockData = {
      meta: { ...meta, name: r.name || meta.name, code: r.code || meta.code, market: meta.market ?? marketFromSecid(meta.secid) },
      bars: r.bars,
      period,
      adjust,
      source: 'eastmoney',
      fetchedAt: Date.now(),
    };
    void writeCache(key, data);
    return data;
  } catch (e) {
    errors.push(`东方财富：${(e as Error).message}`);
  }
  try {
    const bars = await fetchTencentKlines(meta.secid, period, adjust);
    if (bars.length) {
      const data: StockData = { meta, bars, period, adjust, source: 'tencent', fetchedAt: Date.now() };
      void writeCache(key, data);
      return data;
    }
  } catch (e) {
    errors.push(`腾讯：${(e as Error).message}`);
  }
  // 最后尝试返回过期缓存
  const stale = await readCache(key);
  if (stale) return stale;
  throw new Error(errors.join('；'));
}
