import {
  atr,
  bias,
  boll,
  columns,
  crossOver,
  crossUnder,
  ema,
  highest,
  kdj,
  lowest,
  macd,
  ref,
  roc,
  rsi,
  sma,
  superTrend,
} from '../indicators';
import type { Bar } from '../types';
import type { StrategyDef, StrategyOutput } from './types';

/**
 * 根据入场 / 离场条件生成持仓状态（0 或 1）。
 * 第 i 根收盘时：空仓且满足入场 → 持仓；持仓且满足离场 → 空仓。
 */
export function stateMachine(n: number, entry: (i: number) => boolean, exit: (i: number) => boolean): number[] {
  const pos = new Array<number>(n).fill(0);
  let holding = false;
  for (let i = 0; i < n; i++) {
    if (!holding && entry(i)) holding = true;
    else if (holding && exit(i)) holding = false;
    pos[i] = holding ? 1 : 0;
  }
  return pos;
}

const maOf = (type: number) => (type === 1 ? ema : sma);

const C = {
  fast: '#e0a526',
  slow: '#4f8fe8',
  third: '#b26ad6',
  band: '#7b8aa6',
  mid: '#c0a062',
};

export const maCross: StrategyDef = {
  id: 'ma_cross',
  name: '双均线交叉',
  category: '趋势跟踪',
  summary: '短期均线上穿长期均线（金叉）买入，下穿（死叉）卖出。',
  description:
    '最经典的趋势跟踪策略。短均线反映近期价格，长均线反映中期趋势。短均线上穿长均线说明近期走强、趋势可能转多，买入；下穿说明转弱，卖出。在单边趋势行情中表现好，在横盘震荡中会因频繁交叉产生较多亏损交易（“假信号”）。',
  params: [
    { key: 'fast', label: '短期均线', default: 5, min: 2, max: 60, step: 1 },
    { key: 'slow', label: '长期均线', default: 20, min: 5, max: 250, step: 1 },
    {
      key: 'maType',
      label: '均线类型',
      default: 0,
      min: 0,
      max: 1,
      step: 1,
      options: [
        { value: 0, label: 'MA 简单均线' },
        { value: 1, label: 'EMA 指数均线' },
      ],
    },
  ],
  run(bars, p) {
    const { close } = columns(bars);
    const f = maOf(p.maType)(close, p.fast);
    const s = maOf(p.maType)(close, p.slow);
    const position = stateMachine(
      bars.length,
      (i) => crossOver(f, s, i),
      (i) => crossUnder(f, s, i),
    );
    return {
      position,
      overlays: [
        { name: `MA${p.fast}`, data: f, pane: 'main', color: C.fast },
        { name: `MA${p.slow}`, data: s, pane: 'main', color: C.slow },
      ],
    };
  },
};

export const macdCross: StrategyDef = {
  id: 'macd',
  name: 'MACD 金叉死叉',
  category: '趋势跟踪',
  summary: 'DIF 上穿 DEA 买入，下穿卖出，可选只做零轴上方的金叉。',
  description:
    'MACD 由快慢两条 EMA 之差（DIF）及其平滑线（DEA）构成。DIF 上穿 DEA 为金叉，代表上涨动能增强；下穿为死叉。开启“零轴过滤”后只在 DIF > 0（中期趋势向上）时接受金叉，能过滤掉一部分下跌趋势中的反弹信号。',
  params: [
    { key: 'fast', label: '快线周期', default: 12, min: 2, max: 50, step: 1 },
    { key: 'slow', label: '慢线周期', default: 26, min: 5, max: 120, step: 1 },
    { key: 'signal', label: '信号线周期', default: 9, min: 2, max: 50, step: 1 },
    {
      key: 'zeroFilter',
      label: '零轴过滤',
      default: 0,
      min: 0,
      max: 1,
      step: 1,
      options: [
        { value: 0, label: '关闭' },
        { value: 1, label: '只做零轴上方金叉' },
      ],
    },
  ],
  run(bars, p) {
    const { close } = columns(bars);
    const m = macd(close, p.fast, p.slow, p.signal);
    const position = stateMachine(
      bars.length,
      (i) => crossOver(m.dif, m.dea, i) && (!p.zeroFilter || m.dif[i] > 0),
      (i) => crossUnder(m.dif, m.dea, i),
    );
    return {
      position,
      overlays: [
        { name: 'DIF', data: m.dif, pane: 'sub', color: C.fast },
        { name: 'DEA', data: m.dea, pane: 'sub', color: C.slow },
        { name: 'MACD', data: m.hist, pane: 'sub', kind: 'bar' },
      ],
      subLevels: [0],
    };
  },
};

