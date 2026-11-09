import { useState } from 'react';
import { navigate, type RouteId } from '../app/router';
import { useApp } from '../app/store';
import { Panel, Seg } from '../components/ui';

interface Action {
  label: string;
  route: RouteId;
  strategy?: string;
  rotation?: string;
  config?: Record<string, number>;
}

interface Book {
  title: string;
  cn: string;
  author: string;
  year: string;
  /** 新书 / 新版 / 经典 */
  tier: 'new' | 'recent' | 'classic';
  status?: string;
  ideas: string[];
  rules: string[];
  actions: Action[];
  source?: string;
}

const BOOKS: Book[] = [
  {
    title: 'The Art and Science of Trading',
    cn: '交易的艺术与科学',
    author: 'Robert Carver',
    year: '2026-12（预售）',
    tier: 'new',
    status: '尚未出版，以下只依据出版社简介和作者此前著作',
    ideas: [
      '把交易者分成凭直觉的“艺术家”和靠规则的“科学家”，作者认为两类顶尖交易者遵循的底层规则是相同的。',
      '覆盖股票、ETF 和加密资产，面向全球个人交易者。',
      '延续作者一贯的立场：直觉可以用，但要被仓位、分散和成本这些规则约束。',
    ],
    rules: ['先定风险预算，再定仓位，最后才谈信号。', '无论主观还是量化，都按波动率决定下注大小。'],
    actions: [{ label: '试试 Carver 多周期趋势', route: 'backtest', strategy: 'ewmac' }],
    source: 'https://www.panmacmillan.com/authors/robert-carver/the-art-and-science-of-trading/9781804094792',
  },
  {
    title: 'Causal Factor Investing',
    cn: '因果因子投资',
    author: 'Marcos López de Prado',
    year: '2023 / 2026 精装版',
    tier: 'new',
    ideas: [
      '大多数因子研究只证明了“相关”，没有说明“为什么”，所以样本外常常失效。',
      '回测过拟合和多重检验是因子投资最大的问题：试的组合越多，越容易碰到“运气好”的结果。',
      '可信的策略要先有经济学上的因果解释，再用数据检验，并报告一共试了多少次。',
    ],
    rules: ['先写下策略为什么应该赚钱，再去回测。', '参数优化后必须看紧缩夏普（DSR），而不是最高夏普。', '保留一段从未用于调参的数据做最终验证。'],
    actions: [{ label: '参数优化（含 DSR）', route: 'optimize' }],
    source: 'https://rpc.cfainstitute.org/blogs/enterprising-investor/2026/book-review-causal-factor-investing',
  },
  {
    title: 'Machine Learning for Asset Managers / Advances in Financial Machine Learning',
    cn: '资产管理中的机器学习 / 金融机器学习前沿',
    author: 'Marcos López de Prado',
    year: '2018 · 2020 / 2026 精装版',
    tier: 'recent',
    ideas: [
      '三重障碍法：每笔交易同时设置止盈、止损和最长持有时间，哪个先到按哪个离场，让标签和实盘一致。',
      '紧缩夏普比率（DSR）和概率夏普比率（PSR）：把试验次数、样本长度、偏度和峰度都考虑进去。',
      '时间序列交叉验证要“清洗”和“隔离”，防止训练集信息泄漏到测试集。',
      '分层风险平价（HRP）、协方差去噪等组合构建方法。',
    ],
    rules: ['给每个策略加上止损、止盈和时间障碍。', '夏普要看 PSR：样本短、尾部肥时，同样的夏普可信度更低。'],
    actions: [
      { label: '设置时间障碍（最长持仓 20 根）', route: 'backtest', config: { maxHoldBars: 20 } },
      { label: '参数优化（含 DSR）', route: 'optimize' },
    ],
    source: 'https://www.cambridge.org/gb/node/9286',
  },
  {
    title: 'Generative AI for Trading and Asset Management',
    cn: '生成式 AI 在交易与资管中的应用',
    author: 'Hamlet Medina, Ernest P. Chan',
    year: '2025',
    tier: 'new',
    ideas: [
      '区分“判别式”AI（预测涨跌）和“生成式”AI（生成情景、数据和文本理解）。',
      '用生成模型合成大量逼真的市场路径，做压力测试和风险管理，而不是只依赖唯一的一段历史。',
      '用大语言模型从新闻、财报等文本中提取情绪和基本面信号。',
      '前半部分无需编程，后半部分讲深度生成模型和生产部署。',
    ],
    rules: ['策略要在“历史可能发生的其他路径”上检验，看收益和回撤的分布而不是单一数字。'],
    actions: [{ label: '回测页 → 蒙特卡洛', route: 'backtest' }],
    source: 'https://www.quantinsti.com/articles/ai-llm-book-asset-management-ernest-chan-hamlet-medina/',
  },
  {
    title: 'The Missing Billionaires',
    cn: '消失的亿万富翁',
    author: 'Victor Haghani, James White',
    year: '2023 / 2025 平装版',
    tier: 'recent',
    ideas: [
      '作者认为 LTCM 和许多家族财富的失败都源于同一件事：仓位过大。',
      '最优风险仓位（Merton 比例）= 超额收益 ÷（风险厌恶系数 × 波动率²）；风险厌恶为 1 是全凯利，为 2 是半凯利。',
      '书中的抛硬币实验显示，即使胜率占优，大多数人也会因下注过大而亏光。',
    ],
    rules: ['永远不要满凯利；半凯利或更少。', '预期收益下降或波动上升时，自动降低仓位。'],
    actions: [
      { label: '仓位计算器', route: 'buffett' },
      { label: '回测指标里的凯利 / Merton', route: 'backtest' },
    ],
    source: 'https://www.advisorperspectives.com/articles/2023/12/04/sex-lies-optimizing-utility-william-bernstein',
  },
  {
    title: 'Advanced Futures Trading Strategies',
    cn: '高级期货交易策略',
    author: 'Robert Carver',
    year: '2023',
    tier: 'recent',
    ideas: [
      'EWMAC 趋势规则：(快 EMA − 慢 EMA) ÷ 价格波动率，乘以缩放系数后截断在 ±20，多个速度平均。',
      '用“预测值强弱”决定仓位大小，而不是简单的全进全出。',
      '波动率目标：按资产近期波动调整持仓，让组合风险保持稳定。',
      '缓冲（buffering）：只有仓位偏离足够大时才调仓，大幅节省成本。',
    ],
    rules: ['多速度趋势平均，避免押注单一参数。', '仓位 ∝ 预测值 ÷ 波动率。', '设置调仓缓冲区。'],
    actions: [
      { label: 'Carver 多周期趋势', route: 'backtest', strategy: 'ewmac' },
      { label: '开启 20% 波动率目标', route: 'backtest', config: { volTarget: 0.2 } },
    ],
    source: 'https://www.systematicmoney.org/art-and-science-of-trading',
  },
  {
    title: 'Investing Amid Low Expected Returns',
    cn: '低预期回报时代的投资',
    author: 'Antti Ilmanen',
    year: '2022',
    tier: 'recent',
    ideas: [
      '股票和债券的长期预期回报都低于过去几十年，不能指望靠单一资产赚到历史平均。',
      '在价值、趋势 / 动量、套息、防御等风格溢价之间分散，比集中押注一个更稳。',
      '成本、税费和行为偏差会吃掉大部分超额收益，必须严格控制。',
    ],
    rules: ['把趋势策略和价值思路组合使用。', '跨资产分散（股票、债券、黄金）。'],
    actions: [
      { label: '全球资产轮动', route: 'rotation', rotation: '全球资产轮动' },
      { label: '策略对比', route: 'compare' },
    ],
  },
  {
    title: 'Quantitative Trading（第二版）',
    cn: '量化交易',
    author: 'Ernest P. Chan',
    year: '2021',
    tier: 'recent',
    ideas: [
      '回测最常见的陷阱：未来函数、幸存者偏差、数据窥探、忽略交易成本。',
      '均值回归和动量是两大类策略来源，要识别当前处于哪种市场状态。',
      '用凯利公式管理杠杆，并为策略失效（状态切换）做准备。',
    ],
    rules: ['信号用收盘后数据，次日开盘成交。', '回测必须扣除佣金、印花税和滑点。'],
    actions: [{ label: '策略回测（默认无未来函数）', route: 'backtest' }],
    source: 'https://www.amazon.com/Quantitative-Trading-Build-Algorithmic-Business/dp/1119800064',
  },
  {
    title: 'Stocks on the Move',
    cn: '动量选股',
    author: 'Andreas Clenow',
    year: '2015（经典）',
    tier: 'classic',
    ideas: [
      '用对数价格回归的年化斜率 × R² 给股票排名，奖励“涨得快又涨得稳”的股票。',
      '只买价格在 100 日均线上方、近期没有大幅跳空的股票；大盘跌破 200 日均线时停止买入。',
      '按 ATR 分配仓位，让每只股票的风险贡献相同。',
    ],
    rules: ['回归动量排名 + 均线过滤 + 跳空过滤。'],
    actions: [
      { label: 'Clenow 回归动量', route: 'backtest', strategy: 'clenow' },
      { label: '轮动中用 Clenow 排名', route: 'rotation', rotation: '风格轮动' },
    ],
    source: 'https://www.followingthetrend.com/stocks-on-the-move/',
  },
  {
    title: 'Dual Momentum Investing',
    cn: '双动量投资',
    author: 'Gary Antonacci',
    year: '2014（经典）',
    tier: 'classic',
    ideas: [
      '相对动量：在几个资产中选过去 12 个月最强的。',
      '绝对动量：如果最强的也跑不赢现金 / 国债，就转入债券避险。',
      '经典 GEM 组合：美股、非美股票、债券三选一，按月检查。',
    ],
    rules: ['12 个月动量、每月调仓、只持有一个、不达标转国债。'],
    actions: [{ label: '双动量 GEM 预设', route: 'rotation', rotation: '双动量 GEM' }],
    source: 'https://www.optimalmomentum.com/',
  },
];

