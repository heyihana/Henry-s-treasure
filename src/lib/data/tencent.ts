import type { Adjust, Bar, Period } from '../types';
import { scriptVar } from './jsonp';

/** 东方财富 secid 转腾讯代码，仅支持 A 股与港股 */
export function secidToTencent(secid: string): string | null {
  const [m, code] = secid.split('.');
  if (!code) return null;
  if (m === '1') return `sh${code}`;
  if (m === '0') return /^[48]/.test(code) ? `bj${code}` : `sz${code}`;
  if (m === '116') return `hk${code}`;
  return null;
}

type TencentRow = (string | number | object)[];

export function parseTencentKlines(payload: unknown, symbol: string): Bar[] {
  const data = (payload as { data?: Record<string, Record<string, TencentRow[]>> })?.data?.[symbol];
  if (!data) throw new Error('腾讯接口未返回数据');
  const rows = data.qfqday ?? data.hfqday ?? data.day ?? data.qfqweek ?? data.week ?? data.qfqmonth ?? data.month;
  if (!Array.isArray(rows)) throw new Error('腾讯接口数据格式异常');
  const bars: Bar[] = [];
  for (const r of rows) {
    const bar: Bar = {
      date: String(r[0]).slice(0, 10),
      open: Number(r[1]),
      close: Number(r[2]),
      high: Number(r[3]),
      low: Number(r[4]),
      volume: Number(r[5]),
    };
    if ([bar.open, bar.close, bar.high, bar.low].every((x) => Number.isFinite(x) && x > 0)) bars.push(bar);
  }
  return bars;
}

export async function fetchTencentKlines(secid: string, period: Period, adjust: Adjust): Promise<Bar[]> {
  const symbol = secidToTencent(secid);
  if (!symbol) throw new Error('腾讯备用接口不支持该市场');
  const varName = `hst_tx_${Date.now().toString(36)}`;
  const fq = adjust === 'none' ? '' : adjust;
  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?_var=${varName}&param=${symbol},${period},,,2000,${fq}`;
  const payload = await scriptVar<unknown>(url, varName);
  return parseTencentKlines(payload, symbol);
}