export const rsiReversal: StrategyDef = {
  id: 'rsi',
  name: 'RSI 超买超卖',
  category: '均值回归',
  summary: 'RSI 从超卖区向上回升时买入，进入超买区后卖出。',
  description:
    'RSI 衡量一段时间内上涨幅度占总波动的比例，取值 0~100。低于下限（如 30）视为超卖，高于上限（如 70）视为超买。策略在 RSI 由下向上穿越超卖线时买入（等待反弹确认），在 RSI 向上触及超买线时卖出。适合区间震荡的股票，在强趋势中可能过早卖出或逆势抄底。',
  params: [
    { key: 'period', label: 'RSI 周期', default: 14, min: 2, max: 60, step: 1 },
    { key: 'lower', label: '超卖线', default: 30, min: 5, max: 50, step: 1 },
    { key: 'upper', label: '超买线', default: 70, min: 50, max: 95, step: 1 },
  ],
  run(bars, p) {
    const { close } = columns(bars);
    const r = rsi(close, p.period);
    const lo = new Array<number>(bars.length).fill(p.lower);
    const position = stateMachine(
      bars.length,
      (i) => crossOver(r, lo, i),
      (i) => r[i] >= p.upper,
    );
    return {
      position,
      overlays: [{ name: `RSI${p.period}`, data: r, pane: 'sub', color: C.fast }],
      subLevels: [p.lower, p.upper],
    };
  },
};

export const bollReversion: StrategyDef = {
  id: 'boll_revert',
  name: '布林带均值回归',
  category: '均值回归',
  summary: '收盘跌破下轨买入，回到中轨（或上轨）卖出。',
  description:
    '布林带以 N 日均线为中轨、上下各加减 K 倍标准差。价格跌破下轨意味着短期偏离过大，策略押注价格回归均值：跌破下轨买入，回升到中轨或上轨卖出。在震荡市有效，单边下跌时可能持续“越跌越破”，建议配合止损使用。',
  params: [
    { key: 'period', label: '均线周期', default: 20, min: 5, max: 120, step: 1 },
    { key: 'k', label: '标准差倍数', default: 2, min: 0.5, max: 4, step: 0.1 },
    {
      key: 'exitAt',
      label: '卖出位置',
      default: 0,
      min: 0,
      max: 1,
      step: 1,
      options: [
        { value: 0, label: '回到中轨' },
        { value: 1, label: '触及上轨' },
      ],
    },
  ],
  run(bars, p) {
    const { close } = columns(bars);
    const b = boll(close, p.period, p.k);
    const position = stateMachine(
      bars.length,
      (i) => close[i] < b.lower[i],
      (i) => close[i] >= (p.exitAt ? b.upper[i] : b.mid[i]),
    );
    return {
      position,
      overlays: [
        { name: '上轨', data: b.upper, pane: 'main', color: C.band, kind: 'dashed' },
        { name: '中轨', data: b.mid, pane: 'main', color: C.mid },
        { name: '下轨', data: b.lower, pane: 'main', color: C.band, kind: 'dashed' },
      ],
    };
  },
};

export const bollBreakout: StrategyDef = {
  id: 'boll_breakout',
  name: '布林带突破',
  category: '波动率',
  summary: '收盘突破上轨买入（波动放大、趋势启动），跌破中轨卖出。',
  description:
    '与均值回归相反的思路：价格放量突破上轨往往意味着新趋势的开始。突破上轨时买入，跌回中轨下方时卖出。适合有明显趋势爆发的个股，震荡市中容易“假突破”。',
  params: [
    { key: 'period', label: '均线周期', default: 20, min: 5, max: 120, step: 1 },
    { key: 'k', label: '标准差倍数', default: 2, min: 0.5, max: 4, step: 0.1 },
  ],
  run(bars, p) {
    const { close } = columns(bars);
    const b = boll(close, p.period, p.k);
    const position = stateMachine(
      bars.length,
      (i) => close[i] > b.upper[i],
      (i) => close[i] < b.mid[i],
    );
    return {
      position,
      overlays: [
        { name: '上轨', data: b.upper, pane: 'main', color: C.band, kind: 'dashed' },
        { name: '中轨', data: b.mid, pane: 'main', color: C.mid },
        { name: '下轨', data: b.lower, pane: 'main', color: C.band, kind: 'dashed' },
      ],
    };
  },
};

