import { returnsOf, std, maxDrawdownInfo } from './backtest/metrics';
import * as ta from './indicators';
import type { Bar } from './types';

export type Tone = 'bull' | 'bear' | 'neutral';

export interface DiagnosisItem {
  title: string;
  value: string;
  tone: Tone;
  detail: string;
}

export interface Diagnosis {
  items: DiagnosisItem[];
  /** 0~100 综合技术评分 */
  score: number;
  verdict: string;
}

const pct = (x: number, d = 2) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(d)}%`;

/** 技术面诊断：综合均线、MACD、RSI、KDJ、布林带、量能等给出多空判断 */
export function diagnose(bars: Bar[]): Diagnosis {
  const n = bars.length;
  const items: DiagnosisItem[] = [];
  if (n < 30) return { items, score: 50, verdict: '数据不足，无法诊断' };
  const c = ta.columns(bars);
  const i = n - 1;
  const last = c.close[i];

  const ma5 = ta.sma(c.close, 5)[i];
  const ma10 = ta.sma(c.close, 10)[i];
  const ma20 = ta.sma(c.close, 20)[i];
  const ma60 = n >= 60 ? ta.sma(c.close, 60)[i] : NaN;
  if (Number.isFinite(ma60)) {
    if (ma5 > ma10 && ma10 > ma20 && ma20 > ma60)
      items.push({ title: '均线排列', value: '多头排列', tone: 'bull', detail: 'MA5 > MA10 > MA20 > MA60，各周期趋势一致向上。' });
    else if (ma5 < ma10 && ma10 < ma20 && ma20 < ma60)
      items.push({ title: '均线排列', value: '空头排列', tone: 'bear', detail: 'MA5 < MA10 < MA20 < MA60，各周期趋势一致向下。' });
    else items.push({ title: '均线排列', value: '均线交织', tone: 'neutral', detail: '短中长期均线方向不一致，处于震荡或转折阶段。' });
    items.push(
      last > ma60
        ? { title: '中期趋势', value: '站上 60 日线', tone: 'bull', detail: `收盘价高于 MA60 ${pct(last / ma60 - 1)}。` }
        : { title: '中期趋势', value: '跌破 60 日线', tone: 'bear', detail: `收盘价低于 MA60 ${pct(last / ma60 - 1)}。` },
    );
  }

  const m = ta.macd(c.close);
  let crossAgo = -1;
  let crossType: 'gold' | 'dead' | null = null;
  for (let k = i; k > Math.max(0, i - 5); k--) {
    if (ta.crossOver(m.dif, m.dea, k)) {
      crossAgo = i - k;
      crossType = 'gold';
      break;
    }
    if (ta.crossUnder(m.dif, m.dea, k)) {
      crossAgo = i - k;
      crossType = 'dead';
      break;
    }
  }
  const difUp = m.dif[i] > m.dea[i];
  items.push({
    title: 'MACD',
    value: crossType
      ? `${crossAgo === 0 ? '今日' : crossAgo + ' 根前'}${crossType === 'gold' ? '金叉' : '死叉'}`
      : difUp
        ? m.dif[i] > 0
          ? '零轴上方多头'
          : '零轴下方反弹'
        : m.dif[i] > 0
          ? '零轴上方回调'
          : '零轴下方空头',
    tone: crossType ? (crossType === 'gold' ? 'bull' : 'bear') : difUp ? 'bull' : 'bear',
    detail: `DIF ${m.dif[i].toFixed(3)}，DEA ${m.dea[i].toFixed(3)}，柱 ${m.hist[i].toFixed(3)}。`,
  });

  const r = ta.rsi(c.close, 14)[i];
  items.push({
    title: 'RSI(14)',
    value: r.toFixed(1),
    tone: r >= 70 ? 'bear' : r <= 30 ? 'bull' : r >= 50 ? 'bull' : 'neutral',
    detail: r >= 70 ? '进入超买区，短线追高风险较大。' : r <= 30 ? '进入超卖区，存在技术性反弹可能。' : r >= 50 ? '强弱分界线上方，多方略占优。' : '强弱分界线下方，空方略占优。',
  });

  const k = ta.kdj(c.high, c.low, c.close);
  const j = k.j[i];
  items.push({
    title: 'KDJ',
    value: `K ${k.k[i].toFixed(0)} · D ${k.d[i].toFixed(0)} · J ${j.toFixed(0)}`,
    tone: j > 100 ? 'bear' : j < 0 ? 'bull' : k.k[i] > k.d[i] ? 'bull' : 'bear',
    detail: j > 100 ? 'J 值大于 100，短线过热。' : j < 0 ? 'J 值小于 0，短线超跌。' : k.k[i] > k.d[i] ? 'K 在 D 之上，短线偏强。' : 'K 在 D 之下，短线偏弱。',
  });

  const b = ta.boll(c.close, 20, 2);
  const width = (b.upper[i] - b.lower[i]) / b.mid[i];
  const widths = b.upper.map((u, t) => (u - b.lower[t]) / b.mid[t]).slice(-120).filter(Number.isFinite);
  const minW = Math.min(...widths);
  const posInBand = (last - b.lower[i]) / (b.upper[i] - b.lower[i]);
  items.push({
    title: '布林带',
    value: last > b.upper[i] ? '突破上轨' : last < b.lower[i] ? '跌破下轨' : `通道内 ${(posInBand * 100).toFixed(0)}%`,
    tone: last > b.upper[i] ? 'bull' : last < b.lower[i] ? 'bear' : posInBand > 0.5 ? 'bull' : 'neutral',
    detail:
      width <= minW * 1.05
        ? `带宽 ${(width * 100).toFixed(1)}% 处于近半年最窄，波动收敛，常预示方向选择。`
        : `带宽 ${(width * 100).toFixed(1)}%。`,
  });

  const vma5 = ta.sma(c.volume, 5)[i - 1];
  const vr = vma5 > 0 ? c.volume[i] / vma5 : NaN;
  const up = last >= c.close[i - 1];
  if (Number.isFinite(vr)) {
    items.push({
      title: '量能',
      value: vr >= 2 ? `放量 ${vr.toFixed(1)} 倍` : vr <= 0.6 ? `缩量 ${vr.toFixed(1)} 倍` : `量比 ${vr.toFixed(2)}`,
      tone: vr >= 1.5 ? (up ? 'bull' : 'bear') : 'neutral',
      detail: vr >= 1.5 ? (up ? '放量上涨，资金积极。' : '放量下跌，抛压较重。') : vr <= 0.6 ? '成交清淡，观望情绪浓。' : '成交量与近 5 日均量接近。',
    });
  }

  const look = Math.min(n, 250);
  const hh = Math.max(...c.high.slice(-look));
  const ll = Math.min(...c.low.slice(-look));
  const loc = hh > ll ? (last - ll) / (hh - ll) : 0.5;
  items.push({
    title: '年内位置',
    value: `${(loc * 100).toFixed(0)}%`,
    tone: loc > 0.8 ? 'bull' : loc < 0.2 ? 'bear' : 'neutral',
    detail: `近一年最高 ${hh.toFixed(2)}，最低 ${ll.toFixed(2)}，距最高 ${pct(last / hh - 1)}。`,
  });

  const bulls = items.filter((x) => x.tone === 'bull').length;
  const bears = items.filter((x) => x.tone === 'bear').length;
  const score = Math.round(50 + ((bulls - bears) / Math.max(1, items.length)) * 50);
  const verdict =
    score >= 75 ? '技术面强势' : score >= 58 ? '技术面偏多' : score > 42 ? '多空均衡' : score > 25 ? '技术面偏空' : '技术面弱势';
  return { items, score, verdict };
}

export interface StockStats {
  last: number;
  change: number;
  changePct: number;
  ret5: number;
  ret20: number;
  ret60: number;
  ret250: number;
  ytd: number;
  vol20: number;
  vol250: number;
  maxDrawdown1y: number;
  high52: number;
  low52: number;
  avgAmount20: number;
  rsi14: number;
  aboveMa20: boolean;
  aboveMa60: boolean;
}

const retN = (close: number[], n: number) => (close.length > n ? close[close.length - 1] / close[close.length - 1 - n] - 1 : NaN);

export function stockStats(bars: Bar[], ppy = 252): StockStats {
  const c = ta.columns(bars);
  const n = bars.length;
  const last = c.close[n - 1];
  const prev = n > 1 ? c.close[n - 2] : last;
  const year = bars[n - 1].date.slice(0, 4);
  const firstIdx = bars.findIndex((b) => b.date.startsWith(year));
  const ytdBase = firstIdx > 0 ? c.close[firstIdx - 1] : c.close[Math.max(0, firstIdx)];
  const rets = returnsOf(c.close);
  const lastYear = c.close.slice(-Math.min(n, ppy + 1));
  const amounts = bars.slice(-20).map((b) => b.amount ?? b.volume * b.close);
  const ma20 = ta.sma(c.close, 20)[n - 1];
  const ma60 = ta.sma(c.close, 60)[n - 1];
  return {
    last,
    change: last - prev,
    changePct: prev ? last / prev - 1 : 0,
    ret5: retN(c.close, 5),
    ret20: retN(c.close, 20),
    ret60: retN(c.close, 60),
    ret250: retN(c.close, 250),
    ytd: ytdBase ? last / ytdBase - 1 : NaN,
    vol20: std(rets.slice(-20)) * Math.sqrt(ppy),
    vol250: std(rets.slice(-ppy)) * Math.sqrt(ppy),
    maxDrawdown1y: maxDrawdownInfo(lastYear).maxDrawdown,
    high52: Math.max(...c.high.slice(-ppy)),
    low52: Math.min(...c.low.slice(-ppy)),
    avgAmount20: amounts.reduce((s, x) => s + x, 0) / Math.max(1, amounts.length),
    rsi14: ta.rsi(c.close, 14)[n - 1],
    aboveMa20: last > ma20,
    aboveMa60: last > ma60,
  };
}
