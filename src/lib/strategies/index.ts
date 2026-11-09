import { BUILTIN_STRATEGIES } from './builtin';
import { codeStrategy } from './code';
import { ruleStrategy, type RuleSet } from './rules';
import type { Params, StrategyDef } from './types';

export * from './types';
export { BUILTIN_STRATEGIES } from './builtin';

/** 用户保存的自定义策略 */
export interface CustomStrategy {
  id: string;
  name: string;
  kind: 'rule' | 'code';
  rules?: RuleSet;
  code?: string;
  createdAt: number;
  updatedAt: number;
}

/** 可序列化的策略引用，可传入 Web Worker */
export type StrategySpec =
  | { type: 'builtin'; id: string }
  | { type: 'custom'; custom: CustomStrategy };

export function customToDef(c: CustomStrategy): StrategyDef {
  if (c.kind === 'code') return codeStrategy(c.id, c.name, c.code ?? '');
  return ruleStrategy(c.id, c.name, c.rules ?? { entry: { logic: 'and', conditions: [] }, exit: { logic: 'and', conditions: [] } });
}

export function resolveStrategy(spec: StrategySpec): StrategyDef {
  if (spec.type === 'custom') return customToDef(spec.custom);
  const def = BUILTIN_STRATEGIES.find((s) => s.id === spec.id);
  if (!def) throw new Error(`未知策略：${spec.id}`);
  return def;
}

/** 参数约束：例如短均线必须小于长均线。返回 false 的组合在优化时跳过。 */
export function paramsValid(id: string, p: Params): boolean {
  switch (id) {
    case 'ma_cross':
    case 'macd':
      return p.fast < p.slow;
    case 'ma_trend':
      return p.s < p.m && p.m < p.l;
    case 'rsi':
      return p.lower < p.upper;
    case 'kdj':
      return p.low <= p.high;
    case 'bias':
      return p.buy < p.sell;
    default:
      if ('fast' in p && 'slow' in p) return p.fast < p.slow;
      return true;
  }
}
