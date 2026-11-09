import { Fragment, useMemo, useState } from 'react';
import { fanOption, histogramOption, REASON } from '../app/charts';
import { fmtMoney, fmtNum, fmtPct, fmtPrice, shiftDate, toneClass } from '../app/format';
import { strategyByKey, strategyOptions, useApp } from '../app/store';
import { usePalette } from '../app/theme';
import { periodReturns } from '../lib/backtest/metrics';
import type { BacktestConfig, BacktestResult, MarketPreset, Metrics, Trade } from '../lib/backtest/types';
import { histogram, monteCarlo } from '../lib/montecarlo';
import { normalizeParams, type Params, type StrategyDef } from '../lib/strategies/types';
import type { Bar } from '../lib/types';
import { EChart } from './EChart';
import { Check, Collapsible, NumberField, Seg, SelectField, Tile } from './ui';

/* ---------------- 策略选择 + 参数 ---------------- */

export function StrategySelect({ value, onChange, id }: { value: string; onChange: (k: string) => void; id?: string }) {
  const customs = useApp((s) => s.customStrategies);
  const opts = strategyOptions(customs);
  return (
    <SelectField
      id={id}
      label="策略"
      value={value}
      onChange={onChange}
      options={opts.map((o) => ({ value: o.key, label: o.def.name, group: o.def.category }))}
    />
  );
}

export function ParamsForm({ def, params, onChange, idPrefix }: { def: StrategyDef; params: Params; onChange: (p: Params) => void; idPrefix?: string }) {
  if (!def.params.length) return <p className="muted small">该策略没有可调参数。</p>;
  return (
    <div className="fields">
      {def.params.map((pd) =>
        pd.options ? (
          <SelectField
            key={pd.key}
            id={idPrefix ? `${idPrefix}-${pd.key}` : undefined}
            label={pd.label}
            value={params[pd.key]}
            options={pd.options}
            onChange={(v) => onChange({ ...params, [pd.key]: v })}
          />
        ) : (
          <NumberField
            key={pd.key}
            id={idPrefix ? `${idPrefix}-${pd.key}` : undefined}
            label={pd.label}
            value={params[pd.key]}
            min={pd.min}
            max={pd.max}
            step={pd.step}
            hint={pd.hint}
            slider
            onChange={(v) => onChange({ ...params, [pd.key]: v })}
          />
        ),
      )}
    </div>
  );
}

/** 当前选中策略及参数（与全局状态同步） */
export function useCurrentStrategy() {
  const key = useApp((s) => s.strategyKey);
  const customs = useApp((s) => s.customStrategies);
  const saved = useApp((s) => s.paramsByStrategy[key]);
  const { def, spec } = useMemo(() => strategyByKey(key, customs), [key, customs]);
  const params = useMemo(() => normalizeParams(def, saved), [def, saved]);
  return { key, def, spec, params };
}

export function StrategyPanel() {
  const { key, def, params } = useCurrentStrategy();
  const setStrategy = useApp((s) => s.setStrategy);
  const setParams = useApp((s) => s.setParams);
  const [showDesc, setShowDesc] = useState(false);
  return (
    <Collapsible
      title="策略与参数"
      extra={
        def.params.length > 0 ? (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={(e) => {
              e.preventDefault();
              setParams(key, normalizeParams(def, {}));
            }}
          >
            恢复默认
          </button>
        ) : undefined
      }
    >
      <div className="fields">
        <StrategySelect id="bt-strategy" value={key} onChange={setStrategy} />
        <div className="small dim">
          {def.summary}{' '}
          <button type="button" className="btn btn-ghost btn-sm" style={{ padding: '0 4px', height: 22 }} onClick={() => setShowDesc((v) => !v)}>
            {showDesc ? '收起' : '原理'}
          </button>
        </div>
        {showDesc && <p className="code-desc">{def.description}</p>}
        <ParamsForm def={def} params={params} onChange={(p) => setParams(key, p)} idPrefix="bt" />
      </div>
    </Collapsible>
  );
}

