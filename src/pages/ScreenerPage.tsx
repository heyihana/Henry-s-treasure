import { useMemo, useRef, useState } from 'react';
import { computeStrategy } from '../app/compute';
import { fmtNum, fmtPct, fmtPrice, shiftDate, toneClass } from '../app/format';
import { navigate } from '../app/router';
import { strategyByKey, useApp } from '../app/store';
import { StrategySelect } from '../components/BacktestParts';
import { StockSearch } from '../components/StockPicker';
import { Collapsible, Empty, Panel, Progress, Seg } from '../components/ui';
import { diagnose, stockStats } from '../lib/analysis';
import { runBacktest } from '../lib/backtest/engine';
import { rangeToIndex } from '../lib/backtest/run';
import { MARKET_PRESETS } from '../lib/backtest/types';
import { DEFAULT_WATCHLIST, DEMO_SPECS, loadStock } from '../lib/data';
import { normalizeParams } from '../lib/strategies/types';
import type { StockMeta } from '../lib/types';

type Signal = 'buy' | 'sell' | 'hold' | 'flat';

interface Row {
  meta: StockMeta;
  error?: string;
  last?: number;
  chg?: number;
  ret20?: number;
  ret60?: number;
  ytd?: number;
  vol?: number;
  rsi?: number;
  trend?: 'up' | 'down' | 'mixed';
  score?: number;
  signal?: Signal;
  annual?: number;
  sharpe?: number;
  mdd?: number;
  bench?: number;
}

const SIGNAL: Record<Signal, { text: string; cls: string; rank: number }> = {
  buy: { text: '买入信号', cls: 'bull', rank: 3 },
  hold: { text: '持有', cls: 'gold', rank: 2 },
  sell: { text: '卖出信号', cls: 'bear', rank: 1 },
  flat: { text: '空仓', cls: 'neutral', rank: 0 },
};

type SortKey = 'chg' | 'ret20' | 'ret60' | 'ytd' | 'vol' | 'rsi' | 'score' | 'signal' | 'annual' | 'sharpe' | 'mdd';

