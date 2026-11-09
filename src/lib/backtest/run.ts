import type { Bar, Period } from '../types';
import type { Params, StrategyDef, StrategyOutput } from '../strategies/types';
import { normalizeParams } from '../strategies/types';
import { runBacktest } from './engine';
import type { BacktestConfig, BacktestResult } from './types';

export interface DateRange {
  start?: string;
  end?: string;
}

/** 把日期区间换算为 K 线下标 */
export function rangeToIndex(bars: Bar[], range: DateRange): { start: number; end: number } {
  let start = 0;
  let end = bars.length - 1;
  if (range.start) {
    const i = bars.findIndex((b) => b.date >= range.start!);
    start = i < 0 ? bars.length - 1 : i;
  }
  if (range.end) {
    for (let i = bars.length - 1; i >= 0; i--) {
      if (bars[i].date <= range.end) {
        end = i;
        break;
      }
    }
  }
  return { start: Math.min(start, end), end };
}

export interface StrategyRun {
  output: StrategyOutput;
  result: BacktestResult;
  params: Params;
}

/** 运行策略并回测。指标在完整数据上计算（保证预热），回测只在区间内进行。 */
export function backtestStrategy(
  def: StrategyDef,
  bars: Bar[],
  params: Params | undefined,
  config: BacktestConfig,
  period: Period,
  range: DateRange = {},
): StrategyRun {
  const p = normalizeParams(def, params);
  const output = def.run(bars, p);
  const { start, end } = rangeToIndex(bars, range);
  const result = runBacktest(bars, output.position, config, { start, end, period });
  return { output, result, params: p };
}
