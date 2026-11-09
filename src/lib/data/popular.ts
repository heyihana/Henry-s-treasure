import type { StockMeta } from '../types';

const a = (code: string, name: string): StockMeta => ({
  code,
  name,
  secid: `${/^[569]/.test(code) ? 1 : 0}.${code}`,
  market: 'A',
});

/** 常用证券（离线搜索、默认自选） */
export const POPULAR: StockMeta[] = [
  a('600519', '贵州茅台'),
  a('300750', '宁德时代'),
  a('600036', '招商银行'),
  a('601318', '中国平安'),
  a('002594', '比亚迪'),
  a('000858', '五粮液'),
  a('000333', '美的集团'),
  a('601012', '隆基绿能'),
  a('300059', '东方财富'),
  a('688981', '中芯国际'),
  a('600900', '长江电力'),
  a('601899', '紫金矿业'),
  a('000001', '平安银行'),
  a('002415', '海康威视'),
  a('600276', '恒瑞医药'),
  a('601127', '赛力斯'),
  a('510300', '沪深300ETF'),
  a('510500', '中证500ETF'),
  a('159915', '创业板ETF'),
  a('588000', '科创50ETF'),
  a('513100', '纳指ETF'),
  a('518880', '黄金ETF'),
  a('511010', '国债ETF'),
  a('510880', '红利ETF'),
  { code: '000001', name: '上证指数', secid: '1.000001', market: 'A' },
  { code: '000300', name: '沪深300', secid: '1.000300', market: 'A' },
  { code: '399006', name: '创业板指', secid: '0.399006', market: 'A' },
  { code: '00700', name: '腾讯控股', secid: '116.00700', market: 'HK' },
  { code: '09988', name: '阿里巴巴-W', secid: '116.09988', market: 'HK' },
  { code: '03690', name: '美团-W', secid: '116.03690', market: 'HK' },
  { code: '01810', name: '小米集团-W', secid: '116.01810', market: 'HK' },
  { code: 'AAPL', name: '苹果', secid: '105.AAPL', market: 'US' },
  { code: 'MSFT', name: '微软', secid: '105.MSFT', market: 'US' },
  { code: 'NVDA', name: '英伟达', secid: '105.NVDA', market: 'US' },
  { code: 'TSLA', name: '特斯拉', secid: '105.TSLA', market: 'US' },
  { code: 'GOOGL', name: '谷歌-A', secid: '105.GOOGL', market: 'US' },
  { code: 'AMZN', name: '亚马逊', secid: '105.AMZN', market: 'US' },
  { code: 'BRK.B', name: '伯克希尔-B', secid: '106.BRK.B', market: 'US' },
];

export const DEFAULT_WATCHLIST: StockMeta[] = POPULAR.filter((s) =>
  ['1.600519', '0.300750', '1.600036', '0.002594', '0.000858', '1.601899', '116.00700', '105.NVDA'].includes(s.secid),
);

/** ETF 轮动常用组合 */
export const ROTATION_PRESETS: {
  name: string;
  desc: string;
  assets: StockMeta[];
  config?: { lookback?: number; rebalanceEvery?: number; topN?: number; safeAsset?: string; scoring?: 'roc' | 'clenow'; absoluteMomentum?: boolean };
}[] = [
  {
    name: '双动量 GEM',
    desc: 'Antonacci《Dual Momentum》：沪深300 vs 纳指，12 个月动量取强者；都跑输则转入国债',
    assets: POPULAR.filter((s) => ['510300', '513100', '511010'].includes(s.code)),
    config: { lookback: 250, rebalanceEvery: 21, topN: 1, safeAsset: '511010', absoluteMomentum: true, scoring: 'roc' },
  },
  {
    name: 'A 股大小盘轮动',
    desc: '沪深300 / 中证500 / 创业板，经典“二八轮动”的扩展版',
    assets: POPULAR.filter((s) => ['510300', '510500', '159915'].includes(s.code) && s.market === 'A'),
  },
  {
    name: '全球资产轮动',
    desc: '沪深300 / 纳指 / 黄金 / 国债，股债商品跨市场配置',
    assets: POPULAR.filter((s) => ['510300', '513100', '518880', '511010'].includes(s.code)),
  },
  {
    name: '风格轮动',
    desc: '红利 / 科创50 / 创业板 / 中证500，在价值与成长之间切换',
    assets: POPULAR.filter((s) => ['510880', '588000', '159915', '510500'].includes(s.code)),
  },
];
