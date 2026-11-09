/**
 * 由书籍提炼出的策略。
 */
import { columns, ema, ewmStd, highest, regressionMomentum, sma } from '../indicators';
import type { Overlay, StrategyDef } from './types';

/** Carver 给出的各速度 EWMAC 预测值缩放系数（使平均绝对预测值约为 10） */
const EWMAC_SCALAR: Record<number, number> = { 2: 10.6, 4: 7.5, 8: 5.3, 16: 3.75, 32: 2.65, 64: 1.87 };
const SPEED_SETS: Record<number, number[]> = {
  0: [8, 16, 32, 64],
  1: [4, 8, 16],
  2: [16, 32, 64],
};

export const carverEwmac: StrategyDef = {
  id: 'ewmac',
  name: 'Carver 多周期趋势（EWMAC）',
  category: '趋势跟踪',
  summary: '多组快慢 EMA 之差除以波动率得到“趋势强度预测值”，按强度分档持仓，而不是简单的全仓 / 空仓。',
  description:
    '出自 Robert Carver《Systematic Trading》与《Advanced Futures Trading Strategies》(2023)。每组规则计算 (快EMA − 慢EMA) / 价格波动率，乘以缩放系数使平均强度约为 10，并截断在 ±20。把 8/32、16/64、32/128、64/256 等多个速度平均（乘以分散化系数），得到综合预测值。仓位 = 预测值 / 20（只做多时负值记为 0），并按“缓冲档位”取整，减少无谓的小额调仓。它的优点是：信号连续、对波动率自适应、多速度互相分散。',
  params: [
    {
      key: 'speeds',
      label: '速度组合',
      default: 0,
      min: 0,
      max: 2,
      step: 1,
      options: [
        { value: 0, label: '均衡：8/16/32/64' },
        { value: 1, label: '偏快：4/8/16' },
        { value: 2, label: '偏慢：16/32/64' },
      ],
    },
    { key: 'buffer', label: '调仓档位 %', default: 25, min: 5, max: 50, step: 5, hint: '仓位按此档位取整，越大交易越少' },
    { key: 'volSpan', label: '波动率跨度', default: 35, min: 10, max: 120, step: 5 },
  ],
  run(bars, p) {
    const { close } = columns(bars);
    const n = bars.length;
    const diffs = close.map((c, i) => (i ? c - close[i - 1] : NaN));
    const sigma = ewmStd(diffs, p.volSpan);
    const speeds = SPEED_SETS[p.speeds] ?? SPEED_SETS[0];
    const fcs = speeds.map((f) => {
      const ef = ema(close, f);
      const es = ema(close, f * 4);
      return close.map((_, i) => {
        if (i < f * 4 || !(sigma[i] > 0)) return NaN;
        const raw = ((ef[i] - es[i]) / sigma[i]) * EWMAC_SCALAR[f];
        return Math.max(-20, Math.min(20, raw));
      });
    });
    const fdm = speeds.length >= 4 ? 1.2 : speeds.length === 3 ? 1.15 : 1.1;
    const combined = new Array<number>(n).fill(NaN);
    for (let i = 0; i < n; i++) {
      const vals = fcs.map((s) => s[i]).filter(Number.isFinite);
      if (vals.length === speeds.length) combined[i] = Math.max(-20, Math.min(20, (vals.reduce((a, b) => a + b, 0) / vals.length) * fdm));
    }
    const step = p.buffer / 100;
    const position = combined.map((fc) => {
      if (!Number.isFinite(fc) || fc <= 0) return 0;
      return Math.min(1, Math.round(fc / 20 / step) * step);
    });
    return {
      position,
      overlays: [
        { name: '综合预测值', data: combined, pane: 'sub', color: '#e0a526' },
        { name: '目标仓位×20', data: position.map((x) => x * 20), pane: 'sub', color: '#4f8fe8', kind: 'dashed' },
      ],
      subLevels: [0, 10, 20],
    };
  },
};

