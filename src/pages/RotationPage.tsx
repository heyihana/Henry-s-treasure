import { useEffect, useMemo, useState } from 'react';
import { equityOption, stackedAreaOption } from '../app/charts';
import { fmtNum, fmtPct, toneClass } from '../app/format';
import { useApp } from '../app/store';
import { usePalette } from '../app/theme';
import { EChart } from '../components/EChart';
import { StockSearch } from '../components/StockPicker';
import { Check, Collapsible, Empty, NumberField, Panel, Progress, Seg, Tile } from '../components/ui';
import { DEMO_SPECS, loadStock, ROTATION_PRESETS } from '../lib/data';
import { DEFAULT_ROTATION, runRotation, type RotationAsset, type RotationConfig, type RotationResult } from '../lib/portfolio';
import type { StockMeta } from '../lib/types';

type Preset = (typeof ROTATION_PRESETS)[number];

const DEMO_PRESET: Preset = {
  name: '演示组合（离线）',
  desc: '4 只演示资产，无需联网即可体验（随机生成，不代表真实动量效应）',
  assets: [0, 2, 4, 5].map((i) => DEMO_SPECS[i].meta),
};

export default function RotationPage() {
  const toast = useApp((s) => s.toast);
  const p = usePalette();
  const presets = [...ROTATION_PRESETS, DEMO_PRESET];
  const initial = (() => {
    const pending = useApp.getState().pendingRotation;
    return presets.find((x) => x.name === pending) ?? presets.find((x) => x.name === 'A 股大小盘轮动') ?? presets[0];
  })();
  const [activePreset, setActivePreset] = useState(initial.name);
  const [assets, setAssets] = useState<StockMeta[]>(initial.assets);
  const [cfg, setCfg] = useState<RotationConfig>({ ...DEFAULT_ROTATION, ...(initial.config ?? {}) });
  useEffect(() => {
    useApp.getState().setPendingRotation(null);
  }, []);
  const [progress, setProgress] = useState<number | null>(null);
  const [result, setResult] = useState<RotationResult | null>(null);
  const [failed, setFailed] = useState<string[]>([]);

  const applyPreset = (pr: Preset) => {
    setAssets(pr.assets);
    setCfg({ ...DEFAULT_ROTATION, start: cfg.start, end: cfg.end, ...(pr.config ?? {}) });
    setResult(null);
    setActivePreset(pr.name);
  };
  const set = (patch: Partial<RotationConfig>) => setCfg({ ...cfg, ...patch });

  const run = async (list = assets) => {
    if (list.length < 2) {
      toast('至少选择 2 个标的', 'error');
      return;
    }
    setProgress(0);
    setFailed([]);
    let done = 0;
    const settled = await Promise.allSettled(
      list.map(async (m) => {
        const d = await loadStock(m, { period: 'day', adjust: 'hfq' });
        done++;
        setProgress(done / list.length);
        return { meta: { ...m, name: d.meta.name || m.name }, bars: d.bars } as RotationAsset;
      }),
    );
    const ok = settled.filter((s): s is PromiseFulfilledResult<RotationAsset> => s.status === 'fulfilled').map((s) => s.value);
    const bad = settled.map((s, i) => (s.status === 'rejected' ? list[i].name : null)).filter((x): x is string => !!x);
    setFailed(bad);
    try {
      if (ok.length < 2) throw new Error('可用标的不足 2 个。若无法联网，请使用「演示组合」。');
      setResult(runRotation(ok, cfg));
    } catch (e) {
      setResult(null);
      toast((e as Error).message, 'error');
    } finally {
      setProgress(null);
    }
  };

  const eqOpt = useMemo(
    () =>
      result &&
      equityOption(
        {
          dates: result.dates,
          series: [
            { name: '动量轮动', data: result.equity, color: p.accent },
            { name: '等权持有', data: result.benchmark, color: p.fg3 },
          ],
          drawdown: result.drawdown,
        },
        p,
      ),
    [result, p],
  );
  const wOpt = useMemo(
    () =>
      result &&
      stackedAreaOption(
        { dates: result.dates, series: result.assets.map((a) => ({ name: a.name, data: result.weights[a.code] })) },
        p,
      ),
    [result, p],
  );

  const m = result?.metrics;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>组合轮动</h1>
          <p>
            在一篮子 ETF 或股票之间按动量轮换：每隔固定周期，买入过去一段时间涨得最好的前 N 个；开启“绝对动量”后，如果全部下跌就空仓避险。这是
            A 股最流行的 ETF 轮动策略的通用版本。
          </p>
        </div>
      </div>
      <div className="split">
        <aside className="split-side">
          <Collapsible title="标的池">
            <div className="fields">
              <div className="chips">
                {presets.map((pr) => (
                  <button
                    key={pr.name}
                    type="button"
                    className={`chip ${activePreset === pr.name ? 'on' : ''}`}
                    title={pr.desc}
                    onClick={() => applyPreset(pr)}
                  >
                    {pr.name}
                  </button>
                ))}
              </div>
              <p className="field-hint">{presets.find((x) => x.name === activePreset)?.desc}</p>
              <StockSearch placeholder="添加标的：代码或名称" onPick={(mm) => !assets.some((a) => a.secid === mm.secid) && setAssets([...assets, mm])} />
              <div className="chips">
                {assets.map((a) => (
                  <span key={a.secid} className="chip on">
                    {a.name}
                    <button
                      type="button"
                      aria-label={`移除 ${a.name}`}
                      className="x"
                      style={{ border: 0, background: 'none', cursor: 'pointer', padding: 0 }}
                      onClick={() => setAssets(assets.filter((x) => x.secid !== a.secid))}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <p className="field-hint">轮动使用后复权价格计算收益，只取所有标的共同的交易日。</p>
            </div>
          </Collapsible>
          <Collapsible title="轮动规则">
            <div className="fields">
              <div className="fields-2">
                <NumberField id="rot-lookback" label="动量周期" suffix="交易日" value={cfg.lookback} min={5} max={250} step={1} onChange={(v) => set({ lookback: Math.round(v) })} />
                <NumberField id="rot-every" label="调仓间隔" suffix="交易日" value={cfg.rebalanceEvery} min={1} max={120} step={1} onChange={(v) => set({ rebalanceEvery: Math.round(v) })} />
                <NumberField id="rot-top" label="持有前 N 名" value={cfg.topN} min={1} max={Math.max(1, assets.length)} step={1} onChange={(v) => set({ topN: Math.round(v) })} />
                <NumberField id="rot-fee" label="单边费率" suffix="万分之" value={cfg.feeRate} scale={10000} min={0} max={50} step={0.5} onChange={(v) => set({ feeRate: v })} />
              </div>
              <div className="field">
                <span className="field-label">权重</span>
                <Seg
                  block
                  ariaLabel="权重方式"
                  value={cfg.weighting}
                  onChange={(v) => set({ weighting: v })}
                  options={[
                    { value: 'equal', label: '等权' },
                    { value: 'invVol', label: '波动率倒数' },
                  ]}
                />
              </div>
              <div className="field">
                <span className="field-label">排名方式</span>
                <Seg
                  block
                  ariaLabel="排名方式"
                  value={cfg.scoring}
                  onChange={(v) => set({ scoring: v })}
                  options={[
                    { value: 'roc', label: '区间涨幅' },
                    { value: 'clenow', label: 'Clenow 回归动量' },
                  ]}
                />
              </div>
              <Check label="绝对动量：动量为负时不持有" checked={cfg.absoluteMomentum} onChange={(v) => set({ absoluteMomentum: v })} />
              <div className="field">
                <label htmlFor="rot-safe">避险资产（双动量）</label>
                <select id="rot-safe" className="select" value={cfg.safeAsset ?? ''} onChange={(e) => set({ safeAsset: e.target.value || undefined })}>
                  <option value="">无，空出的仓位持有现金</option>
                  {assets.map((a) => (
                    <option key={a.secid} value={a.code}>
                      {a.name}
                    </option>
                  ))}
                </select>
                <span className="field-hint">选中的资产不参与排名，动量不达标时资金转入它（Antonacci《Dual Momentum》）。</span>
              </div>
              <div className="fields-2">
                <div className="field">
                  <label htmlFor="rot-start">开始日期</label>
                  <input id="rot-start" className="input num" type="date" value={cfg.start ?? ''} onChange={(e) => set({ start: e.target.value || undefined })} />
                </div>
                <div className="field">
                  <label htmlFor="rot-end">结束日期</label>
                  <input id="rot-end" className="input num" type="date" value={cfg.end ?? ''} onChange={(e) => set({ end: e.target.value || undefined })} />
                </div>
              </div>
              {progress === null ? (
                <button type="button" className="btn btn-primary btn-block" onClick={() => void run()}>
                  运行轮动回测
                </button>
              ) : (
                <div className="fields">
                  <span className="small dim">正在加载行情 {Math.round(progress * 100)}%</span>
                  <Progress value={progress} />
                </div>
              )}
            </div>
          </Collapsible>
        </aside>
        <div className="stack">
          {failed.length > 0 && <div className="banner warn">以下标的加载失败，已跳过：{failed.join('、')}</div>}
          {!result && (
            <Panel>
              <Empty>
                选择标的池并点击「运行轮动回测」。没有网络时可以选择「演示组合（离线）」。
                <div style={{ marginTop: 12 }}>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      applyPreset(DEMO_PRESET);
                      void run(DEMO_PRESET.assets);
                    }}
                  >
                    用演示组合试一试
                  </button>
                </div>
              </Empty>
            </Panel>
          )}
          {result && m && (
            <>
              <div className="tiles">
                <Tile label="总收益" value={fmtPct(m.totalReturn)} tone={toneClass(m.totalReturn)} sub={`等权 ${fmtPct(m.benchmarkReturn)}`} />
                <Tile label="年化收益" value={fmtPct(m.annualReturn)} tone={toneClass(m.annualReturn)} sub={`等权 ${fmtPct(m.benchmarkAnnualReturn)}`} />
                <Tile label="最大回撤" value={fmtPct(m.maxDrawdown)} tone="down" sub={`等权 ${fmtPct(m.benchmarkMaxDrawdown)}`} />
                <Tile label="夏普比率" value={fmtNum(m.sharpe)} sub={`等权 ${fmtNum(m.benchmarkSharpe)}`} />
                <Tile label="卡玛比率" value={fmtNum(m.calmar)} />
                <Tile label="调仓次数" value={String(m.tradeCount)} sub={`持仓占比 ${fmtPct(m.exposure, 0, false)}`} />
              </div>
              <Panel title="净值与回撤">{eqOpt && <EChart option={eqOpt} height={380} />}</Panel>
              <Panel title="持仓权重变化">{wOpt && <EChart option={wOpt} height={260} />}</Panel>
              <div className="grid-2">
                <Panel title="各标的区间涨幅" flush>
                  <div className="table-wrap">
                    <table className="data">
                      <thead>
                        <tr>
                          <th>标的</th>
                          <th>代码</th>
                          <th>区间涨幅</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...result.assetReturns]
                          .sort((a, b) => b.ret - a.ret)
                          .map((a) => (
                            <tr key={a.code}>
                              <td className="text">{a.name}</td>
                              <td className="dim">{a.code}</td>
                              <td className={toneClass(a.ret)}>{fmtPct(a.ret, 1)}</td>
                            </tr>
                          ))}
                        <tr>
                          <td className="text">
                            <b>动量轮动</b>
                          </td>
                          <td />
                          <td className={toneClass(m.totalReturn)}>
                            <b>{fmtPct(m.totalReturn, 1)}</b>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </Panel>
                <Panel title="调仓记录（最近 30 次）" flush>
                  <div className="table-wrap" style={{ maxHeight: 360 }}>
                    <table className="data">
                      <thead>
                        <tr>
                          <th>日期</th>
                          <th className="left">持有</th>
                          <th className="left">动量排名</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...result.rebalances]
                          .reverse()
                          .slice(0, 30)
                          .map((r) => {
                            const held = Object.entries(r.weights).filter(([, w]) => w > 0);
                            return (
                              <tr key={r.date}>
                                <td>{r.date}</td>
                                <td className="text left">
                                  {held.length ? (
                                    held.map(([code, w]) => (
                                      <span key={code} className="pill gold" style={{ marginRight: 4 }}>
                                        {result.assets.find((a) => a.code === code)?.name} {fmtPct(w, 0, false)}
                                      </span>
                                    ))
                                  ) : (
                                    <span className="pill neutral">空仓</span>
                                  )}
                                </td>
                                <td className="left xs">
                                  {r.scores.map((s) => (
                                    <span key={s.code} className={toneClass(s.score)} style={{ marginRight: 8 }}>
                                      {s.name} {fmtPct(s.score, 1)}
                                    </span>
                                  ))}
                                </td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>
                </Panel>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
