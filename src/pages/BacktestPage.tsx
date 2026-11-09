import { useEffect, useMemo, useState } from 'react';
import { equityOption, klineOption, REASON } from '../app/charts';
import { computeStrategy } from '../app/compute';
import { copyText, fmtMoney, fmtNum, fmtPct, fmtPrice } from '../app/format';
import { navigate } from '../app/router';
import { useApp } from '../app/store';
import { usePalette } from '../app/theme';
import {
  ConfigPanel,
  MetricsTable,
  MonteCarloView,
  MonthlyTable,
  RangePanel,
  StrategyPanel,
  SummaryTiles,
  TradesTable,
  useCurrentStrategy,
} from '../components/BacktestParts';
import { EChart } from '../components/EChart';
import { StockToolbar } from '../components/StockPicker';
import { Panel, Spinner, Tabs } from '../components/ui';
import { runBacktest } from '../lib/backtest/engine';
import { rangeToIndex } from '../lib/backtest/run';
import type { BacktestResult } from '../lib/backtest/types';
import { downloadText, toCsv } from '../lib/data';
import type { StrategyOutput } from '../lib/strategies/types';

type TabId = 'metrics' | 'trades' | 'monthly' | 'mc' | 'export';

function LatestSignal({ output, result }: { output: StrategyOutput; result: BacktestResult }) {
  const pos = output.position;
  const n = pos.length;
  const cur = pos[n - 1] ?? 0;
  const prev = pos[n - 2] ?? 0;
  const lastDate = result.dates[result.dates.length - 1];
  const holding = result.exposure[result.exposure.length - 1] > 0.001;
  let pill: { cls: string; text: string };
  let text: string;
  if (cur > prev) {
    pill = { cls: 'bull', text: cur >= 0.999 ? '买入信号' : '加仓信号' };
    text = `${lastDate} 收盘出现${pill.text}，按当前设置将在下一交易日${result.config.execution === 'nextOpen' ? '开盘' : '收盘'}调整到 ${fmtPct(cur, 0, false)} 仓位。`;
  } else if (cur < prev) {
    pill = { cls: 'bear', text: cur <= 0.001 ? '卖出信号' : '减仓信号' };
    text = `${lastDate} 收盘出现${pill.text}，目标仓位降至 ${fmtPct(cur, 0, false)}。`;
  } else if (cur > 0) {
    pill = { cls: 'gold', text: '持有' };
    text = `策略当前处于持仓状态（目标仓位 ${fmtPct(cur, 0, false)}），暂无新的交易信号。`;
  } else {
    pill = { cls: 'neutral', text: '空仓观望' };
    text = '策略当前没有持仓，等待入场信号。';
  }
  return (
    <div className="signal-card">
      <span className="small muted">最新信号</span>
      <span className={`pill ${pill.cls}`}>{pill.text}</span>
      <span className="grow">{text}</span>
      {holding && <span className="xs muted">回测账户末日持仓 {fmtPct(result.exposure[result.exposure.length - 1], 0, false)}</span>}
    </div>
  );
}