export default function ScreenerPage() {
  const watchlist = useApp((s) => s.watchlist);
  const addWatch = useApp((s) => s.addWatch);
  const removeWatch = useApp((s) => s.removeWatch);
  const customs = useApp((s) => s.customStrategies);
  const config = useApp((s) => s.config);
  const preset = useApp((s) => s.preset);
  const paramsByStrategy = useApp((s) => s.paramsByStrategy);
  const globalKey = useApp((s) => s.strategyKey);
  const load = useApp((s) => s.load);
  const [key, setKey] = useState(globalKey);
  const [years, setYears] = useState(3);
  const [rows, setRows] = useState<Row[]>([]);
  const [progress, setProgress] = useState<number | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'signal', desc: true });
  const cancelRef = useRef(false);

  const scan = async () => {
    cancelRef.current = false;
    const { def, spec } = strategyByKey(key, customs);
    const params = normalizeParams(def, paramsByStrategy[key]);
    const list = [...watchlist];
    setProgress(0);
    setRows(list.map((meta) => ({ meta })));
    let done = 0;
    const results: Row[] = list.map((meta) => ({ meta }));
    const worker = async (i: number) => {
      const meta = list[i];
      try {
        const d = await loadStock(meta, { period: 'day', adjust: 'qfq' });
        const bars = d.bars;
        const st = stockStats(bars);
        const diag = diagnose(bars);
        const out = await computeStrategy(spec, bars, params);
        const pos = out.position;
        const cur = pos[pos.length - 1] ?? 0;
        const prev = pos[pos.length - 2] ?? 0;
        const signal: Signal = cur > prev ? 'buy' : cur < prev ? 'sell' : cur > 0 ? 'hold' : 'flat';
        const { start, end } = rangeToIndex(bars, { start: shiftDate(bars[bars.length - 1].date, -years) });
        const cfg = preset === 'custom' ? config : { ...config, ...MARKET_PRESETS[meta.market === 'HK' ? 'HK' : meta.market === 'US' ? 'US' : 'A'] };
        const bt = runBacktest(bars, pos, cfg, { start, end });
        results[i] = {
          meta: { ...meta, name: d.meta.name || meta.name },
          last: st.last,
          chg: st.changePct,
          ret20: st.ret20,
          ret60: st.ret60,
          ytd: st.ytd,
          vol: st.vol250,
          rsi: st.rsi14,
          trend: st.aboveMa20 && st.aboveMa60 ? 'up' : !st.aboveMa20 && !st.aboveMa60 ? 'down' : 'mixed',
          score: diag.score,
          signal,
          annual: bt.metrics.annualReturn,
          sharpe: bt.metrics.sharpe,
          mdd: bt.metrics.maxDrawdown,
          bench: bt.metrics.benchmarkAnnualReturn,
        };
      } catch (e) {
        results[i] = { meta, error: (e as Error).message };
      }
      done++;
      setProgress(done / list.length);
      setRows([...results]);
    };
    // 并发 3 个请求
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(3, list.length) }, async () => {
        while (next < list.length && !cancelRef.current) await worker(next++);
      }),
    );
    setProgress(null);
  };

  const sorted = useMemo(() => {
    const val = (r: Row): number => {
      if (r.error) return -Infinity;
      if (sort.key === 'signal') return r.signal ? SIGNAL[r.signal].rank * 1000 + (r.score ?? 0) : -Infinity;
      return (r[sort.key] as number | undefined) ?? -Infinity;
    };
    return [...rows].sort((a, b) => (sort.desc ? val(b) - val(a) : val(a) - val(b)));
  }, [rows, sort]);

  const th = (k: SortKey, label: string) => (
    <th className="sortable" onClick={() => setSort({ key: k, desc: sort.key === k ? !sort.desc : true })}>
      {label}
      {sort.key === k ? (sort.desc ? ' ↓' : ' ↑') : ''}
    </th>
  );

  const signalCounts = rows.reduce<Record<string, number>>((acc, r) => {
    if (r.signal) acc[r.signal] = (acc[r.signal] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>自选扫描</h1>
          <p>对自选股批量计算技术指标、诊断评分和策略的最新信号，并给出该策略在每只股票上的历史回测表现，快速找到“今天值得关注”的标的。</p>
        </div>
      </div>
      <div className="split">
        <aside className="split-side">
          <Collapsible title={`自选股（${watchlist.length}）`}>
            <div className="fields">
              <StockSearch placeholder="添加自选：代码或名称" onPick={(m) => addWatch(m)} />
              <div className="chips">
                {watchlist.map((w) => (
                  <span key={w.secid} className="chip">
                    {w.name}
                    <button
                      type="button"
                      aria-label={`移除 ${w.name}`}
                      className="x"
                      style={{ border: 0, background: 'none', cursor: 'pointer', padding: 0 }}
                      onClick={() => removeWatch(w.secid)}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <div className="btn-row">
                <button type="button" className="btn btn-sm" onClick={() => addWatch(DEMO_SPECS.map((d) => d.meta))}>
                  添加演示股票
                </button>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => addWatch(DEFAULT_WATCHLIST)}>
                  添加热门股票
                </button>
              </div>
            </div>
          </Collapsible>
          <Collapsible title="扫描设置">
            <div className="fields">
              <StrategySelect id="scr-strategy" value={key} onChange={setKey} />
              <div className="field">
                <span className="field-label">策略回测区间</span>
                <Seg
                  block
                  ariaLabel="回测区间"
                  value={years}
                  onChange={setYears}
                  options={[
                    { value: 1, label: '近1年' },
                    { value: 3, label: '近3年' },
                    { value: 5, label: '近5年' },
                  ]}
                />
              </div>
              {progress === null ? (
                <button type="button" className="btn btn-primary btn-block" disabled={!watchlist.length} onClick={() => void scan()}>
                  开始扫描
                </button>
              ) : (
                <div className="fields">
                  <Progress value={progress} />
                  <button type="button" className="btn btn-block" onClick={() => (cancelRef.current = true)}>
                    停止（{Math.round(progress * 100)}%）
                  </button>
                </div>
              )}
            </div>
          </Collapsible>
        </aside>
        <div className="stack">
          {rows.length > 0 && (
            <div className="chips">
              {(['buy', 'sell', 'hold', 'flat'] as Signal[]).map((s) => (
                <span key={s} className={`pill ${SIGNAL[s].cls}`}>
                  {SIGNAL[s].text} {signalCounts[s] ?? 0}
                </span>
              ))}
            </div>
          )}
          <Panel title="扫描结果" flush extra={<span className="xs muted">点击行查看行情 · 点击表头排序</span>}>
            {rows.length === 0 ? (
              <Empty>点击「开始扫描」分析自选股。没有网络时可以先「添加演示股票」。</Empty>
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>名称</th>
                      <th>最新价</th>
                      {th('chg', '涨跌幅')}
                      {th('ret20', '20日')}
                      {th('ret60', '60日')}
                      {th('ytd', '年初至今')}
                      {th('vol', '年化波动')}
                      {th('rsi', 'RSI')}
                      <th>均线趋势</th>
                      {th('score', '技术评分')}
                      {th('signal', '策略信号')}
                      {th('annual', '策略年化')}
                      {th('sharpe', '夏普')}
                      {th('mdd', '回撤')}
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((r) => (
                      <tr
                        key={r.meta.secid}
                        className="clickable"
                        onClick={() => {
                          void load(r.meta);
                          navigate('market');
                        }}
                      >
                        <td className="text">
                          <div>{r.meta.name}</div>
                          <div className="xs muted mono">{r.meta.code}</div>
                        </td>
                        {r.error ? (
                          <td colSpan={13} className="text left muted xs" style={{ whiteSpace: 'normal' }}>
                            加载失败：{r.error}
                          </td>
                        ) : r.last === undefined ? (
                          <td colSpan={13} className="text left muted xs">
                            等待中…
                          </td>
                        ) : (
                          <>
                            <td>{fmtPrice(r.last)}</td>
                            <td className={toneClass(r.chg)}>{fmtPct(r.chg)}</td>
                            <td className={toneClass(r.ret20)}>{fmtPct(r.ret20, 1)}</td>
                            <td className={toneClass(r.ret60)}>{fmtPct(r.ret60, 1)}</td>
                            <td className={toneClass(r.ytd)}>{fmtPct(r.ytd, 1)}</td>
                            <td>{fmtPct(r.vol, 0, false)}</td>
                            <td className={r.rsi! >= 70 ? 'up' : r.rsi! <= 30 ? 'down' : ''}>{fmtNum(r.rsi, 0)}</td>
                            <td>
                              <span className={`pill ${r.trend === 'up' ? 'bull' : r.trend === 'down' ? 'bear' : 'neutral'}`}>
                                {r.trend === 'up' ? '多头' : r.trend === 'down' ? '空头' : '震荡'}
                              </span>
                            </td>
                            <td>{r.score}</td>
                            <td>
                              <span className={`pill ${SIGNAL[r.signal!].cls}`}>{SIGNAL[r.signal!].text}</span>
                            </td>
                            <td className={toneClass(r.annual)}>
                              {fmtPct(r.annual, 1)}
                              <div className="xs muted">基准 {fmtPct(r.bench, 1)}</div>
                            </td>
                            <td>{fmtNum(r.sharpe)}</td>
                            <td className="down">{fmtPct(r.mdd, 1)}</td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