export const turtle: StrategyDef = {
  id: 'turtle',
  name: '海龟交易（唐奇安通道）',
  category: '趋势跟踪',
  summary: '突破过去 N 日最高价买入，跌破过去 M 日最低价或 ATR 止损卖出。',
  description:
    '来自著名的“海龟交易法则”。收盘价突破过去 N 日（不含当日）最高价时入场，跌破过去 M 日最低价时离场；同时可设置以入场时 ATR（平均真实波幅）为单位的止损，例如跌破“入场价 − 2×ATR”立即离场。这是纯粹的突破型趋势策略，胜率通常不高，但依靠少数大趋势获取盈利。',
  params: [
    { key: 'entry', label: '突破周期 N', default: 20, min: 5, max: 120, step: 1 },
    { key: 'exit', label: '离场周期 M', default: 10, min: 3, max: 60, step: 1 },
    { key: 'atrStop', label: 'ATR 止损倍数', default: 2, min: 0, max: 6, step: 0.5, hint: '0 表示不使用 ATR 止损' },
  ],
  run(bars, p) {
    const { high, low, close } = columns(bars);
    const upper = ref(highest(high, p.entry), 1);
    const lower = ref(lowest(low, p.exit), 1);
    const a = atr(high, low, close, 20);
    const n = bars.length;
    const position = new Array<number>(n).fill(0);
    let holding = false;
    let stop = -Infinity;
    for (let i = 0; i < n; i++) {
      if (!holding) {
        if (close[i] > upper[i]) {
          holding = true;
          stop = p.atrStop > 0 && Number.isFinite(a[i]) ? close[i] - p.atrStop * a[i] : -Infinity;
        }
      } else if (close[i] < lower[i] || close[i] < stop) {
        holding = false;
      }
      position[i] = holding ? 1 : 0;
    }
    return {
      position,
      overlays: [
        { name: `${p.entry}日高`, data: upper, pane: 'main', color: C.fast, kind: 'dashed' },
        { name: `${p.exit}日低`, data: lower, pane: 'main', color: C.slow, kind: 'dashed' },
      ],
    };
  },
};

export const kdjCross: StrategyDef = {
  id: 'kdj',
  name: 'KDJ 金叉死叉',
  category: '均值回归',
  summary: 'K 线在低位上穿 D 线买入，在高位下穿 D 线卖出。',
  description:
    'KDJ 随机指标反映收盘价在近期价格区间中的相对位置。K 上穿 D 且 D 位于低位（超卖区）时买入，K 下穿 D 且 D 位于高位（超买区）时卖出。把阈值都设为 50 则变为普通的金叉死叉。对短线震荡较敏感。',
  params: [
    { key: 'n', label: 'RSV 周期', default: 9, min: 3, max: 60, step: 1 },
    { key: 'm1', label: 'K 平滑', default: 3, min: 2, max: 10, step: 1 },
    { key: 'm2', label: 'D 平滑', default: 3, min: 2, max: 10, step: 1 },
    { key: 'low', label: '低位阈值', default: 30, min: 0, max: 60, step: 1 },
    { key: 'high', label: '高位阈值', default: 70, min: 40, max: 100, step: 1 },
  ],
  run(bars, p) {
    const { high, low, close } = columns(bars);
    const r = kdj(high, low, close, p.n, p.m1, p.m2);
    const position = stateMachine(
      bars.length,
      (i) => crossOver(r.k, r.d, i) && r.d[i] < p.low,
      (i) => crossUnder(r.k, r.d, i) && r.d[i] > p.high,
    );
    return {
      position,
      overlays: [
        { name: 'K', data: r.k, pane: 'sub', color: C.fast },
        { name: 'D', data: r.d, pane: 'sub', color: C.slow },
        { name: 'J', data: r.j, pane: 'sub', color: C.third },
      ],
      subLevels: [p.low, p.high],
    };
  },
};

