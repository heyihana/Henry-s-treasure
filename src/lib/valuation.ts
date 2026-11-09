/**
 * 巴菲特式估值工具：所有者盈余两阶段折现、反向折现（隐含增长率）、质量清单、仓位计算。
 */

export interface DcfInput {
  /** 每股所有者盈余（净利润 + 折旧摊销 − 维持性资本开支 − 营运资本增加） */
  ownerEarnings: number;
  /** 第一阶段年增长率 */
  growth: number;
  /** 第一阶段年数 */
  years: number;
  /** 永续增长率 */
  terminalGrowth: number;
  /** 折现率（要求回报率） */
  discount: number;
}

export interface DcfResult {
  value: number;
  /** 第一阶段现金流现值合计 */
  stage1: number;
  /** 终值现值 */
  terminal: number;
  flows: { year: number; cash: number; pv: number }[];
}

export function dcf(input: DcfInput): DcfResult {
  const { ownerEarnings: e0, growth: g, years, terminalGrowth: gt, discount: r } = input;
  const flows: DcfResult['flows'] = [];
  let cash = e0;
  let stage1 = 0;
  for (let y = 1; y <= years; y++) {
    cash *= 1 + g;
    const pv = cash / Math.pow(1 + r, y);
    stage1 += pv;
    flows.push({ year: y, cash, pv });
  }
  let terminal = NaN;
  if (r > gt) terminal = (cash * (1 + gt)) / (r - gt) / Math.pow(1 + r, years);
  return { value: stage1 + terminal, stage1, terminal, flows };
}

/** 反向 DCF：当前价格隐含的第一阶段增长率（二分法） */
export function impliedGrowth(price: number, input: Omit<DcfInput, 'growth'>): number {
  if (!(price > 0) || !(input.ownerEarnings > 0) || input.discount <= input.terminalGrowth) return NaN;
  let lo = -0.5;
  let hi = 1.5;
  const f = (g: number) => dcf({ ...input, growth: g }).value - price;
  if (f(lo) > 0) return lo;
  if (f(hi) < 0) return hi;
  for (let k = 0; k < 80; k++) {
    const mid = (lo + hi) / 2;
    if (f(mid) > 0) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

export interface QualityInput {
  roe: number; // 近年平均 ROE
  grossMargin: number;
  debtRatio: number; // 资产负债率
  fcfConversion: number; // 自由现金流 / 净利润
  profitYears: number; // 近 10 年盈利年数
  pe: number;
  understand: boolean;
  integrity: boolean;
}

export interface QualityItem {
  key: string;
  title: string;
  pass: boolean | null;
  rule: string;
  why: string;
}

export function qualityChecklist(q: QualityInput): { items: QualityItem[]; score: number } {
  const known = (x: number) => Number.isFinite(x);
  const items: QualityItem[] = [
    { key: 'understand', title: '能力圈', pass: q.understand, rule: '你能用几句话讲清楚它怎么赚钱、十年后大概什么样', why: '看不懂的生意，估值再便宜也无法判断。' },
    { key: 'roe', title: '高资本回报', pass: known(q.roe) ? q.roe >= 0.15 : null, rule: '长期平均 ROE ≥ 15%', why: '持续的高 ROE 说明有护城河，并且不靠加杠杆实现。' },
    { key: 'debt', title: '低负债', pass: known(q.debtRatio) ? q.debtRatio <= 0.5 : null, rule: '资产负债率 ≤ 50%（银行、保险除外）', why: '巴菲特多次强调杠杆会让好公司在坏年景里倒下。' },
    { key: 'margin', title: '定价权', pass: known(q.grossMargin) ? q.grossMargin >= 0.3 : null, rule: '毛利率 ≥ 30% 且长期稳定', why: '高毛利往往来自品牌、网络效应或成本优势。' },
    { key: 'fcf', title: '真金白银', pass: known(q.fcfConversion) ? q.fcfConversion >= 0.8 : null, rule: '自由现金流 / 净利润 ≥ 80%', why: '所有者盈余才是股东真正能拿走的钱，利润要能变成现金。' },
    { key: 'stable', title: '盈利稳定', pass: known(q.profitYears) ? q.profitYears >= 9 : null, rule: '近 10 年至少 9 年盈利', why: '可预测的盈利才能估值，亏损频繁的公司难以折现。' },
    { key: 'price', title: '价格合理', pass: known(q.pe) && q.pe > 0 ? q.pe <= 25 : null, rule: '市盈率 ≤ 25（并结合内在价值计算）', why: '“以合理价格买入优秀公司，好过以优惠价格买入平庸公司”，但价格仍然重要。' },
    { key: 'integrity', title: '管理层', pass: q.integrity, rule: '诚实、理性配置资本、重视股东回报', why: '巴菲特选人看三点：正直、聪明、精力，没有第一点，后两点会害你。' },
  ];
  const judged = items.filter((i) => i.pass !== null);
  const score = judged.length ? Math.round((judged.filter((i) => i.pass).length / judged.length) * 100) : 0;
  return { items, score };
}

/** Merton 比例：最优风险资产仓位 = (预期收益 − 无风险) / (风险厌恶 × 波动率²) */
export function mertonShare(expected: number, riskFree: number, vol: number, riskAversion: number): number {
  if (!(vol > 0) || !(riskAversion > 0)) return NaN;
  return (expected - riskFree) / (riskAversion * vol * vol);
}

/** 凯利比例（离散）：胜率 p，盈亏比 b → f = p − (1 − p) / b */
export function kellyFraction(winRate: number, payoff: number): number {
  if (!(payoff > 0)) return NaN;
  return winRate - (1 - winRate) / payoff;
}

/** 留存收益“一美元测试”：每留存 1 元利润创造了多少市值 */
export function retainedTest(startCap: number, endCap: number, retained: number): number {
  if (!(retained > 0)) return NaN;
  return (endCap - startCap) / retained;
}
