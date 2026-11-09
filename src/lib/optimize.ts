import { runBacktest } from './backtest/engine';
import { rangeToIndex, type DateRange } from './backtest/run';
import type { BacktestConfig, Metrics } from './backtest/types';
import { paramsValid, resolveStrategy, type StrategySpec } from './strategies';
import { normalizeParams, type Params } from './strategies/types';
import type { Bar, Period } from './types';

export type Objective = 'sharpe' | 'totalReturn' | 'annualReturn' | 'calmar' | 'sortino' | 'maxDrawdown' | 'winRate';

export const OBJECTIVES: { key: Objective; label: string }[] = [
  { key: 'sharpe', label: '夏普比率' },
  { key: 'annualReturn', label: '年化收益' },
  { key: 'totalReturn', label: '总收益' },
  { key: 'calmar', label: '卡玛比率' },
  { key: 'sortino', label: '索提诺比率' },
  { key: 'maxDrawdown', label: '最大回撤（越小越好）' },
  { key: 'winRate', label: '胜率' },
];

export interface Axis {
  key: string;
  from: number;
  to: number;
  step: number;
}

export interface OptimizeRequest {
  spec: StrategySpec;
  bars: Bar[];
  baseParams: Params;
  axes: Axis[];
  config: BacktestConfig;
  period: Period;
  range: DateRange;
  /** 样本内比例，0 表示不划分；0.7 表示前 70% 用于优化、后 30% 用于验证 */
  splitRatio: number;
  objective: Objective;
  /** 每笔交易最少次数，低于则视为无效 */
  minTrades: number;
}

export type MetricSummary = Pick<
  Metrics,
  'totalReturn' | 'annualReturn' | 'sharpe' | 'sortino' | 'maxDrawdown' | 'calmar' | 'winRate' | 'tradeCount' | 'profitFactor'
>;

export interface OptimizeRow {
  params: Params;
  is: MetricSummary;
  oos?: MetricSummary;
  score: number;
}

export interface OptimizeResult {
  rows: OptimizeRow[];
  axes: Axis[];
  axisValues: number[][];
  splitDate?: string;
  isRange: [string, string];
  oosRange?: [string, string];
  total: number;
  skipped: number;
  elapsedMs: number;
}

export const MAX_COMBOS = 2500;

export function axisValues(a: Axis): number[] {
  const out: number[] = [];
  if (!(a.step > 0)) return [a.from];
  const lo = Math.min(a.from, a.to);
  const hi = Math.max(a.from, a.to);
  const decimals = (String(a.step).split('.')[1] ?? '').length;
  for (let v = lo, k = 0; v <= hi + 1e-9 && k < 1000; k++, v = lo + k * a.step) {
    out.push(Number(v.toFixed(decimals)));
  }
  return out;
}

const summarize = (m: Metrics): MetricSummary => ({
  totalReturn: m.totalReturn,
  annualReturn: m.annualReturn,
  sharpe: m.sharpe,
  sortino: m.sortino,
  maxDrawdown: m.maxDrawdown,
  calmar: m.calmar,
  winRate: m.winRate,
  tradeCount: m.tradeCount,
  profitFactor: m.profitFactor,
});

export function scoreOf(m: MetricSummary, objective: Objective): number {
  switch (objective) {
    case 'maxDrawdown':
      return m.maxDrawdown; // 回撤为负数，越接近 0 越好
    default:
      return m[objective];
  }
}

export function runOptimize(req: OptimizeRequest, onProgress?: (done: number, total: number) => void): OptimizeResult {
  const t0 = Date.now();
  const def = resolveStrategy(req.spec);
  const { start, end } = rangeToIndex(req.bars, req.range);
  const values = req.axes.map(axisValues);
  const total = values.reduce((n, v) => n * v.length, 1);
  if (total > MAX_COMBOS) throw new Error(`参数组合过多（${total}），请缩小范围或增大步长，上限 ${MAX_COMBOS}`);

  const split = req.splitRatio > 0 && req.splitRatio < 1 ? start + Math.floor((end - start + 1) * req.splitRatio) : end + 1;
  const isEnd = Math.min(end, split - 1);
  const hasOOS = split <= end;

  const rows: OptimizeRow[] = [];
  let skipped = 0;
  let done = 0;
  const idx = new Array(values.length).fill(0);
  for (let c = 0; c < total; c++) {
    let rem = c;
    for (let a = values.length - 1; a >= 0; a--) {
      idx[a] = rem % values[a].length;
      rem = Math.floor(rem / values[a].length);
    }
    const p: Params = { ...req.baseParams };
    req.axes.forEach((ax, a) => (p[ax.key] = values[a][idx[a]]));
    const np = normalizeParams(def, p);
    const valid = req.spec.type === 'builtin' ? paramsValid(def.id, np) : true;
    if (!valid) {
      skipped++;
    } else {
      const out = def.run(req.bars, np);
      const isRes = runBacktest(req.bars, out.position, req.config, { start, end: isEnd, period: req.period });
      const is = summarize(isRes.metrics);
      let oos: MetricSummary | undefined;
      if (hasOOS) {
        const oosRes = runBacktest(req.bars, out.position, req.config, { start: split, end, period: req.period });
        oos = summarize(oosRes.metrics);
      }
      const score = is.tradeCount < req.minTrades ? -Infinity : scoreOf(is, req.objective);
      rows.push({ params: np, is, oos, score });
    }
    done++;
    if (onProgress && (done % 20 === 0 || done === total)) onProgress(done, total);
  }
  rows.sort((a, b) => b.score - a.score);
  return {
    rows,
    axes: req.axes,
    axisValues: values,
    splitDate: hasOOS ? req.bars[split].date : undefined,
    isRange: [req.bars[start].date, req.bars[isEnd].date],
    oosRange: hasOOS ? [req.bars[split].date, req.bars[end].date] : undefined,
    total,
    skipped,
    elapsedMs: Date.now() - t0,
  };
}