export const momentum: StrategyDef = {
  id: 'momentum',
  name: '动量策略',
  category: '动量',
  summary: '过去 N 日涨幅超过阈值且价格在长期均线上方时持有。',
  description:
    '动量效应：过去一段时间表现强的股票，短期内倾向于继续走强。策略计算 N 日涨跌幅（ROC），超过阈值时买入、跌破阈值时卖出；可叠加长期均线过滤，只在价格位于均线之上（大趋势向上）时持有。',
  params: [
    { key: 'lookback', label: '动量周期', default: 20, min: 5, max: 250, step: 1 },
    { key: 'threshold', label: '涨幅阈值 %', default: 0, min: -20, max: 30, step: 0.5 },
    { key: 'maFilter', label: '均线过滤周期', default: 60, min: 0, max: 250, step: 5, hint: '0 表示不过滤' },
  ],
  run(bars, p) {
    const { close } = columns(bars);
    const r = roc(close, p.lookback);
    const ma = p.maFilter > 0 ? sma(close, p.maFilter) : null;
    const position = r.map((v, i) => {
      if (!Number.isFinite(v)) return 0;
      const trendOk = !ma || close[i] > ma[i];
      return v > p.threshold && trendOk ? 1 : 0;
    });
    const overlays: StrategyOutput['overlays'] = [
      { name: `ROC${p.lookback}`, data: r, pane: 'sub', color: C.fast },
    ];
    if (ma) overlays.push({ name: `MA${p.maFilter}`, data: ma, pane: 'main', color: C.slow });
    return { position, overlays, subLevels: [p.threshold] };
  },
};

export const maTrend: StrategyDef = {
  id: 'ma_trend',
  name: '均线多头排列 + 放量',
  category: '趋势跟踪',
  summary: '短、中、长三条均线多头排列且成交量放大时买入，跌破中期均线卖出。',
  description:
    'A 股常用的“多头排列”选股思路：MA短 > MA中 > MA长 代表各周期趋势一致向上；同时要求当日成交量大于 N 日均量的若干倍，确认有资金推动。收盘跌破中期均线时离场。',
  params: [
    { key: 's', label: '短期均线', default: 5, min: 2, max: 30, step: 1 },
    { key: 'm', label: '中期均线', default: 10, min: 5, max: 60, step: 1 },
    { key: 'l', label: '长期均线', default: 20, min: 10, max: 250, step: 1 },
    { key: 'volRatio', label: '放量倍数', default: 1.2, min: 0, max: 5, step: 0.1, hint: '0 表示不要求放量' },
  ],
  run(bars, p) {
    const { close, volume } = columns(bars);
    const ms = sma(close, p.s);
    const mm = sma(close, p.m);
    const ml = sma(close, p.l);
    const vma = sma(volume, 20);
    const position = stateMachine(
      bars.length,
      (i) => ms[i] > mm[i] && mm[i] > ml[i] && (p.volRatio <= 0 || volume[i] > p.volRatio * vma[i]),
      (i) => close[i] < mm[i],
    );
    return {
      position,
      overlays: [
        { name: `MA${p.s}`, data: ms, pane: 'main', color: C.fast },
        { name: `MA${p.m}`, data: mm, pane: 'main', color: C.slow },
        { name: `MA${p.l}`, data: ml, pane: 'main', color: C.third },
      ],
    };
  },
};

export const superTrendStrategy: StrategyDef = {
  id: 'supertrend',
  name: 'SuperTrend 超级趋势',
  category: '波动率',
  summary: '基于 ATR 的自适应趋势线，价格站上趋势线持有，跌破卖出。',
  description:
    'SuperTrend 以 (最高+最低)/2 ± 倍数×ATR 构造上下轨，并随价格单向移动。价格收在下轨之上为多头状态，跌破则翻转为空头。ATR 让止损距离随波动率自动调整：波动大时给出更宽的空间，波动小时更紧。',
  params: [
    { key: 'period', label: 'ATR 周期', default: 10, min: 3, max: 60, step: 1 },
    { key: 'mult', label: 'ATR 倍数', default: 3, min: 1, max: 6, step: 0.1 },
  ],
  run(bars, p) {
    const { high, low, close } = columns(bars);
    const st = superTrend(high, low, close, p.period, p.mult);
    const position = st.direction.map((d) => (d === 1 ? 1 : 0));
    return {
      position,
      overlays: [{ name: 'SuperTrend', data: st.line, pane: 'main', color: C.mid }],
    };
  },
};

