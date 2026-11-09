import type { Bar } from '../types';

export interface ParamDef {
  key: string;
  label: string;
  default: number;
  min: number;
  max: number;
  step: number;
  /** 下拉选项（若提供则渲染为选择框） */
  options?: { value: number; label: string }[];
  hint?: string;
}

export type Params = Record<string, number>;

export interface Overlay {
  name: string;
  data: number[];
  /** main：叠加在 K 线上；sub：显示在副图 */
  pane: 'main' | 'sub';
  kind?: 'line' | 'bar' | 'dashed';
  color?: string;
}

export interface StrategyOutput {
  /** 每根 K 线收盘后的目标仓位 0~1 */
  position: number[];
  overlays: Overlay[];
  /** 副图参考水平线，如 RSI 的 30 / 70 */
  subLevels?: number[];
}

export type StrategyCategory = '趋势跟踪' | '均值回归' | '动量' | '波动率' | '网格' | '基准' | '自定义';

export interface StrategyDef {
  id: string;
  name: string;
  category: StrategyCategory;
  /** 一句话简介 */
  summary: string;
  /** 详细说明：原理、买卖规则、适用行情 */
  description: string;
  params: ParamDef[];
  run(bars: Bar[], params: Params): StrategyOutput;
}

export function defaultParams(def: { params: ParamDef[] }): Params {
  const p: Params = {};
  for (const d of def.params) p[d.key] = d.default;
  return p;
}

/** 补全缺失参数并裁剪到合法范围 */
export function normalizeParams(def: { params: ParamDef[] }, params: Params | undefined): Params {
  const p: Params = {};
  for (const d of def.params) {
    const v = params?.[d.key];
    p[d.key] = Number.isFinite(v) ? Math.min(d.max, Math.max(d.min, v as number)) : d.default;
  }
  return p;
}