export default function BacktestPage() {
  const stock = useApp((s) => s.stock)!;
  const config = useApp((s) => s.config);
  const range = useApp((s) => s.range);
  const toast = useApp((s) => s.toast);
  const { def, spec, params } = useCurrentStrategy();
  const p = usePalette();
  const [run, setRun] = useState<{ output: StrategyOutput; result: BacktestResult } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<TabId>('metrics');

  const bars = stock.bars;

  useEffect(() => {
    let alive = true;
    setBusy(true);
    const t = setTimeout(async () => {
      try {
        const output = await computeStrategy(spec, bars, params);
        if (!alive) return;
        const { start, end } = rangeToIndex(bars, range);
        const result = runBacktest(bars, output.position, config, { start, end, period: stock.period });
        setRun({ output, result });
        setError(null);
      } catch (e) {
        if (alive) setError((e as Error).message);
      } finally {
        if (alive) setBusy(false);
      }
    }, 120);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [bars, spec, params, config, range, stock.period]);

  const equityOpt = useMemo(
    () =>
      run &&
      equityOption(
        {
          dates: run.result.dates,
          series: [
            { name: def.name, data: run.result.equity, color: p.accent },
            { name: '买入持有', data: run.result.benchmark, color: p.fg3 },
          ],
          drawdown: run.result.drawdown,
          exposure: run.result.exposure,
        },
        p,
      ),
    [run, def.name, p],
  );

  const klineOpt = useMemo(
    () =>
      run &&
      klineOption(
        {
          bars,
          overlays: run.output.overlays,
          subLevels: run.output.subLevels,
          fills: run.result.fills,
          visible: 250,
          rangeStart: run.result.startIndex,
          showVolume: false,
        },
        p,
      ),
    [run, bars, p],
  );

  const exportTrades = () => {
    if (!run) return;
    downloadText(
      `${stock.meta.code}_${def.name}_成交记录.csv`,
      toCsv([
        ['日期', '方向', '价格', '股数', '金额', '费用', '原因'],
        ...run.result.fills.map((f) => [f.date, f.side === 'buy' ? '买入' : '卖出', f.price, f.shares, f.value, f.fee, REASON[f.reason]]),
      ]),
    );
  };
  const exportEquity = () => {
    if (!run) return;
    downloadText(
      `${stock.meta.code}_${def.name}_净值.csv`,
      toCsv([
        ['日期', '策略资产', '基准资产', '回撤', '仓位'],
        ...run.result.dates.map((d, i) => [d, run.result.equity[i], run.result.benchmark[i], run.result.drawdown[i], run.result.exposure[i]]),
      ]),
    );
  };
  const summaryText = () => {
    if (!run) return '';
    const m = run.result.metrics;
    const ps = def.params.map((d) => `${d.label}=${params[d.key]}`).join('，');
    return [
      `【${stock.meta.name} ${stock.meta.code}】${def.name}${ps ? `（${ps}）` : ''}`,
      `区间：${run.result.dates[0]} ~ ${run.result.dates[run.result.dates.length - 1]}`,
      `总收益 ${fmtPct(m.totalReturn)}（基准 ${fmtPct(m.benchmarkReturn)}），年化 ${fmtPct(m.annualReturn)}`,
      `最大回撤 ${fmtPct(m.maxDrawdown)}，夏普 ${fmtNum(m.sharpe)}，胜率 ${fmtPct(m.winRate, 1, false)}，交易 ${m.tradeCount} 笔`,
      `—— Henry's Treasure 量化实验室`,
    ].join('\n');
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>策略回测</h1>
          <p>选择策略、调整参数，结果实时更新。默认按 A 股规则模拟：信号次日开盘成交、T+1、整手交易，并扣除佣金与印花税。</p>
        </div>
      </div>
      <StockToolbar showPeriod />
      <div className="split">
        <aside className="split-side">
          <StrategyPanel />
          <RangePanel bars={bars} />
          <ConfigPanel />
        </aside>
        <div className="stack">
          {error && (
            <div className="banner error">
              <span className="grow">策略运行出错：{error}</span>
              {spec.type === 'custom' && (
                <button type="button" className="btn btn-sm" onClick={() => navigate('lab')}>
                  去策略工坊修改
                </button>
              )}
            </div>
          )}
          {!run && !error && (
            <div className="loading-shell">
              <Spinner /> 正在回测…
            </div>
          )}
          {run && (
            <>
              <LatestSignal output={run.output} result={run.result} />
              <SummaryTiles m={run.result.metrics} />
              <Panel
                title={
                  <>
                    净值曲线 {busy && <Spinner />}
                  </>
                }
                extra={<span className="xs muted">上：策略 vs 买入持有 · 中：回撤 · 下：仓位</span>}
              >
                {equityOpt && <EChart option={equityOpt} height={420} />}
              </Panel>
              <Panel title="买卖点" extra={<span className="xs muted">▲ 买入 ▼ 卖出 · 灰色区域为预热期</span>}>
                {klineOpt && <EChart option={klineOpt} height={run.output.overlays.some((o) => o.pane === 'sub') ? 460 : 380} keepZoom />}
              </Panel>
              <section className="panel">
                <Tabs<TabId>
                  value={tab}
                  onChange={setTab}
                  tabs={[
                    { id: 'metrics', label: '绩效指标' },
                    { id: 'trades', label: `交易明细 (${run.result.trades.length})` },
                    { id: 'monthly', label: '月度收益' },
                    { id: 'mc', label: '蒙特卡洛' },
                    { id: 'export', label: '导出' },
                  ]}
                />
                <div style={{ paddingTop: 4 }}>
                  {tab === 'metrics' && <MetricsTable m={run.result.metrics} />}
                  {tab === 'trades' && <TradesTable trades={run.result.trades} />}
                  {tab === 'monthly' && <MonthlyTable result={run.result} />}
                  {tab === 'mc' && <MonteCarloView result={run.result} />}
                  {tab === 'export' && (
                    <div className="stack" style={{ padding: 14 }}>
                      <div className="btn-row">
                        <button type="button" className="btn" onClick={exportTrades}>
                          下载成交记录 CSV
                        </button>
                        <button type="button" className="btn" onClick={exportEquity}>
                          下载每日净值 CSV
                        </button>
                        <button
                          type="button"
                          className="btn btn-primary"
                          onClick={async () => toast((await copyText(summaryText())) ? '回测摘要已复制' : '复制失败，请手动选择下方文字', 'info')}
                        >
                          复制回测摘要
                        </button>
                      </div>
                      <pre className="textarea" style={{ whiteSpace: 'pre-wrap', userSelect: 'all' }}>
                        {summaryText()}
                      </pre>
                      <p className="xs muted">
                        期末资产 {fmtMoney(run.result.metrics.finalEquity)} · 最后收盘价 {fmtPrice(bars[bars.length - 1].close)}
                      </p>
                    </div>
                  )}
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