export const grid: StrategyDef = {
  id: 'grid',
  name: '动态网格交易',
  category: '网格',
  summary: '以均线为中枢，每下跌一格加仓、每上涨一格减仓，赚取震荡差价。',
  description:
    '以 N 日均线作为网格中枢，价格位于中枢时持有 50% 仓位。价格每低于中枢一个格距（如 3%）就加仓一档，每高于中枢一个格距就减仓一档，共设 L 档，仓位在 0%~100% 之间变动。网格策略在震荡市中能反复低买高卖；单边下跌时会越跌越买，单边上涨时会过早卖光，需要谨慎设定格距和档数。',
  params: [
    { key: 'center', label: '中枢均线周期', default: 60, min: 5, max: 250, step: 1 },
    { key: 'gridPct', label: '格距 %', default: 3, min: 0.5, max: 15, step: 0.5 },
    { key: 'levels', label: '单边档数', default: 5, min: 1, max: 10, step: 1 },
  ],
  run(bars, p) {
    const { close } = columns(bars);
    const mid = sma(close, p.center);
    const step = p.gridPct / 100;
    const position = close.map((c, i) => {
      const m = mid[i];
      if (!Number.isFinite(m)) return 0;
      const d = (c - m) / m;
      const k = -Math.trunc(d / step); // 低于中枢为正
      const lv = Math.max(-p.levels, Math.min(p.levels, k));
      return Math.round((0.5 + lv * (0.5 / p.levels)) * 1000) / 1000;
    });
    const up = mid.map((m) => m * (1 + step * p.levels));
    const dn = mid.map((m) => m * (1 - step * p.levels));
    return {
      position,
      overlays: [
        { name: '中枢', data: mid, pane: 'main', color: C.mid },
        { name: '网格上沿', data: up, pane: 'main', color: C.band, kind: 'dashed' },
        { name: '网格下沿', data: dn, pane: 'main', color: C.band, kind: 'dashed' },
        { name: '目标仓位%', data: position.map((x) => x * 100), pane: 'sub', color: C.fast },
      ],
      subLevels: [50],
    };
  },
};

export const biasReversion: StrategyDef = {
  id: 'bias',
  name: '乖离率抄底',
  category: '均值回归',
  summary: '价格低于均线超过一定比例（负乖离过大）时买入，回到均线上方一定比例卖出。',
  description:
    '乖离率 BIAS = (收盘价 − N 日均线) / N 日均线。负乖离过大说明短期超跌，存在向均线回归的动力。策略在 BIAS 低于买入阈值时买入，高于卖出阈值时卖出。参数需结合股票波动特性调整：波动大的股票应使用更大的阈值。',
  params: [
    { key: 'period', label: '均线周期', default: 20, min: 5, max: 120, step: 1 },
    { key: 'buy', label: '买入乖离 %', default: -8, min: -30, max: -1, step: 0.5 },
    { key: 'sell', label: '卖出乖离 %', default: 3, min: -5, max: 30, step: 0.5 },
  ],
  run(bars, p) {
    const { close } = columns(bars);
    const b = bias(close, p.period);
    const position = stateMachine(
      bars.length,
      (i) => b[i] < p.buy,
      (i) => b[i] > p.sell,
    );
    return {
      position,
      overlays: [
        { name: `MA${p.period}`, data: sma(close, p.period), pane: 'main', color: C.mid },
        { name: `BIAS${p.period}`, data: b, pane: 'sub', color: C.fast },
      ],
      subLevels: [p.buy, 0, p.sell],
    };
  },
};

export const buyHold: StrategyDef = {
  id: 'buy_hold',
  name: '买入持有',
  category: '基准',
  summary: '第一天满仓买入并一直持有，作为其他策略的比较基准。',
  description:
    '不做任何择时，回测开始即满仓持有到结束。任何主动策略都应该和它比较：如果一个策略长期跑不赢买入持有，同时回撤也没有明显更小，那么频繁交易就没有意义。',
  params: [],
  run(bars: Bar[]) {
    return { position: new Array<number>(bars.length).fill(1), overlays: [] };
  },
};

export const BUILTIN_STRATEGIES: StrategyDef[] = [
  maCross,
  macdCross,
  turtle,
  maTrend,
  superTrendStrategy,
  bollBreakout,
  momentum,
  rsiReversal,
  bollReversion,
  kdjCross,
  biasReversion,
  grid,
  buyHold,
];
