import { useEffect, useMemo, useRef, useState } from 'react';
import { heatmapOption, lineOption, scatterOption } from '../app/charts';
import { optimizeTask, type Task } from '../app/compute';
import { fmtNum, fmtPct, toneClass } from '../app/format';
import { navigate } from '../app/router';
import { strategyByKey, useApp } from '../app/store';
import { usePalette } from '../app/theme';
import { ConfigPanel, ParamsForm, RangePanel, StrategySelect } from '../components/BacktestParts';
import { EChart } from '../components/EChart';
import { StockToolbar } from '../components/StockPicker';
import { Collapsible, Empty, NumberField, Panel, Progress, SelectField, Tile } from '../components/ui';
import { axisValues, MAX_COMBOS, OBJECTIVES, type Axis, type MetricSummary, type Objective, type OptimizeResult, type OptimizeRow } from '../lib/optimize';
import { normalizeParams, type ParamDef } from '../lib/strategies/types';

function defaultAxis(pd: ParamDef): Axis {
  let lo = Math.max(pd.min, pd.default * 0.4);
  let hi = Math.min(pd.max, pd.default * 2.5);
  if (pd.default <= 0 || hi - lo < pd.step * 4) {
    lo = pd.min;
    hi = pd.max;
  }
  const step = Math.max(pd.step, Math.round((hi - lo) / 10 / pd.step) * pd.step);
  const from = Math.max(pd.min, Math.floor(lo / step) * step);
  const to = Math.min(pd.max, from + step * Math.ceil((hi - from) / step));
  const r = (x: number) => Number(x.toFixed(4));
  return { key: pd.key, from: r(from), to: r(to), step: r(step) };
}

const metricFmt = (o: Objective) => (o === 'sharpe' || o === 'sortino' || o === 'calmar' ? (v: number) => fmtNum(v) : (v: number) => fmtPct(v, 1));

function corr(xs: number[], ys: number[]) {
  const n = xs.length;
  if (n < 3) return NaN;
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  let a = 0;
  let b = 0;
  let c = 0;
  for (let i = 0; i < n; i++) {
    a += (xs[i] - mx) * (ys[i] - my);
    b += (xs[i] - mx) ** 2;
    c += (ys[i] - my) ** 2;
  }
  return b > 0 && c > 0 ? a / Math.sqrt(b * c) : NaN;
}

function MetricCol({ title, m, range }: { title: string; m?: MetricSummary; range?: [string, string] }) {
  if (!m) return null;
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="small">
        <b>{title}</b> {range && <span className="xs muted mono">{range[0]} ~ {range[1]}</span>}
      </div>
      <div className="tiles">
        <Tile label="年化收益" value={fmtPct(m.annualReturn)} tone={toneClass(m.annualReturn)} />
        <Tile label="夏普" value={fmtNum(m.sharpe)} />
        <Tile label="最大回撤" value={fmtPct(m.maxDrawdown)} tone="down" />
        <Tile label="交易次数" value={String(m.tradeCount)} sub={`胜率 ${fmtPct(m.winRate, 0, false)}`} />
      </div>
    </div>
  );
}

