import type { Bar, Period } from '../types';
import { periodsPerYear } from '../types';
import { computeMetrics, drawdownSeries } from './metrics';
import type { BacktestConfig, BacktestResult, Fill, FillReason, Trade } from './types';

/**
 * 波动率目标：仓位 × min(1, 目标年化波动 / 近 lookback 期实现波动)，按 10% 档位取整。
 */
export function volTargetPositions(bars: Bar[], positions: number[], target: number, lookback: number, ppy: number): number[] {
  const n = bars.length;
  const out = positions.slice();
  const lb = Math.max(5, Math.floor(lookback));
  const rets: number[] = new Array(n).fill(NaN);
  for (let i = 1; i < n; i++) rets[i] = Math.log(bars[i].close / bars[i - 1].close);
  for (let i = 0; i < n; i++) {
    if (i < lb) continue;
    let s = 0;
    let s2 = 0;
    for (let j = i - lb + 1; j <= i; j++) {
      s += rets[j];
      s2 += rets[j] * rets[j];
    }
    const m = s / lb;
    const vol = Math.sqrt(Math.max(0, (s2 - lb * m * m) / (lb - 1))) * Math.sqrt(ppy);
    const scale = vol > 0 ? Math.min(1, target / vol) : 1;
    out[i] = Math.round(positions[i] * scale * 10) / 10;
  }
  return out;
}

export interface RunOptions {
  /** 回测起始下标（含），默认 0 */
  start?: number;
  /** 回测结束下标（含），默认最后一根 */
  end?: number;
  period?: Period;
}

const EPS = 1e-9;

interface OpenTrade {
  entryIndex: number;
  entryDate: string;
  buyCost: number; // 含费用
  buyShares: number;
  buyValue: number; // 不含费用
  sellProceeds: number; // 扣除费用后
  sellShares: number;
  sellValue: number;
  maxShares: number;
}

/**
 * 单标的、只做多的日频事件驱动回测引擎。
 *
 * @param bars       K 线
 * @param positions  每根 K 线收盘时策略给出的目标仓位（0~1），只使用当根及之前的信息计算
 * @param config     交易规则与成本
 */