export const clenowMomentum: StrategyDef = {
  id: 'clenow',
  name: 'Clenow 回归动量',
  category: '动量',
  summary: '用对数价格回归的年化斜率 × R² 衡量“涨得又快又稳”，配合均线与跳空过滤。',
  description:
    '出自 Andreas Clenow《Stocks on the Move》。普通动量只看区间涨幅，容易被一两天暴涨误导；回归动量对最近 N 天的对数价格做线性回归，用年化斜率乘以拟合优度 R²，奖励平稳上涨的股票。书中规则：只在价格高于 100 日均线、且近期没有超过 15% 的单日跳空时持有；原书用于在大量股票中排名轮动，本站在「组合轮动」也提供了这种排名方式。',
  params: [
    { key: 'window', label: '回归窗口', default: 90, min: 20, max: 250, step: 5 },
    { key: 'threshold', label: '入场得分', default: 30, min: 0, max: 200, step: 5, hint: '年化斜率% × R²' },
    { key: 'ma', label: '趋势过滤均线', default: 100, min: 0, max: 250, step: 10, hint: '0 表示不过滤' },
    { key: 'gap', label: '最大跳空 %', default: 15, min: 5, max: 50, step: 1 },
  ],
  run(bars, p) {
    const { close, open } = columns(bars);
    const score = regressionMomentum(close, p.window);
    const ma = p.ma > 0 ? sma(close, p.ma) : null;
    const gaps = close.map((_, i) => (i ? Math.abs(open[i] / close[i - 1] - 1) * 100 : 0));
    const maxGap = highest(gaps, p.window);
    const position = new Array<number>(bars.length).fill(0);
    let holding = false;
    for (let i = 0; i < bars.length; i++) {
      const ok = Number.isFinite(score[i]) && (!ma || close[i] > ma[i]) && maxGap[i] <= p.gap;
      if (!holding && ok && score[i] >= p.threshold) holding = true;
      else if (holding && (!ok || score[i] < p.threshold / 2)) holding = false;
      position[i] = holding ? 1 : 0;
    }
    const overlays: Overlay[] = [{ name: '回归动量得分', data: score, pane: 'sub', color: '#e0a526' }];
    if (ma) overlays.push({ name: `MA${p.ma}`, data: ma, pane: 'main', color: '#4f8fe8' });
    return { position, overlays, subLevels: [p.threshold / 2, p.threshold] };
  },
};

export const mrMarket: StrategyDef = {
  id: 'mr_market',
  name: '市场先生（恐慌加仓）',
  category: '均值回归',
  summary: '长期持有底仓；当价格从高点大幅回撤（市场恐慌）时分档加仓，恢复后减回底仓。',
  description:
    '受巴菲特“市场先生”比喻和“别人恐惧时贪婪”的启发：价格是情绪化的报价，不等于价值。策略始终持有底仓；价格较 N 日最高点回撤超过第一档时加到中等仓位，超过第二档时满仓；回到高点附近时减回底仓。注意：巴菲特的前提是先确认企业质量和内在价值，单靠价格回撤并不能区分“被错杀的好公司”和“正在变差的公司”，请配合「巴菲特工具箱」中的估值与质量清单使用。',
  params: [
    { key: 'base', label: '底仓 %', default: 40, min: 0, max: 100, step: 10 },
    { key: 'lookback', label: '高点回看周期', default: 250, min: 60, max: 750, step: 10 },
    { key: 'dd1', label: '第一档回撤 %', default: 20, min: 5, max: 60, step: 1 },
    { key: 'dd2', label: '第二档回撤 %', default: 35, min: 10, max: 80, step: 1 },
    { key: 'recover', label: '回到高点的 %以内减仓', default: 5, min: 0, max: 30, step: 1 },
  ],
  run(bars, p) {
    const { close } = columns(bars);
    const hh = highest(close, p.lookback);
    const base = p.base / 100;
    const mid = Math.min(1, base + (1 - base) / 2);
    let level = base;
    const dd = close.map((c, i) => (Number.isFinite(hh[i]) ? (c / hh[i] - 1) * 100 : NaN));
    const position = dd.map((d) => {
      if (!Number.isFinite(d)) return base;
      if (d <= -p.dd2) level = 1;
      else if (d <= -p.dd1) level = Math.max(level, mid);
      else if (d >= -p.recover) level = base;
      return level;
    });
    return {
      position,
      overlays: [
        { name: `${p.lookback}日高点`, data: hh, pane: 'main', color: '#c0a062', kind: 'dashed' },
        { name: '距高点回撤%', data: dd, pane: 'sub', color: '#e0a526' },
      ],
      subLevels: [-p.dd1, -p.dd2, 0],
    };
  },
};

export const BOOK_STRATEGIES: StrategyDef[] = [carverEwmac, clenowMomentum, mrMarket];
