import { useMemo, useState } from 'react';
import { fmtNum, fmtPct, fmtPrice, toneClass } from '../app/format';
import { navigate } from '../app/router';
import { useApp } from '../app/store';
import { Check, NumberField, Panel, Tabs, Tile } from '../components/ui';
import { fetchValuation } from '../lib/data/eastmoney';
import { dcf, impliedGrowth, kellyFraction, mertonShare, qualityChecklist, retainedTest } from '../lib/valuation';

type ToolTab = 'value' | 'quality' | 'retained' | 'sizing';

const TIMELINE: { date: string; title: string; points: string[]; href: string }[] = [
  {
    date: '2025-02',
    title: '巴菲特最后一封年度股东信（2024 年度）',
    points: [
      '用大篇幅谈“犯错”：承认错误、及时纠正比假装正确更重要。',
      '重申伯克希尔的大部分钱会一直放在股票（企业所有权）上，而不是现金或债券。',
      '继续加仓日本五大商社，强调长期持有与管理层的可信度。',
    ],
    href: 'https://www.berkshirehathaway.com/letters/letters.html',
  },
  {
    date: '2025-11-10',
    title: '巴菲特卸任前的感恩节信',
    points: [
      '确认 Greg Abel 年底接任 CEO；巴菲特不再写年报信、不再在股东大会发言，但保留感恩节信。',
      '提醒股东：伯克希尔股价在他任内三次腰斩又都恢复，长期持有就要承受这种波动。',
      '继续持有大量现金，因为找不到价格足够有吸引力的标的。',
    ],
    href: 'https://www.fortune.com/2025/11/27/read-warren-buffett-final-thanksgiving-annual-letter-shareholders-2025',
  },
  {
    date: '2026-02-28',
    title: 'Greg Abel 第一封股东信（2025 年度）',
    points: [
      '强调延续：文化和价值观不变，把巴菲特的遗产“加强而不是重塑”。',
      '管理层是股东资本的“管家”：资本配置要有纪律，宁可持有现金等待机会。',
      '回购没有最低或最高额度，只在价格低于内在价值时进行。',
    ],
    href: 'https://www.cnbc.com/2026/03/01/all-the-highlights-from-berkshire-ceo-abels-first-shareholder-letter.html',
  },
];

const PRINCIPLES: { title: string; idea: string; howto: string }[] = [
  { title: '能力圈', idea: '只投自己真正理解的生意，圈子大小不重要，知道边界在哪里才重要。', howto: '质量清单第一项必须勾选，否则不往下算。' },
  { title: '护城河', idea: '好生意能长期抵御竞争：品牌、成本优势、网络效应、转换成本、特许经营。', howto: '用长期 ROE ≥ 15%、毛利率稳定来近似识别。' },
  { title: '所有者盈余', idea: '股东真正能拿走的钱 = 净利润 + 折旧摊销 − 维持性资本开支 − 营运资本增加。', howto: '内在价值计算器用它而不是 EPS 折现。' },
  { title: '安全边际', idea: '估值一定不精确，只在价格明显低于内在价值时买入，给错误留余地。', howto: '计算器给出“买入价上限”= 内在价值 ×（1 − 安全边际）。' },
  { title: '市场先生', idea: '市场每天报一个情绪化的价格，你可以利用它，但不要被它指挥。', howto: '「市场先生（恐慌加仓）」策略演示了在大幅回撤时加仓。' },
  { title: '一美元测试', idea: '公司每留存 1 元利润，应该为股东创造至少 1 元市值，否则不如分红。', howto: '留存收益测试工具。' },
  { title: '少用杠杆', idea: '聪明人因为杠杆破产的故事太多；有些损失无法翻身。', howto: '资产负债率检查；回测里不加杠杆。' },
  { title: '长期持有', idea: '“如果你不愿意持有一只股票十年，那就连十分钟都不要持有。”复利需要时间。', howto: '用「买入持有」作为所有策略的基准，频繁交易必须先跑赢它。' },
  { title: '管理层与资本配置', idea: '选诚实、理性的管理者；看他们如何使用留存的钱：再投资、并购、回购还是分红。', howto: '质量清单最后一项；结合留存收益测试。' },
  { title: '大多数人买指数', idea: '对没有时间研究的普通投资者，巴菲特多次推荐低成本的宽基指数基金。', howto: '在回测里用沪深300ETF 等宽基做“买入持有”对照。' },
];

