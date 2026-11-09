import type { Adjust, Bar, Market, Period, StockMeta } from '../types';
import { jsonp } from './jsonp';

const KLINE_URL = 'https://push2his.eastmoney.com/api/qt/stock/kline/get';
const SEARCH_URL = 'https://searchapi.eastmoney.com/api/suggest/get';

const KLT: Record<Period, number> = { day: 101, week: 102, month: 103 };
const FQT: Record<Adjust, number> = { none: 0, qfq: 1, hfq: 2 };

export interface EastmoneyKlineResponse {
  rc?: number;
  data?: {
    code: string;
    market: number;
    name: string;
    klines: string[];
  } | null;
}

/** 解析东方财富 K 线：日期,开盘,收盘,最高,最低,成交量,成交额,振幅,涨跌幅,涨跌额,换手率 */
export function parseEastmoneyKlines(res: EastmoneyKlineResponse): { name: string; code: string; bars: Bar[] } {
  const d = res?.data;
  if (!d || !Array.isArray(d.klines)) throw new Error('未找到该证券的行情数据');
  const bars: Bar[] = [];
  for (const line of d.klines) {
    const f = line.split(',');
    if (f.length < 6) continue;
    const bar: Bar = {
      date: f[0].slice(0, 10),
      open: Number(f[1]),
      close: Number(f[2]),
      high: Number(f[3]),
      low: Number(f[4]),
      volume: Number(f[5]),
      amount: f[6] !== undefined ? Number(f[6]) : undefined,
      turnover: f[10] !== undefined && f[10] !== '-' ? Number(f[10]) : undefined,
    };
    if ([bar.open, bar.close, bar.high, bar.low].every((x) => Number.isFinite(x) && x > 0)) bars.push(bar);
  }
  if (!bars.length) throw new Error('该证券没有可用的 K 线数据');
  return { name: d.name, code: d.code, bars };
}

export async function fetchEastmoneyKlines(secid: string, period: Period, adjust: Adjust) {
  const res = await jsonp<EastmoneyKlineResponse>(KLINE_URL, {
    secid,
    ut: 'fa5fd1943c7b386f172d6893dbfba10b',
    fields1: 'f1,f2,f3,f4,f5,f6',
    fields2: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61',
    klt: KLT[period],
    fqt: FQT[adjust],
    beg: '0',
    end: '20500101',
    lmt: 100000,
  });
  return parseEastmoneyKlines(res);
}

interface SuggestItem {
  Code: string;
  Name: string;
  QuoteID: string;
  Classify?: string;
  SecurityTypeName?: string;
  MktNum?: string;
}

export interface SearchResult extends StockMeta {
  typeName: string;
}

export function marketFromSecid(secid: string): Market {
  const m = secid.split('.')[0];
  if (m === '0' || m === '1') return 'A';
  if (m === '116' || m === '128') return 'HK';
  if (m === '105' || m === '106' || m === '107' || m === '100') return 'US';
  return 'A';
}

export function parseSuggest(res: { QuotationCodeTable?: { Data?: SuggestItem[] | null } }): SearchResult[] {
  const items = res?.QuotationCodeTable?.Data ?? [];
  return items
    .filter((x) => x && x.QuoteID)
    .map((x) => ({
      code: x.Code,
      name: x.Name,
      secid: x.QuoteID,
      market: x.Classify === 'HK' ? 'HK' : x.Classify === 'UsStock' ? 'US' : marketFromSecid(x.QuoteID),
      typeName: x.SecurityTypeName ?? '',
    }));
}

export async function searchEastmoney(keyword: string): Promise<SearchResult[]> {
  const res = await jsonp<{ QuotationCodeTable?: { Data?: SuggestItem[] } }>(
    SEARCH_URL,
    { input: keyword, type: 14, token: 'D43BF722C8E33BDC906FB84D85E326E8', count: 12 },
    { timeout: 8000 },
  );
  return parseSuggest(res);
}

/**
 * 根据用户输入的代码推断东方财富 secid。
 * 600519 / sh600519 → 1.600519；000001 / sz000001 → 0.000001；00700 / hk00700 → 116.00700；AAPL → 105.AAPL
 */
export function guessSecid(input: string): string | null {
  const s = input.trim();
  if (/^\d{1,3}\.[\w.]+$/.test(s)) return s;
  const lower = s.toLowerCase();
  let m = lower.match(/^(sh|sz|bj)(\d{6})$/);
  if (m) return `${m[1] === 'sh' ? 1 : 0}.${m[2]}`;
  m = lower.match(/^(\d{6})(\.(sh|sz|bj|ss))?$/);
  if (m) {
    if (m[3]) return `${m[3] === 'sh' || m[3] === 'ss' ? 1 : 0}.${m[1]}`;
    return /^[569]/.test(m[1]) ? `1.${m[1]}` : `0.${m[1]}`;
  }
  m = lower.match(/^(hk)?(\d{1,5})(\.hk)?$/);
  if (m && (m[1] || m[3] || m[2].length === 5)) return `116.${m[2].padStart(5, '0')}`;
  m = s.match(/^(us)?([A-Za-z][A-Za-z.\-]{0,9})$/i);
  if (m) return `105.${m[2].toUpperCase()}`;
  return null;
}

export interface Valuation {
  price: number;
  pe: number;
  pb: number;
  roe: number;
  marketCap: number;
}

const numOrNaN = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : NaN);

/** 解析东方财富单只股票报价中的估值字段（f43 价格、f162 市盈率、f167 市净率、f173 ROE%、f116 总市值） */
export function parseValuation(res: { data?: Record<string, unknown> | null }): Valuation {
  const d = res?.data;
  if (!d) throw new Error('没有估值数据');
  const pe = numOrNaN(d.f162);
  const pb = numOrNaN(d.f167);
  const roe = numOrNaN(d.f173);
  return {
    price: numOrNaN(d.f43),
    pe: pe > 0 && pe < 5000 ? pe : NaN,
    pb: pb > 0 && pb < 500 ? pb : NaN,
    roe: Math.abs(roe) < 300 ? roe / 100 : NaN,
    marketCap: numOrNaN(d.f116),
  };
}

/** 获取估值指标（实验性：字段含义来自东方财富网页接口，可能变动，结果需人工核对） */
export async function fetchValuation(secid: string): Promise<Valuation> {
  const res = await jsonp<{ data?: Record<string, unknown> | null }>(
    'https://push2.eastmoney.com/api/qt/stock/get',
    { secid, ut: 'fa5fd1943c7b386f172d6893dbfba10b', fltt: 2, invt: 2, fields: 'f43,f57,f58,f116,f162,f167,f173' },
    { timeout: 8000 },
  );
  return parseValuation(res);
}
