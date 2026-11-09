import { useEffect, useMemo, useState } from 'react';
import { equityOption } from '../app/charts';
import { computeStrategy } from '../app/compute';
import { fmtNum, fmtPct, toneClass } from '../app/format';
import { navigate } from '../app/router';
import { strategyByKey, strategyOptions, useApp } from '../app/store';
import { usePalette } from '../app/theme';
import { ConfigPanel, RangePanel } from '../components/BacktestParts';
import { EChart } from '../components/EChart';
import { StockToolbar } from '../components/StockPicker';
import { Collapsible, Panel, Spinner } from '../components/ui';
import { runBacktest } from '../lib/backtest/engine';
import { rangeToIndex } from '../lib/backtest/run';
import type { BacktestResult, Metrics } from '../lib/backtest/types';
import { normalizeParams } from '../lib/strategies/types';

interface Row {
  key: string;
  name: string;
  result?: BacktestResult;
  error?: string;
}

type ColKey = keyof Pick<Metrics, 'totalReturn' | 'annualReturn' | 'maxDrawdown' | 'sharpe' | 'calmar' | 'winRate' | 'tradeCount' | 'exposure' | 'annualVolatility'>;

const COLS: { key: ColKey; label: string; fmt: (v: number) => string; higherBetter: boolean; tone?: boolean }[] = [
  { key: 'totalReturn', label: '总收益', fmt: (v) => fmtPct(v, 1), higherBetter: true, tone: true },
  { key: 'annualReturn', label: '年化', fmt: (v) => fmtPct(v, 1), higherBetter: true, tone: true },
  { key: 'maxDrawdown', label: '最大回撤', fmt: (v) => fmtPct(v, 1), higherBetter: true },
  { key: 'sharpe', label: '夏普', fmt: (v) => fmtNum(v), higherBetter: true },
  { key: 'calmar', label: '卡玛', fmt: (v) => fmtNum(v), higherBetter: true },
  { key: 'annualVolatility', label: '波动率', fmt: (v) => fmtPct(v, 1, false), higherBetter: false },
  { key: 'winRate', label: '胜率', fmt: (v) => fmtPct(v, 0, false), higherBetter: true },
  { key: 'tradeCount', label: '交易', fmt: (v) => String(v), higherBetter: false },
  { key: 'exposure', label: '持仓占比', fmt: (v) => fmtPct(v, 0, false), higherBetter: false },
];