export default function BuffettPage() {
  const stock = useApp((s) => s.stock)!;
  const toast = useApp((s) => s.toast);
  const setStrategy = useApp((s) => s.setStrategy);
  const lastPrice = stock.bars[stock.bars.length - 1].close;
  const [tab, setTab] = useState<ToolTab>('value');

  // 估值
  const [price, setPrice] = useState(lastPrice);
  const [oe, setOe] = useState(Math.round(lastPrice * 0.05 * 100) / 100);
  const [growth, setGrowth] = useState(0.1);
  const [years, setYears] = useState(10);
  const [tg, setTg] = useState(0.03);
  const [disc, setDisc] = useState(0.1);
  const [mos, setMos] = useState(0.3);
  const [fetching, setFetching] = useState(false);

  // 质量
  const [roe, setRoe] = useState(NaN);
  const [gm, setGm] = useState(NaN);
  const [debt, setDebt] = useState(NaN);
  const [fcf, setFcf] = useState(NaN);
  const [profitYears, setProfitYears] = useState(NaN);
  const [pe, setPe] = useState(NaN);
  const [understand, setUnderstand] = useState(false);
  const [integrity, setIntegrity] = useState(false);

  // 留存
  const [cap0, setCap0] = useState(1000);
  const [cap1, setCap1] = useState(1600);
  const [retained, setRetained] = useState(400);

  // 仓位
  const [expRet, setExpRet] = useState(0.08);
  const [rf, setRf] = useState(0.02);
  const [vol, setVol] = useState(0.25);
  const [gamma, setGamma] = useState(2);
  const [winRate, setWinRate] = useState(0.45);
  const [payoff, setPayoff] = useState(2);

  const base = { ownerEarnings: oe, years, terminalGrowth: tg, discount: disc };
  const result = useMemo(() => dcf({ ...base, growth }), [oe, years, tg, disc, growth]); // eslint-disable-line react-hooks/exhaustive-deps
  const implied = useMemo(() => impliedGrowth(price, base), [price, oe, years, tg, disc]); // eslint-disable-line react-hooks/exhaustive-deps
  const buyBelow = result.value * (1 - mos);
  const margin = result.value > 0 ? 1 - price / result.value : NaN;
  const quality = qualityChecklist({ roe, grossMargin: gm, debtRatio: debt, fcfConversion: fcf, profitYears, pe, understand, integrity });

  const autofill = async () => {
    setFetching(true);
    try {
      const v = await fetchValuation(stock.meta.secid);
      if (Number.isFinite(v.price) && v.price > 0) setPrice(v.price);
      if (Number.isFinite(v.pe)) {
        setPe(v.pe);
        setOe(Math.round(((v.price || price) / v.pe) * 100) / 100);
      }
      if (Number.isFinite(v.roe)) setRoe(v.roe);
      toast('已填入 PE / ROE / 价格，请到财报核对，并把每股收益调整为所有者盈余');
    } catch (e) {
      toast(`读取失败：${(e as Error).message}。请手动填写。`, 'error');
    } finally {
      setFetching(false);
    }
  };

  const grid = useMemo(() => {
    const rs = [-0.02, -0.01, 0, 0.01, 0.02].map((d) => disc + d).filter((r) => r > tg + 0.005);
    const gs = [-0.04, -0.02, 0, 0.02, 0.04].map((d) => growth + d);
    return { rs, gs, v: rs.map((r) => gs.map((g) => dcf({ ownerEarnings: oe, years, terminalGrowth: tg, discount: r, growth: g }).value)) };
  }, [disc, tg, growth, oe, years]);

  const pctField = (id: string, label: string, v: number, set: (x: number) => void, min: number, max: number, step = 0.5, hint?: string) => (
    <NumberField id={id} label={label} suffix="%" value={Number.isFinite(v) ? v : 0} scale={100} min={min} max={max} step={step} hint={hint} onChange={set} />
  );

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>巴菲特工具箱</h1>
          <p>
            把巴菲特的投资原则变成可以算的东西：所有者盈余估值、安全边际、护城河质量清单、留存收益测试和仓位计算。量化回测回答“什么时候买卖”，这里回答“买什么、值多少钱、买多少”。
          </p>
        </div>
      </div>

      <Panel title="最新动态（2025–2026）">
        <div className="guide-grid">
          {TIMELINE.map((t) => (
            <article key={t.date} className="panel" style={{ background: 'var(--panel-2)' }}>
              <div className="panel-head">
                <h3 className="panel-title">{t.title}</h3>
                <span className="badge gold mono">{t.date}</span>
              </div>
              <div className="panel-body">
                <ul className="small dim" style={{ margin: 0, paddingLeft: '1.1em', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {t.points.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
                <a className="xs" href={t.href} target="_blank" rel="noreferrer">
                  来源
                </a>
              </div>
            </article>
          ))}
        </div>
      </Panel>

      <section className="panel">
        <Tabs<ToolTab>
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'value', label: '内在价值' },
            { id: 'quality', label: '质量清单' },
            { id: 'retained', label: '一美元测试' },
            { id: 'sizing', label: '仓位计算' },
          ]}
        />
        <div className="panel-body">
          {tab === 'value' && (
            <div className="grid-2" style={{ alignItems: 'start' }}>
              <div className="fields">
                <div className="btn-row">
                  <span className="small dim">
                    当前：{stock.meta.name} {fmtPrice(lastPrice)}
                  </span>
                  {(stock.meta.market === 'A' || stock.meta.market === 'HK' || stock.meta.market === 'US') && (
                    <button type="button" className="btn btn-sm" disabled={fetching} onClick={() => void autofill()}>
                      {fetching ? '读取中…' : '读取 PE / ROE（实验）'}
                    </button>
                  )}
                </div>
                <div className="fields-2">
                  <NumberField id="v-price" label="当前股价" value={price} min={0} step={0.01} onChange={setPrice} />
                  <NumberField id="v-oe" label="每股所有者盈余" value={oe} min={-1e6} step={0.01} hint="可先用每股自由现金流近似" onChange={setOe} />
                  {pctField('v-growth', '前期增长率', growth, setGrowth, -30, 60, 0.5)}
                  <NumberField id="v-years" label="前期年数" value={years} min={1} max={30} step={1} onChange={(v) => setYears(Math.round(v))} />
                  {pctField('v-tg', '永续增长率', tg, setTg, -5, 6, 0.5, '一般不高于长期名义 GDP 增速')}
                  {pctField('v-disc', '折现率', disc, setDisc, 3, 30, 0.5, '你要求的年化回报')}
                </div>
                {pctField('v-mos', '安全边际', mos, setMos, 0, 70, 5)}
              </div>
              <div className="stack" style={{ gap: 12 }}>
                <div className="tiles">
                  <Tile label="每股内在价值" value={fmtPrice(result.value)} sub={`前期 ${fmtPrice(result.stage1)} + 终值 ${fmtPrice(result.terminal)}`} />
                  <Tile label="买入价上限" value={fmtPrice(buyBelow)} sub={`留 ${fmtPct(mos, 0, false)} 安全边际`} />
                  <Tile label="当前安全边际" value={fmtPct(margin, 1)} tone={toneClass(margin)} sub={price <= buyBelow ? '低于买入价上限' : '价格偏高'} />
                  <Tile label="价格隐含增长率" value={fmtPct(implied, 1)} sub={`未来 ${years} 年每年`} />
                </div>
                <p className="small dim">
                  {Number.isFinite(implied)
                    ? `按 ${fmtPct(disc, 1, false)} 的折现率，当前价格意味着市场预期所有者盈余未来 ${years} 年每年增长约 ${fmtPct(implied, 1, false)}。问问自己：这家公司做得到吗？`
                    : '所有者盈余为负或参数无效时无法反推隐含增长率。'}
                </p>
                <div className="table-wrap">
                  <table className="data heat">
                    <thead>
                      <tr>
                        <th>折现率 \ 增长</th>
                        {grid.gs.map((g) => (
                          <th key={g}>{fmtPct(g, 0, false)}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {grid.rs.map((r, i) => (
                        <tr key={r}>
                          <td>{fmtPct(r, 1, false)}</td>
                          {grid.v[i].map((v, j) => (
                            <td
                              key={j}
                              style={{ background: `color-mix(in srgb, ${v >= price ? 'var(--up)' : 'var(--down)'} ${Math.round(Math.min(1, Math.abs(v / price - 1)) * 40)}%, transparent)` }}
                            >
                              {fmtPrice(v)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="xs muted">敏感性表：颜色偏“涨”色表示内在价值高于当前价。估值对增长率和折现率非常敏感，这正是需要安全边际的原因。</p>
              </div>
            </div>
          )}

          {tab === 'quality' && (
            <div className="grid-2" style={{ alignItems: 'start' }}>
              <div className="fields">
                <Check label="我能讲清楚它怎么赚钱（能力圈）" checked={understand} onChange={setUnderstand} />
                <div className="fields-2">
                  {pctField('q-roe', '近 5~10 年平均 ROE', roe, setRoe, -50, 100)}
                  {pctField('q-gm', '毛利率', gm, setGm, -50, 100)}
                  {pctField('q-debt', '资产负债率', debt, setDebt, 0, 100)}
                  {pctField('q-fcf', '自由现金流 / 净利润', fcf, setFcf, -100, 300, 5)}
                  <NumberField id="q-py" label="近 10 年盈利年数" value={Number.isFinite(profitYears) ? profitYears : 0} min={0} max={10} step={1} onChange={setProfitYears} />
                  <NumberField id="q-pe" label="市盈率 PE" value={Number.isFinite(pe) ? pe : 0} min={0} max={1000} step={0.1} onChange={setPe} />
                </div>
                <Check label="管理层诚实、理性配置资本" checked={integrity} onChange={setIntegrity} />
                <p className="field-hint">数据可从公司年报或行情软件 F10 获得。只有填写过的项目才参与评分。</p>
              </div>
              <div className="stack" style={{ gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span className="mono" style={{ fontSize: '2rem', lineHeight: 1 }}>
                    {quality.score}
                  </span>
                  <span className="muted small">/ 100 通过率</span>
                </div>
                <div className="diag-list">
                  {quality.items.map((it) => (
                    <div key={it.key} className="diag-item">
                      <span className="t">{it.title}</span>
                      <span className="small">{it.rule}</span>
                      <span className={`pill ${it.pass === null ? 'neutral' : it.pass ? 'bull' : 'bear'}`}>{it.pass === null ? '未填' : it.pass ? '通过' : '不通过'}</span>
                      <span className="d">{it.why}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {tab === 'retained' && (
            <div className="grid-2" style={{ alignItems: 'start' }}>
              <div className="fields">
                <p className="small dim">
                  巴菲特的“一美元前提”：在一段时期内，公司留存（没有分掉）的每 1 元利润，应该让市值至少增加 1 元。低于 1 说明管理层把钱用在了回报不高的地方，不如分红或回购。
                </p>
                <NumberField id="r-cap0" label="期初市值（亿）" value={cap0} min={0} step={10} onChange={setCap0} />
                <NumberField id="r-cap1" label="期末市值（亿）" value={cap1} min={0} step={10} onChange={setCap1} />
                <NumberField id="r-ret" label="期间累计留存利润（亿）" value={retained} min={0} step={10} hint="= 期间净利润合计 − 分红合计" onChange={setRetained} />
              </div>
              <div className="tiles">
                <Tile label="每 1 元留存创造的市值" value={fmtNum(retainedTest(cap0, cap1, retained))} tone={retainedTest(cap0, cap1, retained) >= 1 ? 'up' : 'down'} sub={retainedTest(cap0, cap1, retained) >= 1 ? '通过一美元测试' : '未通过'} />
              </div>
            </div>
          )}

          {tab === 'sizing' && (
            <div className="grid-2" style={{ alignItems: 'start' }}>
              <div className="fields">
                <p className="small dim">
                  来自《The Missing Billionaires》(Haghani & White)：很多投资失败不是选错了，而是买得太多。最优仓位（Merton 比例）= 超额收益 ÷（风险厌恶 × 波动率²）。风险厌恶 1 相当于全凯利，2 相当于半凯利。
                </p>
                <div className="fields-2">
                  {pctField('s-exp', '预期年化收益', expRet, setExpRet, -20, 50)}
                  {pctField('s-rf', '无风险利率', rf, setRf, 0, 10, 0.1)}
                  {pctField('s-vol', '年化波动率', vol, setVol, 1, 150)}
                  <NumberField id="s-gamma" label="风险厌恶系数 γ" value={gamma} min={0.5} max={10} step={0.5} onChange={setGamma} />
                </div>
                <div className="fields-2">
                  {pctField('s-win', '交易胜率', winRate, setWinRate, 1, 99, 1)}
                  <NumberField id="s-payoff" label="盈亏比" value={payoff} min={0.1} max={20} step={0.1} onChange={setPayoff} />
                </div>
              </div>
              <div className="stack" style={{ gap: 10 }}>
                <div className="tiles">
                  <Tile label="Merton 最优仓位" value={fmtPct(mertonShare(expRet, rf, vol, gamma), 0, false)} sub={`γ = ${gamma}`} />
                  <Tile label="凯利比例（每笔）" value={fmtPct(kellyFraction(winRate, payoff), 0, false)} sub={`半凯利 ${fmtPct(kellyFraction(winRate, payoff) / 2, 0, false)}`} />
                </div>
                <p className="xs muted">
                  结果超过 100% 表示理论上应加杠杆，但预期收益的估计误差很大，实践中应打折使用；结果为负表示不应持有。回测页的绩效指标里也会根据策略历史表现给出凯利与 Merton 建议值。
                </p>
              </div>
            </div>
          )}
        </div>
      </section>

      <Panel title="巴菲特的十条原则，以及在本站怎么用">
        <div className="table-wrap">
          <table className="data">
            <tbody>
              {PRINCIPLES.map((p) => (
                <tr key={p.title}>
                  <td className="text" style={{ width: 110, verticalAlign: 'top' }}>
                    <b>{p.title}</b>
                  </td>
                  <td className="text left" style={{ whiteSpace: 'normal' }}>
                    <div className="small">{p.idea}</div>
                    <div className="xs muted" style={{ marginTop: 2 }}>
                      落地：{p.howto}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="btn-row" style={{ marginTop: 12 }}>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setStrategy('mr_market');
              navigate('backtest');
            }}
          >
            回测「市场先生」策略
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setStrategy('buy_hold');
              navigate('backtest');
            }}
          >
            回测长期持有
          </button>
        </div>
      </Panel>
      <p className="xs muted">
        本页的原则提炼自巴菲特历年股东信及公开报道，用我们自己的话概括，并非原文引用。实验性数据读取依赖东方财富网页接口，字段可能变化，请以公司财报为准。
      </p>
    </div>
  );
}
