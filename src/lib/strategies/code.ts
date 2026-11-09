import * as ta from '../indicators';
import type { Bar } from '../types';
import { stateMachine } from './builtin';
import type { Overlay, ParamDef, StrategyDef, StrategyOutput } from './types';

export const CODE_TEMPLATE = `// 自定义 JavaScript 策略
// 返回每根 K 线收盘后的目标仓位数组：0 = 空仓，1 = 满仓，0~1 之间为部分仓位。
// 可用变量：bars（K 线数组）、open / high / low / close / volume（数值数组）、params（参数）、ta（指标库）
// ta 提供：sma ema wma stdev highest lowest ref macd rsi boll kdj atr roc bias cci obv williamsR superTrend
//          crossOver(a, b, i) crossUnder(a, b, i) stateMachine(n, 入场函数, 离场函数)
// 参数声明（会出现在参数面板，也可用于参数优化）：
// @param 名称 默认值 最小值 最大值 步长 显示名
// @param fast 10 2 60 1 短期均线
// @param slow 30 5 250 1 长期均线
// @param rsiMax 75 50 95 1 RSI过热阈值

const maFast = ta.sma(close, params.fast);
const maSlow = ta.sma(close, params.slow);
const r = ta.rsi(close, 14);

const position = ta.stateMachine(
  close.length,
  (i) => ta.crossOver(maFast, maSlow, i) && r[i] < params.rsiMax, // 金叉且不过热时买入
  (i) => ta.crossUnder(maFast, maSlow, i),                         // 死叉卖出
);

return {
  position,
  overlays: [
    { name: 'MA' + params.fast, data: maFast, pane: 'main' },
    { name: 'MA' + params.slow, data: maSlow, pane: 'main' },
    { name: 'RSI14', data: r, pane: 'sub' },
  ],
  subLevels: [params.rsiMax],
};
`;

/** 解析代码中的 // @param 声明 */
export function parseCodeParams(code: string): ParamDef[] {
  const out: ParamDef[] = [];
  const re = /^\s*\/\/\s*@param\s+([A-Za-z_$][\w$]*)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s*(.*)$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    const [, key, def, min, max, step, label] = m;
    if (out.some((p) => p.key === key)) continue;
    out.push({
      key,
      default: Number(def),
      min: Number(min),
      max: Number(max),
      step: Number(step) || 1,
      label: label.trim() || key,
    });
  }
  return out;
}

const TA = { ...ta, stateMachine };

export function compileCode(code: string) {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function('bars', 'open', 'high', 'low', 'close', 'volume', 'params', 'ta', '"use strict";\n' + code) as (
    ...args: unknown[]
  ) => unknown;
}

export function runCode(code: string, bars: Bar[], params: Record<string, number>): StrategyOutput {
  const fn = compileCode(code);
  const c = ta.columns(bars);
  const res = fn(bars, c.open, c.high, c.low, c.close, c.volume, { ...params }, TA);
  let position: unknown;
  let overlays: Overlay[] = [];
  let subLevels: number[] | undefined;
  if (Array.isArray(res)) position = res;
  else if (res && typeof res === 'object') {
    const r = res as { position?: unknown; overlays?: unknown; subLevels?: unknown };
    position = r.position;
    if (Array.isArray(r.overlays)) {
      overlays = (r.overlays as Partial<Overlay>[])
        .filter((o) => o && Array.isArray(o.data))
        .map((o, i) => ({
          name: String(o.name ?? `指标${i + 1}`),
          data: (o.data as unknown[]).map(Number),
          pane: o.pane === 'sub' ? 'sub' : 'main',
          kind: o.kind,
          color: o.color,
        }));
    }
    if (Array.isArray(r.subLevels)) subLevels = (r.subLevels as unknown[]).map(Number).filter(Number.isFinite);
  }
  if (!Array.isArray(position)) throw new Error('策略必须返回仓位数组，或 { position: [...] } 对象');
  if (position.length !== bars.length)
    throw new Error(`仓位数组长度 (${position.length}) 与 K 线数量 (${bars.length}) 不一致`);
  const pos = position.map((v) => {
    const x = typeof v === 'boolean' ? (v ? 1 : 0) : Number(v);
    return Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0;
  });
  return { position: pos, overlays, subLevels };
}

export function codeStrategy(id: string, name: string, code: string): StrategyDef {
  return {
    id,
    name,
    category: '自定义',
    summary: '用 JavaScript 编写的自定义策略',
    description: '用 JavaScript 编写的自定义策略，代码在浏览器本地运行。',
    params: parseCodeParams(code),
    run: (bars, params) => runCode(code, bars, params),
  };
}