export default function ComparePage() {
  const stock = useApp((s) => s.stock)!;
  const config = useApp((s) => s.config);
  const range = useApp((s) => s.range);
  const customs = useApp((s) => s.customStrategies);
  const paramsByStrategy = useApp((s) => s.paramsByStrategy);
  const setStrategy = useApp((s) => s.setStrategy);
  const p = usePalette();
  const [selected, setSelected] = useState<string[]>(['ma_cross', 'macd', 'turtle', 'supertrend', 'rsi', 'buy_hold']);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [sort, setSort] = useState<{ key: ColKey; desc: boolean }>({ key: 'sharpe', desc: true });

  const options = strategyOptions(customs);

  useEffect(() => {
    let alive = true;
    setBusy(true);
    const t = setTimeout(async () => {
      const out: Row[] = [];
      const { start, end } = rangeToIndex(stock.bars, range);
      for (const key of selected) {
        const { def, spec } = strategyByKey(key, customs);
        try {
          const params = normalizeParams(def, paramsByStrategy[key]);
          const o = await computeStrategy(spec, stock.bars, params);
          out.push({ key, name: def.name, result: runBacktest(stock.bars, o.position, config, { start, end, period: stock.period }) });
        } catch (e) {
          out.push({ key, name: def.name, error: (e as Error).message });
        }
      }
      if (alive) {
        setRows(out);
        setBusy(false);
      }
    }, 100);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [selected, stock, config, range, customs, paramsByStrategy]);

  const ok = useMemo(() => rows.filter((r) => r.result), [rows]);
  const chart = useMemo(() => {
    if (!ok.length) return null;
    const dates = ok[0].result!.dates;
    return equityOption(
      {
        dates,
        series: [
          ...ok.map((r, i) => ({ name: r.name, data: r.result!.equity, color: p.series[i % p.series.length], width: r.key === 'buy_hold' ? 1.2 : 1.8, dashed: r.key === 'buy_hold' })),
        ],
      },
      p,
    );
  }, [ok, p]);

  const ddChart = useMemo(() => {
    if (!ok.length) return null;
    return equityOption(
      {
        dates: ok[0].result!.dates,
        normalize: false,
        series: ok.map((r, i) => ({ name: r.name, data: r.result!.drawdown.map((x) => x * 100), color: p.series[i % p.series.length], width: 1.2 })),
      },
      p,
    );
  }, [ok, p]);

  const sorted = [...ok].sort((a, b) => {
    const x = a.result!.metrics[sort.key];
    const y = b.result!.metrics[sort.key];
    return sort.desc ? y - x : x - y;
  });

  const bestOf = (c: (typeof COLS)[number]) => {
    const vals = ok.map((r) => r.result!.metrics[c.key]);
    return c.higherBetter ? Math.max(...vals) : Math.min(...vals);
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>策略对比</h1>
          <p>在同一只股票、同一区间、同一交易规则下并排比较多个策略。各策略使用你在「策略回测」里最后一次调整的参数。</p>
        </div>
      </div>
      <StockToolbar />
      <div className="split">
        <aside className="split-side">
          <Collapsible title={`选择策略（${selected.length}）`}>
            <div className="chips">
              {options.map((o) => {
                const on = selected.includes(o.key);
                return (
                  <button
                    key={o.key}
                    type="button"
                    className={`chip ${on ? 'on' : ''}`}
                    onClick={() => setSelected(on ? selected.filter((k) => k !== o.key) : [...selected, o.key])}
                  >
                    {o.def.name}
                  </button>
                );
              })}
            </div>
          </Collapsible>
          <RangePanel bars={stock.bars} />
          <ConfigPanel />
        </aside>
        <div className="stack">
          {rows
            .filter((r) => r.error)
            .map((r) => (
              <div key={r.key} className="banner error">
                {r.name} 运行失败：{r.error}
              </div>
            ))}
          <Panel title={<>净值对比 {busy && <Spinner />}</>}>
            {chart ? <EChart option={chart} height={380} /> : <div className="empty">请至少选择一个策略。</div>}
          </Panel>
          {ok.length > 0 && (
            <Panel title="绩效排行" flush extra={<span className="xs muted">点击表头排序 · 金色为该列最优</span>}>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>策略</th>
                      {COLS.map((c) => (
                        <th
                          key={c.key}
                          className="sortable"
                          onClick={() => setSort({ key: c.key, desc: sort.key === c.key ? !sort.desc : c.higherBetter })}
                        >
                          {c.label}
                          {sort.key === c.key ? (sort.desc ? ' ↓' : ' ↑') : ''}
                        </th>
                      ))}
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((r) => {
                      const m = r.result!.metrics;
                      return (
                        <tr key={r.key}>
                          <td className="text">{r.name}</td>
                          {COLS.map((c) => (
                            <td key={c.key} className={`${m[c.key] === bestOf(c) && ok.length > 1 ? 'best' : c.tone ? toneClass(m[c.key]) : ''}`}>
                              {c.fmt(m[c.key])}
                            </td>
                          ))}
                          <td>
                            <button
                              type="button"
                              className="btn btn-sm"
                              onClick={() => {
                                setStrategy(r.key);
                                navigate('backtest');
                              }}
                            >
                              详情
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}
          {ddChart && (
            <Panel title="回撤对比" extra={<span className="xs muted">单位 %</span>}>
              <EChart option={ddChart} height={260} />
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
