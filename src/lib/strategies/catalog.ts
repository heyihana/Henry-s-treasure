import * as ta from '../indicators';
import type { Series } from '../indicators';

type Cols = ReturnType<typeof ta.columns>;

export interface IndicatorParamSpec {
  label: string;
  default: number;
  min: number;
  max: number;
  step: number;
}

export interface IndicatorSpec {
  id: string;
  label: string;
  /** 价格类指标叠加在主图，其余在副图 */
  pane: 'main' | 'sub';
  params: IndicatorParamSpec[];
  outputs?: { key: string; label: string }[];
  compute(c: Cols, p: number[]): Record<string, Series>;
}

const P = (label: string, def: number, min = 1, max = 250, step = 1): IndicatorParamSpec => ({
  label,
  default: def,
  min,
  max,
  step,
});

/** 规则构建器可用的指标目录 */
export const INDICATOR_CATALOG: IndicatorSpec[] = [
  { id: 'CLOSE', label: '收盘价', pane: 'main', params: [], compute: (c) => ({ v: c.close }) },
  { id: 'OPEN', label: '开盘价', pane: 'main', params: [], compute: (c) => ({ v: c.open }) },
  { id: 'HIGH', label: '最高价', pane: 'main', params: [], compute: (c) => ({ v: c.high }) },
  { id: 'LOW', label: '最低价', pane: 'main', params: [], compute: (c) => ({ v: c.low }) },
  {
    id: 'CHG',
    label: '涨跌幅%',
    pane: 'sub',
    params: [],
    compute: (c) => ({ v: c.close.map((x, i) => (i ? (x / c.close[i - 1] - 1) * 100 : NaN)) }),
  },
  { id: 'MA', label: '均线 MA', pane: 'main', params: [P('周期', 20)], compute: (c, p) => ({ v: ta.sma(c.close, p[0]) }) },
  { id: 'EMA', label: '指数均线 EMA', pane: 'main', params: [P('周期', 20)], compute: (c, p) => ({ v: ta.ema(c.close, p[0]) }) },
  {
    id: 'HHV',
    label: 'N日最高价(不含当日)',
    pane: 'main',
    params: [P('周期', 20)],
    compute: (c, p) => ({ v: ta.ref(ta.highest(c.high, p[0]), 1) }),
  },
  {
    id: 'LLV',
    label: 'N日最低价(不含当日)',
    pane: 'main',
    params: [P('周期', 20)],
    compute: (c, p) => ({ v: ta.ref(ta.lowest(c.low, p[0]), 1) }),
  },
  {
    id: 'BOLL',
    label: '布林带 BOLL',
    pane: 'main',
    params: [P('周期', 20), P('倍数', 2, 0.5, 5, 0.1)],
    outputs: [
      { key: 'upper', label: '上轨' },
      { key: 'mid', label: '中轨' },
      { key: 'lower', label: '下轨' },
    ],
    compute: (c, p) => {
      const b = ta.boll(c.close, p[0], p[1]);
      return { upper: b.upper, mid: b.mid, lower: b.lower };
    },
  },
  { id: 'VOL', label: '成交量', pane: 'sub', params: [], compute: (c) => ({ v: c.volume }) },
  { id: 'VMA', label: '均量 VMA', pane: 'sub', params: [P('周期', 5)], compute: (c, p) => ({ v: ta.sma(c.volume, p[0]) }) },
  {
    id: 'MACD',
    label: 'MACD',
    pane: 'sub',
    params: [P('快线', 12, 2, 60), P('慢线', 26, 5, 120), P('信号线', 9, 2, 60)],
    outputs: [
      { key: 'dif', label: 'DIF' },
      { key: 'dea', label: 'DEA' },
      { key: 'hist', label: '柱' },
    ],
    compute: (c, p) => {
      const m = ta.macd(c.close, p[0], p[1], p[2]);
      return { dif: m.dif, dea: m.dea, hist: m.hist };
    },
  },
  { id: 'RSI', label: 'RSI', pane: 'sub', params: [P('周期', 14, 2, 100)], compute: (c, p) => ({ v: ta.rsi(c.close, p[0]) }) },
  {
    id: 'KDJ',
    label: 'KDJ',
    pane: 'sub',
    params: [P('周期', 9, 3, 60), P('K平滑', 3, 2, 10), P('D平滑', 3, 2, 10)],
    outputs: [
      { key: 'k', label: 'K' },
      { key: 'd', label: 'D' },
      { key: 'j', label: 'J' },
    ],
    compute: (c, p) => {
      const r = ta.kdj(c.high, c.low, c.close, p[0], p[1], p[2]);
      return { k: r.k, d: r.d, j: r.j };
    },
  },
  { id: 'ATR', label: 'ATR 波幅', pane: 'sub', params: [P('周期', 14)], compute: (c, p) => ({ v: ta.atr(c.high, c.low, c.close, p[0]) }) },
  { id: 'ROC', label: 'ROC 变动率%', pane: 'sub', params: [P('周期', 12)], compute: (c, p) => ({ v: ta.roc(c.close, p[0]) }) },
  { id: 'BIAS', label: 'BIAS 乖离率%', pane: 'sub', params: [P('周期', 6)], compute: (c, p) => ({ v: ta.bias(c.close, p[0]) }) },
  { id: 'CCI', label: 'CCI', pane: 'sub', params: [P('周期', 14)], compute: (c, p) => ({ v: ta.cci(c.high, c.low, c.close, p[0]) }) },
  { id: 'WR', label: '威廉 WR', pane: 'sub', params: [P('周期', 14)], compute: (c, p) => ({ v: ta.williamsR(c.high, c.low, c.close, p[0]) }) },
  { id: 'OBV', label: 'OBV 能量潮', pane: 'sub', params: [], compute: (c) => ({ v: ta.obv(c.close, c.volume) }) },
];

export const INDICATOR_MAP: Record<string, IndicatorSpec> = Object.fromEntries(INDICATOR_CATALOG.map((s) => [s.id, s]));
