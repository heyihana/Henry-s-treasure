/** 单根 K 线 */
export interface Bar {
  /** 交易日期 YYYY-MM-DD */
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  /** 成交量（股 / 手，取决于数据源） */
  volume: number;
  /** 成交额 */
  amount?: number;
  /** 换手率 % */
  turnover?: number;
}

export type Market = 'A' | 'HK' | 'US' | 'DEMO' | 'CSV';
export type Period = 'day' | 'week' | 'month';
export type Adjust = 'qfq' | 'hfq' | 'none';

/** 证券基本信息 */
export interface StockMeta {
  /** 代码，如 600519 / 00700 / AAPL */
  code: string;
  name: string;
  /** 东方财富行情 ID，如 1.600519；模拟数据为 demo.xxx，CSV 为 csv.xxx */
  secid: string;
  market: Market;
}

export interface StockData {
  meta: StockMeta;
  bars: Bar[];
  period: Period;
  adjust: Adjust;
  source: 'eastmoney' | 'tencent' | 'demo' | 'csv';
  fetchedAt: number;
}

/** 每年的 K 线数量，用于年化 */
export function periodsPerYear(period: Period): number {
  return period === 'week' ? 52 : period === 'month' ? 12 : 252;
}
