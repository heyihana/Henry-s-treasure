import type { Period } from '../types';

export type ExecutionMode = 'nextOpen' | 'close';

export interface BacktestConfig {
  /** 初始资金 */
  initialCapital: number;
  /** 佣金费率（双边），如 0.00025 = 万 2.5 */
  commissionRate: number;
  /** 单笔最低佣金 */
  minCommission: number;
  /** 印花税率 */
  stampTaxRate: number;
  /** 印花税是否双边收取（港股为双边，A 股仅卖出收取） */
  stampTaxBothSides: boolean;
  /** 滑点（按价格比例），0.001 = 0.1% */
  slippage: number;
  /** 每手股数（A 股 100，美股 1） */
  lotSize: number;
  /** T+1：当日买入的股票次日才能卖出 */
  tPlusOne: boolean;
  /** 成交方式：信号次日开盘成交 / 信号当日收盘成交 */
  execution: ExecutionMode;
  /** 止损比例，0 表示关闭 */
  stopLoss: number;
  /** 止盈比例，0 表示关闭 */
  takeProfit: number;
  /** 移动止损（自最高点回撤比例），0 表示关闭 */
  trailingStop: number;
  /** 涨停不能买、跌停不能卖 */
  limitCheck: boolean;
  /** 无风险年利率，用于夏普比率 */
  riskFreeRate: number;
}

export type MarketPreset = 'A' | 'HK' | 'US' | 'custom';

export const DEFAULT_CONFIG: BacktestConfig = {
  initialCapital: 100000,
  commissionRate: 0.00025,
  minCommission: 5,
  stampTaxRate: 0.0005,
  stampTaxBothSides: false,
  slippage: 0.001,
  lotSize: 100,
  tPlusOne: true,
  execution: 'nextOpen',
  stopLoss: 0,
  takeProfit: 0,
  trailingStop: 0,
  limitCheck: true,
  riskFreeRate: 0.02,
};

/** 不同市场的交易规则预设 */
export const MARKET_PRESETS: Record<Exclude<MarketPreset, 'custom'>, Partial<BacktestConfig>> = {
  A: {
    commissionRate: 0.00025,
    minCommission: 5,
    stampTaxRate: 0.0005,
    stampTaxBothSides: false,
    lotSize: 100,
    tPlusOne: true,
    limitCheck: true,
  },
  HK: {
    commissionRate: 0.0003,
    minCommission: 3,
    stampTaxRate: 0.001,
    stampTaxBothSides: true,
    lotSize: 100,
    tPlusOne: false,
    limitCheck: false,
  },
  US: {
    commissionRate: 0.0001,
    minCommission: 0,
    stampTaxRate: 0,
    stampTaxBothSides: false,
    lotSize: 1,
    tPlusOne: false,
    limitCheck: false,
  },
};

export type FillReason = 'signal' | 'stopLoss' | 'takeProfit' | 'trailingStop';

export interface Fill {
  index: number;
  date: string;
  side: 'buy' | 'sell';
  price: number;
  shares: number;
  value: number;
  fee: number;
  reason: FillReason;
}

export interface Trade {
  entryIndex: number;
  entryDate: string;
  exitIndex: number;
  exitDate: string;
  /** 平均买入价 */
  entryPrice: number;
  /** 平均卖出价（持仓中为最新收盘价） */
  exitPrice: number;
  /** 期间最大持股数 */
  shares: number;
  /** 盈亏金额（含费用） */
  pnl: number;
  /** 收益率 = 盈亏 / 买入总成本 */
  returnPct: number;
  /** 持有 K 线数 */
  holdingBars: number;
  exitReason: FillReason | 'open';
  /** 是否仍在持仓 */
  open: boolean;
}

export interface Metrics {
  initialCapital: number;
  finalEquity: number;
  totalReturn: number;
  annualReturn: number;
  annualVolatility: number;
  sharpe: number;
  sortino: number;
  maxDrawdown: number;
  maxDrawdownStart: string;
  maxDrawdownEnd: string;
  /** 最长回撤持续 K 线数 */
  maxDrawdownDuration: number;
  calmar: number;
  benchmarkReturn: number;
  benchmarkAnnualReturn: number;
  benchmarkMaxDrawdown: number;
  benchmarkSharpe: number;
  excessReturn: number;
  alpha: number;
  beta: number;
  informationRatio: number;
  tradeCount: number;
  winRate: number;
  /** 盈亏比 = 平均盈利 / 平均亏损 */
  profitLossRatio: number;
  /** 利润因子 = 总盈利 / 总亏损 */
  profitFactor: number;
  avgTradeReturn: number;
  avgHoldingBars: number;
  maxConsecutiveLosses: number;
  /** 持仓时间占比 */
  exposure: number;
  totalFees: number;
  bars: number;
  years: number;
}

export interface BacktestResult {
  dates: string[];
  equity: number[];
  benchmark: number[];
  /** 每根 K 线收盘时的仓位占比 0~1 */
  exposure: number[];
  drawdown: number[];
  benchmarkDrawdown: number[];
  fills: Fill[];
  trades: Trade[];
  metrics: Metrics;
  config: BacktestConfig;
  period: Period;
  /** 回测区间在原始 K 线中的起始下标 */
  startIndex: number;
}