export default function OptimizePage() {
  const stock = useApp((s) => s.stock)!;
  const config = useApp((s) => s.config);
  const range = useApp((s) => s.range);
  const customs = useApp((s) => s.customStrategies);
  const globalKey = useApp((s) => s.strategyKey);
  const paramsByStrategy = useApp((s) => s.paramsByStrategy);
  const setStrategy = useApp((s) => s.setStrategy);
  const setParams = useApp((s) => s.setParams);
  const toast = useApp((s) => s.toast);
  const p = usePalette();

  const [key, setKey] = useState(globalKey === 'buy_hold' ? 'ma_cross' : globalKey);
  const { def, spec } = useMemo(() => strategyByKey(key, customs), [key, customs]);
  const numeric = def.params.filter((x) => !x.options);
  const [base, setBase] = useState(() => normalizeParams(def, paramsByStrategy[key]));
  const [axes, setAxes] = useState<Axis[]>([]);
  const [useY, setUseY] = useState(true);
  const [objective, setObjective] = useState<Objective>('sharpe');
  const [split, setSplit] = useState(0.7);
  const [minTrades, setMinTrades] = useState(3);
  const [progress, setProgress] = useState<number | null>(null);
  const [res, setRes] = useState<OptimizeResult | null>(null);
  const [resObjective, setResObjective] = useState<Objective>('sharpe');
  const task = useRef<Task<OptimizeResult> | null>(null);

  useEffect(() => {
    setBase(normalizeParams(def, paramsByStrategy[key]));
    const nums = def.params.filter((x) => !x.options);
    setAxes(nums.slice(0, 2).map(defaultAxis));
    setRes(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def]);

  useEffect(() => () => task.current?.cancel(), []);

  const activeAxes = axes.slice(0, useY ? 2 : 1).filter(Boolean);
  const combos = activeAxes.reduce((n, a) => n * axisValues(a).length, 1);

  const start = () => {
    if (!activeAxes.length) return;
    setProgress(0);
    setRes(null);
    const t = optimizeTask(
      {
        spec,
        bars: stock.bars,
        baseParams: base,
        axes: activeAxes,
        config,
        period: stock.period,
        range,
        splitRatio: split,
        objective,
        minTrades,
      },
      (d, total) => setProgress(d / total),
    );
    task.current = t;
    t.promise
      .then((r) => {
        setRes(r);
        setResObjective(objective);
      })
      .catch((e) => (e as Error).message !== '已取消' && toast((e as Error).message, 'error'))
      .finally(() => {
        setProgress(null);
        task.current = null;
      });
  };

  const apply = (row: OptimizeRow) => {
    setParams(key, row.params);
    setStrategy(key);
    navigate('backtest');
    toast('已应用参数，正在回测');
  };

  const fmt = metricFmt(resObjective);
  const best = res?.rows.find((r) => Number.isFinite(r.score));
  const labelOf = (k: string) => def.params.find((x) => x.key === k)?.label ?? k;

  const chart = useMemo(() => {
    if (!res || !res.rows.length) return null;
    const pick = (r: OptimizeRow) => (Number.isFinite(r.score) ? (resObjective === 'maxDrawdown' ? r.is.maxDrawdown : r.is[resObjective]) : null);
    if (res.axes.length === 2) {
      const [xa, ya] = res.axes;
      const [xv, yv] = res.axisValues;
      const map = new Map(res.rows.map((r) => [`${r.params[xa.key]}|${r.params[ya.key]}`, pick(r)]));
      const data: [number, number, number | null][] = [];
      xv.forEach((x, i) => yv.forEach((y, j) => data.push([i, j, map.has(`${x}|${y}`) ? (map.get(`${x}|${y}`) ?? null) : null])));
      const bestIdx: [number, number] | undefined = best ? [xv.indexOf(best.params[xa.key]), yv.indexOf(best.params[ya.key])] : undefined;
      return heatmapOption(
        { xVals: xv, yVals: yv, data, xLabel: labelOf(xa.key), yLabel: labelOf(ya.key), valueLabel: OBJECTIVES.find((o) => o.key === resObjective)!.label, fmt, best: bestIdx },
        p,
      );
    }
    const xa = res.axes[0];
    const xv = res.axisValues[0];
    const byX = new Map(res.rows.map((r) => [r.params[xa.key], r]));
    return lineOption(
      {
        x: xv,
        xLabel: labelOf(xa.key),
        fmt,
        markX: best?.params[xa.key],
        series: [
          { name: '样本内', data: xv.map((x) => (byX.has(x) ? pick(byX.get(x)!) : null)), color: p.accent },
          ...(res.oosRange
            ? [
                {
                  name: '样本外',
                  data: xv.map((x) => {
                    const r = byX.get(x);
                    if (!r?.oos) return null;
                    return resObjective === 'maxDrawdown' ? r.oos.maxDrawdown : r.oos[resObjective];
                  }),
                  color: p.blue,
                },
              ]
            : []),
        ],
      },
      p,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [res, p, resObjective]);

  const robust = useMemo(() => {
    if (!res?.oosRange) return null;
    const valid = res.rows.filter((r) => Number.isFinite(r.score) && r.oos);
    const xs = valid.map((r) => r.is.sharpe);
    const ys = valid.map((r) => r.oos!.sharpe);
    return { points: valid.map((r) => [r.is.sharpe, r.oos!.sharpe] as [number, number]), rho: corr(xs, ys) };
  }, [res]);

  const verdict = (() => {
    if (!best?.oos) return null;
    const is = best.is.sharpe;
    const oos = best.oos.sharpe;
    if (oos <= 0) return { cls: 'bear', text: '样本外失效：最优参数在验证期夏普为负，很可能是过度拟合。' };
    if (is > 0 && oos < is * 0.5) return { cls: 'neutral', text: '样本外明显衰减：验证期表现不到样本内的一半，参数稳定性一般。' };
    return { cls: 'bull', text: '样本外表现基本保持，参数相对稳健。仍建议在更多股票上验证。' };
  })();

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>参数优化</h1>
          <p>
            网格搜索 1~2 个参数的所有组合，在后台线程计算。开启样本外验证后，只用前一段数据挑选参数，再在后一段“没见过”的数据上检验，用来识别过度拟合。
          </p>
        </div>
      </div>
      <StockToolbar />
      <div className="split">
        <aside className="split-side">
          <Collapsible title="优化设置">
            <div className="fields">
              <StrategySelect id="opt-strategy" value={key} onChange={setKey} />
              {numeric.length === 0 ? (
                <p className="small muted">该策略没有可优化的数值参数。</p>
              ) : (
                <>
                  {[0, 1].map((ai) => {
                    if (ai === 1 && (numeric.length < 2 || !useY)) return null;
                    const ax = axes[ai];
                    if (!ax) return null;
                    return (
                      <div key={ai} className="fields" style={{ padding: 10, border: '1px solid var(--line)', borderRadius: 6 }}>
                        <SelectField
                          id={`opt-axis-${ai}`}
                          label={ai === 0 ? '参数 X' : '参数 Y'}
                          value={ax.key}
                          options={numeric.filter((n) => n.key === ax.key || !axes.some((a, j) => j !== ai && a?.key === n.key)).map((n) => ({ value: n.key, label: n.label }))}
                          onChange={(k) => setAxes(axes.map((a, j) => (j === ai ? defaultAxis(numeric.find((n) => n.key === k)!) : a)))}
                        />
                        <div className="fields-2" style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }}>
                          <NumberField id={`opt-from-${ai}`} label="从" value={ax.from} step={numeric.find((n) => n.key === ax.key)?.step} onChange={(v) => setAxes(axes.map((a, j) => (j === ai ? { ...a, from: v } : a)))} />
                          <NumberField id={`opt-to-${ai}`} label="到" value={ax.to} step={numeric.find((n) => n.key === ax.key)?.step} onChange={(v) => setAxes(axes.map((a, j) => (j === ai ? { ...a, to: v } : a)))} />
                          <NumberField id={`opt-step-${ai}`} label="步长" value={ax.step} min={0.0001} step={numeric.find((n) => n.key === ax.key)?.step} onChange={(v) => setAxes(axes.map((a, j) => (j === ai ? { ...a, step: v } : a)))} />
                        </div>
                      </div>
                    );
                  })}
                  {numeric.length >= 2 && (
                    <label className="check">
                      <input type="checkbox" checked={useY} onChange={(e) => setUseY(e.target.checked)} />
                      同时优化两个参数（热力图）
                    </label>
                  )}
                </>
              )}
              <SelectField id="opt-objective" label="优化目标" value={objective} options={OBJECTIVES.map((o) => ({ value: o.key, label: o.label }))} onChange={setObjective} />
              <NumberField
                id="opt-split"
                label="样本内比例"
                suffix="%"
                value={split}
                scale={100}
                min={0}
                max={95}
                step={5}
                slider
                hint={split > 0 ? `前 ${Math.round(split * 100)}% 用于寻优，后 ${Math.round((1 - split) * 100)}% 用于验证` : '0 表示不划分样本外'}
                onChange={setSplit}
              />
              <NumberField id="opt-mintrades" label="最少交易次数" value={minTrades} min={0} max={100} step={1} hint="交易太少的组合不参与排名" onChange={setMinTrades} />
              <div className="small dim">
                共 <b className={combos > MAX_COMBOS ? 'down' : ''}>{combos}</b> 个组合{combos > MAX_COMBOS ? `（上限 ${MAX_COMBOS}）` : ''}
              </div>
              {progress === null ? (
                <button type="button" className="btn btn-primary btn-block" disabled={!activeAxes.length || combos > MAX_COMBOS} onClick={start}>
                  开始优化
                </button>
              ) : (
                <div className="fields">
                  <Progress value={progress} />
                  <button type="button" className="btn btn-block" onClick={() => task.current?.cancel()}>
                    取消（{Math.round(progress * 100)}%）
                  </button>
                </div>
              )}
            </div>
          </Collapsible>
          {def.params.length > activeAxes.length && (
            <Collapsible title="其余参数（固定值）" defaultOpen={false}>
              <ParamsForm
                def={{ ...def, params: def.params.filter((x) => !activeAxes.some((a) => a.key === x.key)) }}
                params={base}
                onChange={setBase}
                idPrefix="opt-base"
              />
            </Collapsible>
          )}
          <RangePanel bars={stock.bars} />
          <ConfigPanel />
        </aside>

        <div className="stack">
          {!res && progress === null && (
            <Panel>
              <Empty>设置参数范围后点击「开始优化」。热力图中颜色越偏“涨”色代表目标值越好。</Empty>
            </Panel>
          )}
          {progress !== null && (
            <Panel>
              <div className="stack" style={{ alignItems: 'center', padding: 24 }}>
                <span className="small dim">正在回测 {combos} 个参数组合…</span>
                <div style={{ width: '100%', maxWidth: 360 }}>
                  <Progress value={progress} />
                </div>
              </div>
            </Panel>
          )}
          {res && best && (
            <>
              <Panel
                title="最优参数"
                extra={
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => apply(best)}>
                    应用到回测
                  </button>
                }
              >
                <div className="stack">
                  <div className="chips">
                    {Object.entries(best.params).map(([k, v]) => (
                      <span key={k} className="chip on">
                        {labelOf(k)} = <b className="mono">{v}</b>
                      </span>
                    ))}
                  </div>
                  <div className="grid-2">
                    <MetricCol title={res.oosRange ? '样本内（寻优）' : '全区间'} m={best.is} range={res.isRange} />
                    <MetricCol title="样本外（验证）" m={best.oos} range={res.oosRange} />
                  </div>
                  {verdict && <div className={`banner ${verdict.cls === 'bear' ? 'error' : verdict.cls === 'neutral' ? 'warn' : ''}`}>{verdict.text}</div>}
                  <p className="xs muted">
                    计算 {res.total - res.skipped} 个组合（跳过 {res.skipped} 个无效组合，如短均线 ≥ 长均线），耗时 {(res.elapsedMs / 1000).toFixed(1)} 秒。
                  </p>
                </div>
              </Panel>
              {chart && (
                <Panel title={res.axes.length === 2 ? '参数热力图（样本内）' : '参数敏感性'} extra={<span className="xs muted">平坦的高值区域比孤立的尖峰更可靠</span>}>
                  <EChart option={chart} height={res.axes.length === 2 ? Math.max(320, Math.min(560, res.axisValues[1].length * 30 + 110)) : 300} />
                </Panel>
              )}
              {robust && robust.points.length > 2 && (
                <Panel title="样本内 vs 样本外夏普" extra={<span className="xs muted">相关系数 ρ = {fmtNum(robust.rho)}</span>}>
                  <EChart option={scatterOption({ points: robust.points, xLabel: '样本内夏普', yLabel: '样本外夏普', fmt: (v) => v.toFixed(1) }, p)} height={280} />
                  <p className="xs muted">每个点是一组参数。点越接近一条向右上倾斜的直线（ρ 越大），说明样本内表现越能预测样本外。</p>
                </Panel>
              )}
              <Panel title="排名前 30" flush>
                <div className="table-wrap">
                  <table className="data">
                    <thead>
                      <tr>
                        <th>#</th>
                        {res.axes.map((a) => (
                          <th key={a.key}>{labelOf(a.key)}</th>
                        ))}
                        <th>年化</th>
                        <th>夏普</th>
                        <th>回撤</th>
                        <th>交易</th>
                        {res.oosRange && <th>样本外年化</th>}
                        {res.oosRange && <th>样本外夏普</th>}
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {res.rows.slice(0, 30).map((r, i) => (
                        <tr key={i} className={i === 0 ? 'best' : ''}>
                          <td>{i + 1}</td>
                          {res.axes.map((a) => (
                            <td key={a.key}>{r.params[a.key]}</td>
                          ))}
                          <td className={toneClass(r.is.annualReturn)}>{fmtPct(r.is.annualReturn, 1)}</td>
                          <td>{fmtNum(r.is.sharpe)}</td>
                          <td className="down">{fmtPct(r.is.maxDrawdown, 1)}</td>
                          <td>{r.is.tradeCount}</td>
                          {r.oos && <td className={toneClass(r.oos.annualReturn)}>{fmtPct(r.oos.annualReturn, 1)}</td>}
                          {r.oos && <td>{fmtNum(r.oos.sharpe)}</td>}
                          <td>
                            <button type="button" className="btn btn-sm" onClick={() => apply(r)}>
                              应用
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>
            </>
          )}
          {res && !best && (
            <Panel>
              <Empty>没有满足“最少交易次数”的参数组合，请放宽条件或扩大参数范围。</Empty>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
