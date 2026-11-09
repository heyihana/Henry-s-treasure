import { gaussian, mulberry32 } from '../random';
import type { Bar, StockMeta } from '../types';

interface DemoSpec {
  meta: StockMeta;
  seed: number;
  start: number;
  /** 生成方式 */
  model: 'regime' | 'meanRevert' | 'cycle' | 'index';
  vol: number;
  /** regime 模型的上涨 / 下跌阶段日漂移 */
  up?: number;
  down?: number;
}

/** 演示数据：用可复现的随机过程生成，不代表任何真实证券 */
export const DEMO_SPECS: DemoSpec[] = [
  { meta: { code: 'DEMO01', name: '演示·趋势成长股', secid: 'demo.DEMO01', market: 'DEMO' }, seed: 348, start: 18, model: 'regime', vol: 0.025 },
  { meta: { code: 'DEMO02', name: '演示·区间震荡股', secid: 'demo.DEMO02', market: 'DEMO' }, seed: 7, start: 32, model: 'meanRevert', vol: 0.017 },
  { meta: { code: 'DEMO03', name: '演示·周期资源股', secid: 'demo.DEMO03', market: 'DEMO' }, seed: 145, start: 9.5, model: 'cycle', vol: 0.026 },
  { meta: { code: 'DEMO04', name: '演示·宽基指数', secid: 'demo.DEMO04', market: 'DEMO' }, seed: 40, start: 3.2, model: 'index', vol: 0.012 },
  { meta: { code: 'DEMO05', name: '演示·科技主题ETF', secid: 'demo.DEMO05', market: 'DEMO' }, seed: 48, start: 1.1, model: 'regime', vol: 0.02 },
  { meta: { code: 'DEMO06', name: '演示·红利低波ETF', secid: 'demo.DEMO06', market: 'DEMO' }, seed: 67, start: 1.4, model: 'index', vol: 0.008 },
];

/** 生成截至 endDate（含）的 n 个工作日 */
export function businessDays(endDate: string, n: number): string[] {
  const out: string[] = [];
  const d = new Date(endDate + 'T00:00:00Z');
  while (out.length < n) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return out.reverse();
}

const DEMO_END = '2026-10-30';
const DEMO_BARS = 2000;

export function generateDemoBars(spec: DemoSpec, n = DEMO_BARS, endDate = DEMO_END): Bar[] {
  const rand = mulberry32(spec.seed);
  const z = gaussian(rand);
  const dates = businessDays(endDate, n);
  const bars: Bar[] = [];
  let price = spec.start;
  let regimeDrift = 0.0008;
  let regimeLeft = 0;
  const anchor = spec.start;
  const baseVol = 1e6 * (50 / Math.max(1, spec.start));
  for (let t = 0; t < n; t++) {
    let drift = 0;
    let vol = spec.vol;
    switch (spec.model) {
      case 'regime': {
        if (regimeLeft <= 0) {
          const r = rand();
          regimeDrift = r < 0.4 ? (spec.up ?? 0.0026) : r < 0.7 ? (spec.down ?? -0.0013) : 0.0003;
          regimeLeft = 40 + Math.floor(rand() * 160);
        }
        regimeLeft--;
        drift = regimeDrift;
        vol = spec.vol * (regimeDrift < 0 ? 1.25 : 1);
        break;
      }
      case 'meanRevert': {
        const level = anchor * (1 + 0.15 * Math.sin(t / 400));
        drift = 0.035 * Math.log(level / price);
        break;
      }
      case 'cycle': {
        drift = 0.0028 * Math.sin((2 * Math.PI * t) / 260) + 0.0001;
        break;
      }
      case 'index': {
        drift = 0.00035;
        vol = spec.vol * (1 + 0.6 * Math.max(0, Math.sin(t / 180)));
        break;
      }
    }
    const ret = Math.max(-0.1, Math.min(0.1, drift + vol * z()));
    const prev = price;
    const gap = Math.max(-0.08, Math.min(0.08, vol * 0.35 * z()));
    const open = prev * (1 + gap);
    const close = prev * (1 + ret);
    const hi = Math.max(open, close) * (1 + Math.abs(vol * 0.45 * z()));
    const lo = Math.min(open, close) * (1 - Math.abs(vol * 0.45 * z()));
    const high = Math.min(hi, prev * 1.1);
    const low = Math.max(lo, prev * 0.9);
    price = close;
    const volume = Math.round(baseVol * Math.exp(0.35 * z()) * (1 + (Math.abs(ret) / vol) * 0.5));
    const r2 = (x: number) => Math.round(x * (spec.start < 5 ? 1000 : 100)) / (spec.start < 5 ? 1000 : 100);
    const o = r2(open);
    const c = r2(close);
    bars.push({
      date: dates[t],
      open: o,
      close: c,
      high: Math.max(r2(high), o, c),
      low: Math.min(r2(low), o, c),
      volume,
      amount: volume * c,
    });
  }
  return bars;
}

const cache = new Map<string, Bar[]>();

export function getDemoBars(code: string): Bar[] {
  const spec = DEMO_SPECS.find((s) => s.meta.code === code) ?? DEMO_SPECS[0];
  let bars = cache.get(spec.meta.code);
  if (!bars) {
    bars = generateDemoBars(spec);
    cache.set(spec.meta.code, bars);
  }
  return bars;
}