/* ---------------- 回测区间 ---------------- */

export function RangePanel({ bars }: { bars: Bar[] }) {
  const range = useApp((s) => s.range);
  const setRange = useApp((s) => s.setRange);
  const first = bars[0]?.date ?? '';
  const last = bars[bars.length - 1]?.date ?? '';
  const quick = [
    { label: '近1年', y: 1 },
    { label: '近3年', y: 3 },
    { label: '近5年', y: 5 },
    { label: '全部', y: 0 },
  ];
  const activeQuick = quick.find((q) => (q.y === 0 ? !range.start && !range.end : !range.end && range.start === shiftDate(last, -q.y)));
  return (
    <Collapsible title="回测区间" extra={<span className="xs muted mono">{range.start || first} ~ {range.end || last}</span>}>
      <div className="fields">
        <div className="chips">
          {quick.map((q) => (
            <button
              type="button"
              key={q.label}
              className={`chip ${activeQuick === q ? 'on' : ''}`}
              onClick={() => setRange(q.y === 0 ? {} : { start: shiftDate(last, -q.y) })}
            >
              {q.label}
            </button>
          ))}
        </div>
        <div className="fields-2">
          <div className="field">
            <label htmlFor="range-start">开始日期</label>
            <input
              id="range-start"
              className="input num"
              type="date"
              min={first}
              max={last}
              value={range.start ?? ''}
              onChange={(e) => setRange({ ...range, start: e.target.value || undefined })}
            />
          </div>
          <div className="field">
            <label htmlFor="range-end">结束日期</label>
            <input
              id="range-end"
              className="input num"
              type="date"
              min={first}
              max={last}
              value={range.end ?? ''}
              onChange={(e) => setRange({ ...range, end: e.target.value || undefined })}
            />
          </div>
        </div>
        <p className="field-hint">指标使用区间之前的数据预热，避免开头阶段信号失真。</p>
      </div>
    </Collapsible>
  );
}

/* ---------------- 交易规则 ---------------- */