export function runBacktest(
  bars: Bar[],
  positions: number[],
  config: BacktestConfig,
  options: RunOptions = {},
): BacktestResult {
  const start = Math.max(0, options.start ?? 0);
  const end = Math.min(bars.length - 1, options.end ?? bars.length - 1);
  const period = options.period ?? 'day';
  const lot = Math.max(1, Math.floor(config.lotSize) || 1);
  if (config.volTarget > 0) positions = volTargetPositions(bars, positions, config.volTarget, config.volLookback || 20, periodsPerYear(period));

  let cash = config.initialCapital;
  let shares = 0;
  let boughtToday = 0; // 当日买入（T+1 下不可卖）
  let currentTarget = 0;
  let riskBlocked = false; // 风控离场后，需等信号归零才能再次入场
  let avgCost = 0;
  let peak = 0;
  let trade: OpenTrade | null = null;

  const fills: Fill[] = [];
  const trades: Trade[] = [];
  const dates: string[] = [];
  const equity: number[] = [];
  const benchmark: number[] = [];
  const exposure: number[] = [];

  const fee = (value: number, side: 'buy' | 'sell') => {
    if (value <= 0) return 0;
    const commission = Math.max(config.minCommission, value * config.commissionRate);
    const stamp = side === 'sell' || config.stampTaxBothSides ? value * config.stampTaxRate : 0;
    return commission + stamp;
  };

  const prevCloseOf = (i: number) => (i > 0 ? bars[i - 1].close : bars[i].open);

  /** 涨停不能买：成交价为当日最高价且较昨收涨幅 ≥ 9.5% */
  const buyBlocked = (i: number, price: number) => {
    if (!config.limitCheck) return false;
    const bar = bars[i];
    const pc = prevCloseOf(i);
    return price >= bar.high - EPS && price / pc - 1 >= 0.095;
  };
  /** 跌停不能卖：成交价为当日最低价且较昨收跌幅 ≥ 9.5% */
  const sellBlocked = (i: number, price: number) => {
    if (!config.limitCheck) return false;
    const bar = bars[i];
    const pc = prevCloseOf(i);
    return price <= bar.low + EPS && price / pc - 1 <= -0.095;
  };

  const closeTrade = (i: number, reason: FillReason) => {
    if (!trade) return;
    const pnl = trade.sellProceeds - trade.buyCost;
    trades.push({
      entryIndex: trade.entryIndex,
      entryDate: trade.entryDate,
      exitIndex: i,
      exitDate: bars[i].date,
      entryPrice: trade.buyValue / trade.buyShares,
      exitPrice: trade.sellValue / Math.max(trade.sellShares, 1),
      shares: trade.maxShares,
      pnl,
      returnPct: trade.buyCost > 0 ? pnl / trade.buyCost : 0,
      holdingBars: i - trade.entryIndex,
      exitReason: reason,
      open: false,
    });
    trade = null;
  };

  const buy = (i: number, rawPrice: number, qty: number, reason: FillReason) => {
    const price = rawPrice * (1 + config.slippage);
    const value = qty * price;
    const f = fee(value, 'buy');
    cash -= value + f;
    avgCost = (avgCost * shares + value) / (shares + qty);
    if (shares === 0) peak = rawPrice;
    shares += qty;
    boughtToday += qty;
    fills.push({ index: i, date: bars[i].date, side: 'buy', price, shares: qty, value, fee: f, reason });
    if (!trade) {
      trade = {
        entryIndex: i,
        entryDate: bars[i].date,
        buyCost: 0,
        buyShares: 0,
        buyValue: 0,
        sellProceeds: 0,
        sellShares: 0,
        sellValue: 0,
        maxShares: 0,
      };
    }
    trade.buyCost += value + f;
    trade.buyShares += qty;
    trade.buyValue += value;
    trade.maxShares = Math.max(trade.maxShares, shares);
  };

  const sell = (i: number, rawPrice: number, qty: number, reason: FillReason) => {
    const price = rawPrice * (1 - config.slippage);
    const value = qty * price;
    const f = fee(value, 'sell');
    cash += value - f;
    shares -= qty;
    fills.push({ index: i, date: bars[i].date, side: 'sell', price, shares: qty, value, fee: f, reason });
    if (trade) {
      trade.sellProceeds += value - f;
      trade.sellShares += qty;
      trade.sellValue += value;
    }
    if (shares === 0) {
      avgCost = 0;
      peak = 0;
      closeTrade(i, reason);
    }
  };

  const sellable = () => (config.tPlusOne ? Math.max(0, shares - boughtToday) : shares);
  const entryIndex = () => (trade ? trade.entryIndex : -1);

  /** 时间障碍：持仓超过 maxHoldBars 根 K 线，开盘离场 */
  const checkTime = (i: number) => {
    if (!(config.maxHoldBars > 0) || shares <= 0) return;
    const e = entryIndex();
    if (e < 0 || i - e < config.maxHoldBars) return;
    const qty = sellable();
    const price = bars[i].open;
    if (qty <= 0 || sellBlocked(i, price)) return;
    sell(i, price, qty, 'timeExit');
    if (shares === 0) {
      currentTarget = 0;
      riskBlocked = true;
    }
  };

  /** 调整到目标仓位，返回是否完全成交 */
  const rebalance = (i: number, price: number, target: number): boolean => {
    if (!(price > 0)) return false;
    const t = Math.min(1, Math.max(0, target));
    const eq = cash + shares * price;
    let desired: number;
    if (t <= EPS) desired = 0;
    else desired = Math.floor((t * eq) / (price * (1 + config.slippage)) / lot) * lot;

    if (desired > shares) {
      if (buyBlocked(i, price)) return false;
      let qty = desired - shares;
      const p = price * (1 + config.slippage);
      while (qty > 0 && qty * p + fee(qty * p, 'buy') > cash + EPS) qty -= lot;
      if (qty <= 0) return true; // 资金不足一手，视为已执行，避免每日重复尝试
      buy(i, price, qty, 'signal');
      return true;
    }
    if (desired < shares) {
      if (sellBlocked(i, price)) return false;
      const want = shares - desired;
      const qty = Math.min(want, sellable());
      if (qty <= 0) return false;
      sell(i, price, qty, 'signal');
      return qty === want;
    }
    return true;
  };

  /** 盘中风控：止损 / 止盈 / 移动止损 */
  const checkRisk = (i: number) => {
    if (shares <= 0) return;
    const bar = bars[i];
    const qty = sellable();
    if (qty <= 0) return;
    let trigger: { price: number; reason: FillReason } | null = null;
    if (config.stopLoss > 0) {
      const sp = avgCost / (1 + config.slippage) * (1 - config.stopLoss);
      if (bar.low <= sp) trigger = { price: Math.min(bar.open, sp), reason: 'stopLoss' };
    }
    if (!trigger && config.trailingStop > 0 && peak > 0) {
      const sp = peak * (1 - config.trailingStop);
      if (bar.low <= sp) trigger = { price: Math.min(bar.open, sp), reason: 'trailingStop' };
    }
    if (!trigger && config.takeProfit > 0) {
      const tp = avgCost / (1 + config.slippage) * (1 + config.takeProfit);
      if (bar.high >= tp) trigger = { price: Math.max(bar.open, tp), reason: 'takeProfit' };
    }
    if (!trigger) return;
    if (sellBlocked(i, trigger.price)) return;
    sell(i, trigger.price, qty, trigger.reason);
    if (shares === 0) {
      currentTarget = 0;
      riskBlocked = true;
    }
  };

  const applyTarget = (i: number, price: number, target: number) => {
    if (!Number.isFinite(target)) target = 0;
    if (riskBlocked) {
      if (target <= EPS) riskBlocked = false;
      else return;
    }
    if (Math.abs(target - currentTarget) < 1e-6) return;
    if (rebalance(i, price, target)) currentTarget = target;
  };

  const base = bars[start]?.close ?? 1;

  for (let i = start; i <= end; i++) {
    const bar = bars[i];
    boughtToday = 0;

    if (config.execution === 'nextOpen' && i > start) {
      applyTarget(i, bar.open, positions[i - 1]);
    }

    checkTime(i);
    checkRisk(i);

    if (config.execution === 'close') {
      applyTarget(i, bar.close, positions[i]);
    }

    if (shares > 0) peak = Math.max(peak, bar.high);

    const eq = cash + shares * bar.close;
    dates.push(bar.date);
    equity.push(eq);
    benchmark.push((config.initialCapital * bar.close) / base);
    exposure.push(eq > 0 ? (shares * bar.close) / eq : 0);
  }

  // 未平仓交易
  const openTrade = trade as OpenTrade | null;
  if (openTrade && shares > 0) {
    const last = bars[end];
    const marketValue = shares * last.close;
    const pnl = openTrade.sellProceeds + marketValue - openTrade.buyCost;
    trades.push({
      entryIndex: openTrade.entryIndex,
      entryDate: openTrade.entryDate,
      exitIndex: end,
      exitDate: last.date,
      entryPrice: openTrade.buyValue / openTrade.buyShares,
      exitPrice: last.close,
      shares: openTrade.maxShares,
      pnl,
      returnPct: openTrade.buyCost > 0 ? pnl / openTrade.buyCost : 0,
      holdingBars: end - openTrade.entryIndex,
      exitReason: 'open',
      open: true,
    });
  }

  const drawdown = drawdownSeries(equity);
  const benchmarkDrawdown = drawdownSeries(benchmark);
  const metrics = computeMetrics({
    dates,
    equity,
    benchmark,
    exposure,
    trades,
    fills,
    initialCapital: config.initialCapital,
    periodsPerYear: periodsPerYear(period),
    riskFreeRate: config.riskFreeRate,
  });

  return {
    dates,
    equity,
    benchmark,
    exposure,
    drawdown,
    benchmarkDrawdown,
    fills,
    trades,
    metrics,
    config,
    period,
    startIndex: start,
  };
}
