import { columns, crossOver, crossUnder, type Series } from '../indicators';
import type { Bar } from '../types';
import { stateMachine } from './builtin';
import { INDICATOR_MAP } from './catalog';
import type { Overlay, StrategyDef } from './types';

export type Operand =
  | { kind: 'ind'; ind: string; params: number[]; output?: string }
  | { kind: 'const'; value: number };

export type CompareOp = '>' | '<' | '>=' | '<=' | 'crossOver' | 'crossUnder';

export interface Condition {
  left: Operand;
  op: CompareOp;
  right: Operand;
}

export interface ConditionGroup {
  logic: 'and' | 'or';
  conditions: Condition[];
}

export interface RuleSet {
  entry: ConditionGroup;
  exit: ConditionGroup;
}

export const OP_LABELS: Record<CompareOp, string> = {
  '>': '大于',
  '<': '小于',
  '>=': '大于等于',
  '<=': '小于等于',
  crossOver: '上穿',
  crossUnder: '下穿',
};

export function operandKey(o: Operand): string {
  if (o.kind === 'const') return `#${o.value}`;
  return `${o.ind}(${o.params.join(',')})${o.output ? '.' + o.output : ''}`;
}

export function operandLabel(o: Operand): string {
  if (o.kind === 'const') return String(o.value);
  const spec = INDICATOR_MAP[o.ind];
  if (!spec) return o.ind;
  const outLabel = o.output ? spec.outputs?.find((x) => x.key === o.output)?.label : '';
  const name = spec.id === 'CLOSE' ? '收盘价' : spec.id;
  const p = o.params.length ? `(${o.params.join(',')})` : '';
  return `${name}${p}${outLabel ? '.' + outLabel : ''}`;
}

export function describeGroup(g: ConditionGroup): string {
  if (!g.conditions.length) return '（无条件）';
  return g.conditions
    .map((c) => `${operandLabel(c.left)} ${OP_LABELS[c.op]} ${operandLabel(c.right)}`)
    .join(g.logic === 'and' ? ' 且 ' : ' 或 ');
}

function evalOperand(o: Operand, cols: ReturnType<typeof columns>, cache: Map<string, Series>): Series {
  const key = operandKey(o);
  const hit = cache.get(key);
  if (hit) return hit;
  let s: Series;
  if (o.kind === 'const') {
    s = new Array<number>(cols.close.length).fill(o.value);
  } else {
    const spec = INDICATOR_MAP[o.ind];
    if (!spec) throw new Error(`未知指标：${o.ind}`);
    const params = spec.params.map((ps, i) => (Number.isFinite(o.params[i]) ? o.params[i] : ps.default));
    const out = spec.compute(cols, params);
    s = out[o.output ?? 'v'] ?? out[Object.keys(out)[0]];
  }
  cache.set(key, s);
  return s;
}

function compileGroup(g: ConditionGroup, cols: ReturnType<typeof columns>, cache: Map<string, Series>) {
  const compiled = g.conditions.map((c) => {
    const a = evalOperand(c.left, cols, cache);
    const b = evalOperand(c.right, cols, cache);
    switch (c.op) {
      case '>':
        return (i: number) => a[i] > b[i];
      case '<':
        return (i: number) => a[i] < b[i];
      case '>=':
        return (i: number) => a[i] >= b[i];
      case '<=':
        return (i: number) => a[i] <= b[i];
      case 'crossOver':
        return (i: number) => crossOver(a, b, i);
      case 'crossUnder':
        return (i: number) => crossUnder(a, b, i);
    }
  });
  if (!compiled.length) return () => false;
  return g.logic === 'and'
    ? (i: number) => compiled.every((f) => f(i))
    : (i: number) => compiled.some((f) => f(i));
}

const OVERLAY_COLORS = ['#e0a526', '#4f8fe8', '#b26ad6', '#3fb7a5', '#d9734e', '#8fa3c0'];

export function runRules(rules: RuleSet, bars: Bar[]) {
  const cols = columns(bars);
  const cache = new Map<string, Series>();
  const entry = compileGroup(rules.entry, cols, cache);
  const exit = compileGroup(rules.exit, cols, cache);
  const position = stateMachine(bars.length, entry, exit);

  const overlays: Overlay[] = [];
  const seen = new Set<string>();
  const all = [...rules.entry.conditions, ...rules.exit.conditions].flatMap((c) => [c.left, c.right]);
  let ci = 0;
  for (const o of all) {
    if (o.kind !== 'ind' || o.ind === 'CLOSE') continue;
    const key = operandKey(o);
    if (seen.has(key)) continue;
    seen.add(key);
    const spec = INDICATOR_MAP[o.ind];
    if (!spec) continue;
    overlays.push({
      name: operandLabel(o),
      data: cache.get(key) ?? [],
      pane: spec.pane,
      color: OVERLAY_COLORS[ci++ % OVERLAY_COLORS.length],
    });
  }
  // 副图参考线：与副图指标比较的常数
  const subLevels: number[] = [];
  for (const c of [...rules.entry.conditions, ...rules.exit.conditions]) {
    const pair = [c.left, c.right];
    const ind = pair.find((x) => x.kind === 'ind') as Extract<Operand, { kind: 'ind' }> | undefined;
    const cst = pair.find((x) => x.kind === 'const') as Extract<Operand, { kind: 'const' }> | undefined;
    if (ind && cst && INDICATOR_MAP[ind.ind]?.pane === 'sub' && !subLevels.includes(cst.value)) subLevels.push(cst.value);
  }
  return { position, overlays, subLevels };
}

export function ruleStrategy(id: string, name: string, rules: RuleSet): StrategyDef {
  return {
    id,
    name,
    category: '自定义',
    summary: `买入：${describeGroup(rules.entry)}；卖出：${describeGroup(rules.exit)}`,
    description: `由规则构建器生成的自定义策略。\n买入条件：${describeGroup(rules.entry)}\n卖出条件：${describeGroup(rules.exit)}`,
    params: [],
    run: (bars) => runRules(rules, bars),
  };
}

export const SAMPLE_RULES: RuleSet = {
  entry: {
    logic: 'and',
    conditions: [
      { left: { kind: 'ind', ind: 'MA', params: [5] }, op: 'crossOver', right: { kind: 'ind', ind: 'MA', params: [20] } },
      { left: { kind: 'ind', ind: 'RSI', params: [14] }, op: '<', right: { kind: 'const', value: 70 } },
    ],
  },
  exit: {
    logic: 'or',
    conditions: [
      { left: { kind: 'ind', ind: 'MA', params: [5] }, op: 'crossUnder', right: { kind: 'ind', ind: 'MA', params: [20] } },
      { left: { kind: 'ind', ind: 'RSI', params: [14] }, op: '>', right: { kind: 'const', value: 85 } },
    ],
  },
};