export function ConfigPanel({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const config = useApp((s) => s.config);
  const preset = useApp((s) => s.preset);
  const setPreset = useApp((s) => s.setPreset);
  const setConfigRaw = useApp((s) => s.setConfig);
  const setConfig = (p: Partial<BacktestConfig>) => {
    setConfigRaw(p);
    const marketKeys: (keyof BacktestConfig)[] = ['commissionRate', 'minCommission', 'stampTaxRate', 'stampTaxBothSides', 'lotSize', 'tPlusOne', 'limitCheck'];
    if (Object.keys(p).some((k) => marketKeys.includes(k as keyof BacktestConfig))) setPreset('custom');
  };
  return (
    <Collapsible title="交易规则与风控" defaultOpen={defaultOpen}>
      <div className="fields">
        <div className="field">
          <span className="field-label">市场规则</span>
          <Seg<MarketPreset>
            block
            ariaLabel="市场规则"
            value={preset}
            onChange={setPreset}
            options={[
              { value: 'A', label: 'A股' },
              { value: 'HK', label: '港股' },
              { value: 'US', label: '美股' },
              { value: 'custom', label: '自定义' },
            ]}
          />
        </div>
        <NumberField id="cfg-capital" label="初始资金" value={config.initialCapital} min={1000} step={10000} onChange={(v) => setConfig({ initialCapital: v })} />
        <div className="fields-2">
          <NumberField id="cfg-comm" label="佣金" suffix="万分之" value={config.commissionRate} scale={10000} min={0} max={30} step={0.1} onChange={(v) => setConfig({ commissionRate: v })} />
          <NumberField id="cfg-mincomm" label="最低佣金" suffix="元" value={config.minCommission} min={0} max={50} step={1} onChange={(v) => setConfig({ minCommission: v })} />
          <NumberField id="cfg-stamp" label="印花税" suffix="千分之" value={config.stampTaxRate} scale={1000} min={0} max={5} step={0.1} onChange={(v) => setConfig({ stampTaxRate: v })} />
          <NumberField id="cfg-slip" label="滑点" suffix="%" value={config.slippage} scale={100} min={0} max={2} step={0.05} onChange={(v) => setConfig({ slippage: v })} />
          <NumberField id="cfg-lot" label="每手股数" value={config.lotSize} min={1} max={10000} step={1} onChange={(v) => setConfig({ lotSize: Math.round(v) })} />
          <NumberField id="cfg-rf" label="无风险利率" suffix="%" value={config.riskFreeRate} scale={100} min={0} max={10} step={0.1} onChange={(v) => setConfig({ riskFreeRate: v })} />
        </div>
        <SelectField<'nextOpen' | 'close'>
          id="cfg-exec"
          label="成交时点"
          value={config.execution}
          onChange={(v) => setConfig({ execution: v })}
          options={[
            { value: 'nextOpen', label: '信号次日开盘价成交（推荐，无未来函数）' },
            { value: 'close', label: '信号当日收盘价成交（偏乐观）' },
          ]}
        />
        <div className="fields-2">
          <Check label="T+1 交易" checked={config.tPlusOne} onChange={(v) => setConfig({ tPlusOne: v })} />
          <Check label="涨跌停限制" checked={config.limitCheck} onChange={(v) => setConfig({ limitCheck: v })} />
          <Check label="印花税双边" checked={config.stampTaxBothSides} onChange={(v) => setConfig({ stampTaxBothSides: v })} />
        </div>
        <div className="fields-2">
          <NumberField id="cfg-sl" label="止损" suffix="%" value={config.stopLoss} scale={100} min={0} max={50} step={1} hint="0 为关闭" onChange={(v) => setConfig({ stopLoss: v })} />
          <NumberField id="cfg-tp" label="止盈" suffix="%" value={config.takeProfit} scale={100} min={0} max={500} step={1} hint="0 为关闭" onChange={(v) => setConfig({ takeProfit: v })} />
          <NumberField id="cfg-ts" label="移动止损" suffix="%" value={config.trailingStop} scale={100} min={0} max={50} step={1} hint="自持仓最高点回撤" onChange={(v) => setConfig({ trailingStop: v })} />
        </div>
      </div>
    </Collapsible>
  );
}

/* ---------------- 指标 ---------------- */

export function SummaryTiles({ m }: { m: Metrics }) {
  return (
    <div className="tiles">
      <Tile label="总收益" value={fmtPct(m.totalReturn)} tone={toneClass(m.totalReturn)} sub={`基准 ${fmtPct(m.benchmarkReturn)}`} />
      <Tile label="年化收益" value={fmtPct(m.annualReturn)} tone={toneClass(m.annualReturn)} sub={`基准 ${fmtPct(m.benchmarkAnnualReturn)}`} />
      <Tile label="最大回撤" value={fmtPct(m.maxDrawdown)} tone="down" sub={`基准 ${fmtPct(m.benchmarkMaxDrawdown)}`} />
      <Tile label="夏普比率" value={fmtNum(m.sharpe)} sub={`基准 ${fmtNum(m.benchmarkSharpe)}`} />
      <Tile label="胜率" value={fmtPct(m.winRate, 1, false)} sub={`${m.tradeCount} 笔交易`} />
      <Tile label="盈亏比" value={fmtNum(m.profitLossRatio)} sub={`利润因子 ${fmtNum(m.profitFactor)}`} />
    </div>
  );
}

export function MetricsTable({ m }: { m: Metrics }) {
  const rows: [string, string, string?, string?][] = [
    ['期末资产', fmtMoney(m.finalEquity), fmtMoney(m.initialCapital * (1 + m.benchmarkReturn))],
    ['总收益率', fmtPct(m.totalReturn), fmtPct(m.benchmarkReturn), toneClass(m.totalReturn)],
    ['年化收益率', fmtPct(m.annualReturn), fmtPct(m.benchmarkAnnualReturn), toneClass(m.annualReturn)],
    ['超额收益', fmtPct(m.excessReturn), '—', toneClass(m.excessReturn)],
    ['年化波动率', fmtPct(m.annualVolatility, 2, false), '—'],
    ['最大回撤', fmtPct(m.maxDrawdown), fmtPct(m.benchmarkMaxDrawdown)],
    ['最大回撤区间', `${m.maxDrawdownStart} ~ ${m.maxDrawdownEnd}`, '—'],
    ['最长回撤期', `${m.maxDrawdownDuration} 根K线`, '—'],
    ['夏普比率', fmtNum(m.sharpe), fmtNum(m.benchmarkSharpe)],
    ['索提诺比率', fmtNum(m.sortino), '—'],
    ['卡玛比率', fmtNum(m.calmar), '—'],
    ['Alpha（年化）', fmtPct(m.alpha), '—'],
    ['Beta', fmtNum(m.beta), '1.00'],
    ['信息比率', fmtNum(m.informationRatio), '—'],
    ['交易次数', String(m.tradeCount), '1'],
    ['胜率', fmtPct(m.winRate, 1, false), '—'],
    ['盈亏比', fmtNum(m.profitLossRatio), '—'],
    ['利润因子', fmtNum(m.profitFactor), '—'],
    ['平均每笔收益', fmtPct(m.avgTradeReturn), '—'],
    ['平均持仓', `${fmtNum(m.avgHoldingBars, 1)} 根K线`, '—'],
    ['最大连续亏损', `${m.maxConsecutiveLosses} 笔`, '—'],
    ['持仓时间占比', fmtPct(m.exposure, 1, false), '100%'],
    ['手续费合计', fmtMoney(m.totalFees), '—'],
    ['回测长度', `${m.bars} 根 / ${fmtNum(m.years, 1)} 年`, '—'],
  ];
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            <th>指标</th>
            <th>策略</th>
            <th>基准（买入持有）</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([k, a, b, tone]) => (
            <tr key={k}>
              <td className="text dim">{k}</td>
              <td className={tone}>{a}</td>
              <td className="dim">{b}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------- 交易明细 ---------------- */

export function TradesTable({ trades }: { trades: Trade[] }) {
  const [limit, setLimit] = useState(50);
  if (!trades.length) return <div className="empty">回测区间内没有发生交易。</div>;
  const list = [...trades].reverse();
  return (
    <>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>买入日期</th>
              <th>卖出日期</th>
              <th>买入均价</th>
              <th>卖出均价</th>
              <th>股数</th>
              <th>盈亏</th>
              <th>收益率</th>
              <th>持有</th>
              <th>离场原因</th>
            </tr>
          </thead>
          <tbody>
            {list.slice(0, limit).map((t, i) => (
              <tr key={i}>
                <td>{t.entryDate}</td>
                <td>{t.open ? <span className="pill gold">持仓中</span> : t.exitDate}</td>
                <td>{fmtPrice(t.entryPrice)}</td>
                <td>{fmtPrice(t.exitPrice)}</td>
                <td>{t.shares.toLocaleString()}</td>
                <td className={toneClass(t.pnl)}>{fmtMoney(t.pnl)}</td>
                <td className={toneClass(t.returnPct)}>{fmtPct(t.returnPct)}</td>
                <td>{t.holdingBars}</td>
                <td className="text dim">{REASON[t.exitReason]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {list.length > limit && (
        <div style={{ padding: 12, textAlign: 'center' }}>
          <button type="button" className="btn btn-sm" onClick={() => setLimit((l) => l + 100)}>
            显示更多（共 {list.length} 笔）
          </button>
        </div>
      )}
    </>
  );
}

/* ---------------- 月度收益 ---------------- */

export function MonthlyTable({ result }: { result: BacktestResult }) {
  const months = periodReturns(result.dates, result.equity, result.config.initialCapital, 'month');
  const years = periodReturns(result.dates, result.equity, result.config.initialCapital, 'year');
  const byYear = new Map<string, Map<number, number>>();
  for (const m of months) {
    const [y, mo] = m.key.split('-');
    if (!byYear.has(y)) byYear.set(y, new Map());
    byYear.get(y)!.set(Number(mo), m.ret);
  }
  const cell = (r: number | undefined) => {
    if (r === undefined) return <td />;
    const a = Math.min(1, Math.abs(r) / 0.12);
    const c = r >= 0 ? 'var(--up)' : 'var(--down)';
    return (
      <td style={{ background: `color-mix(in srgb, ${c} ${Math.round(a * 45)}%, transparent)` }}>{(r * 100).toFixed(1)}</td>
    );
  };
  return (
    <div className="table-wrap">
      <table className="data heat">
        <thead>
          <tr>
            <th>年份</th>
            {Array.from({ length: 12 }, (_, i) => (
              <th key={i}>{i + 1}月</th>
            ))}
            <th>全年</th>
          </tr>
        </thead>
        <tbody>
          {[...byYear.entries()].reverse().map(([y, ms]) => (
            <tr key={y}>
              <td>{y}</td>
              {Array.from({ length: 12 }, (_, i) => (
                <Fragment key={i}>{cell(ms.get(i + 1))}</Fragment>
              ))}
              {cell(years.find((x) => x.key === y)?.ret)}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="field-hint" style={{ padding: '8px 14px' }}>
        单位：%，颜色越深幅度越大。
      </p>
    </div>
  );
}

/* ---------------- 蒙特卡洛 ---------------- */

export function MonteCarloView({ result }: { result: BacktestResult }) {
  const p = usePalette();
  const [sims, setSims] = useState(1000);
  const mc = useMemo(() => {
    try {
      return monteCarlo(result.equity, sims, 5, 7);
    } catch {
      return null;
    }
  }, [result.equity, sims]);
  if (!mc) return <div className="empty">数据太短，无法模拟。</div>;
  const actual = mc.steps.map((s) => result.equity[s] / result.equity[0]);
  const hr = histogram(mc.finalReturns, 30);
  const hd = histogram(mc.maxDrawdowns, 30);
  return (
    <div className="stack" style={{ padding: '4px 14px 14px' }}>
      <div className="toolbar" style={{ justifyContent: 'space-between' }}>
        <p className="small dim" style={{ maxWidth: '70ch' }}>
          把策略的历史日收益按 5 日一块随机重排，生成 {sims} 条“平行世界”的净值路径，观察同一策略在不同运气下的收益和回撤范围。
        </p>
        <Seg
          ariaLabel="模拟次数"
          value={sims}
          onChange={setSims}
          options={[
            { value: 500, label: '500 次' },
            { value: 1000, label: '1000 次' },
            { value: 3000, label: '3000 次' },
          ]}
        />
      </div>
      <div className="tiles">
        <Tile label="收益中位数" value={fmtPct(mc.medianReturn)} tone={toneClass(mc.medianReturn)} />
        <Tile label="亏损概率" value={fmtPct(mc.probLoss, 1, false)} />
        <Tile label="95% VaR（期末收益）" value={fmtPct(mc.var95)} tone={toneClass(mc.var95)} sub="5% 的情形差于此值" />
        <Tile label="回撤中位数" value={fmtPct(mc.medianMaxDrawdown)} tone="down" />
        <Tile label="较差情形回撤" value={fmtPct(mc.worstMaxDrawdown5)} tone="down" sub="5% 分位" />
      </div>
      <EChart option={fanOption({ steps: mc.steps, bands: mc.bands, actual }, p)} height={300} />
      <div className="grid-2">
        <div>
          <div className="small dim">期末收益分布</div>
          <EChart option={histogramOption({ x: hr.x, count: hr.count, fmt: (v) => (v * 100).toFixed(0) + '%' }, p)} height={200} />
        </div>
        <div>
          <div className="small dim">最大回撤分布</div>
          <EChart option={histogramOption({ x: hd.x, count: hd.count, fmt: (v) => (v * 100).toFixed(0) + '%', color: p.down }, p)} height={200} />
        </div>
      </div>
    </div>
  );
}