const TIER_LABEL: Record<Book['tier'], string> = { new: '2025–2026 新书', recent: '近几年', classic: '经典' };

export default function LibraryPage() {
  const setStrategy = useApp((s) => s.setStrategy);
  const setConfig = useApp((s) => s.setConfig);
  const setPendingRotation = useApp((s) => s.setPendingRotation);
  const toast = useApp((s) => s.toast);
  const [filter, setFilter] = useState<'all' | Book['tier']>('all');

  const run = (a: Action) => {
    if (a.strategy) setStrategy(a.strategy);
    if (a.config) {
      setConfig(a.config);
      toast('已更新交易规则，可在「交易规则与风控」中修改');
    }
    if (a.rotation) setPendingRotation(a.rotation);
    navigate(a.route);
  };

  const list = BOOKS.filter((b) => filter === 'all' || b.tier === filter);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>量化书房</h1>
          <p>
            把近几年的量化投资书籍提炼成要点和可执行的规则，每本书都能一键跳到本站对应的功能去验证。书单优先收录 2022 年以后出版或再版的书，经典书只保留和本站功能直接相关的两本。
          </p>
        </div>
        <Seg
          ariaLabel="筛选"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: '全部' },
            { value: 'new', label: '新书' },
            { value: 'recent', label: '近几年' },
            { value: 'classic', label: '经典' },
          ]}
        />
      </div>

      <div className="banner">
        <span className="grow small">
          说明：这些要点依据出版社介绍、作者公开发表的论文和博客、书评以及通用的量化知识，用我们自己的话概括，不是逐页精读全文，也不引用原文。想深入请阅读原书。
        </span>
      </div>

      <div className="stack">
        {list.map((b) => (
          <Panel
            key={b.title}
            title={
              <>
                {b.cn} <span className="muted small" style={{ fontWeight: 400 }}>{b.title}</span>
              </>
            }
            extra={
              <span className="chips">
                <span className={`badge ${b.tier === 'new' ? 'gold' : ''}`}>{TIER_LABEL[b.tier]}</span>
                <span className="badge mono">{b.year}</span>
              </span>
            }
          >
            <div className="stack" style={{ gap: 10 }}>
              <div className="small dim">
                {b.author}
                {b.status && <span className="pill neutral" style={{ marginLeft: 8 }}>{b.status}</span>}
              </div>
              <div className="grid-2">
                <div>
                  <div className="xs muted" style={{ letterSpacing: '0.06em', marginBottom: 4 }}>
                    核心观点
                  </div>
                  <ul className="small" style={{ margin: 0, paddingLeft: '1.1em', display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {b.ideas.map((x) => (
                      <li key={x}>{x}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <div className="xs muted" style={{ letterSpacing: '0.06em', marginBottom: 4 }}>
                    可执行规则
                  </div>
                  <ul className="small" style={{ margin: 0, paddingLeft: '1.1em', display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {b.rules.map((x) => (
                      <li key={x}>{x}</li>
                    ))}
                  </ul>
                </div>
              </div>
              <div className="btn-row">
                {b.actions.map((a) => (
                  <button key={a.label} type="button" className="btn btn-sm btn-primary" onClick={() => run(a)}>
                    {a.label}
                  </button>
                ))}
                {b.source && (
                  <a className="btn btn-sm btn-ghost" href={b.source} target="_blank" rel="noreferrer">
                    参考来源
                  </a>
                )}
              </div>
            </div>
          </Panel>
        ))}
      </div>
    </div>
  );
}
