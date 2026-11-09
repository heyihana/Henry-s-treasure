import { useMemo, useState } from 'react';
import { klineOption } from '../app/charts';
import { fmtMoney, fmtPct, fmtPrice, toneClass } from '../app/format';
import { navigate } from '../app/router';
import { useApp } from '../app/store';
import { usePalette } from '../app/theme';
import { EChart } from '../components/EChart';
import { StockToolbar } from '../components/StockPicker';
import { Panel, Seg } from '../components/ui';
import { diagnose, stockStats } from '../lib/analysis';
import * as ta from '../lib/indicators';
import type { Overlay } from '../lib/strategies/types';
import { periodsPerYear } from '../lib/types';

const SOURCE_LABEL: Record<string, string> = { eastmoney: '东方财富', tencent: '腾讯财经', demo: '演示数据', csv: 'CSV 导入' };
const MARKET_LABEL: Record<string, string> = { A: 'A股', HK: '港股', US: '美股', DEMO: '演示', CSV: 'CSV' };

type MainKey = 'MA5' | 'MA10' | 'MA20' | 'MA60' | 'BOLL';
type SubKey = 'MACD' | 'RSI' | 'KDJ' | 'none';

const MA_COLORS: Record<string, string> = { MA5: '#e0a526', MA10: '#4f8fe8', MA20: '#b26ad6', MA60: '#3fb7a5' };

export function MarketPage() {
  const stock = useApp((s) => s.stock)!;
  const addWatch = useApp((s) => s.addWatch);
  const watchlist = useApp((s) => s.watchlist);
  const loading = useApp((s) => s.loading);
  const p = usePalette();
  const [main, setMain] = useState<Record<MainKey, boolean>>({ MA5: true, MA10: true, MA20: true, MA60: true, BOLL: false });
  const [sub, setSub] = useState<SubKey>('MACD');
  const [months, setMonths] = useState(6);

  const bars = stock.bars;
  const ppy = periodsPerYear(stock.period);
  const barsPerMonth = stock.period === 'day' ? 21 : stock.period === 'week' ? 4.35 : 1;

  const overlays = useMemo(() => {
    const c = ta.columns(bars);
    const out: Overlay[] = [];
    (['MA5', 'MA10', 'MA20', 'MA60'] as const).forEach((k) => {
      if (main[k]) out.push({ name: k, data: ta.sma(c.close, Number(k.slice(2))), pane: 'main', color: MA_COLORS[k] });
    });
    if (main.BOLL) {
      const b = ta.boll(c.close, 20, 2);
      out.push(
        { name: 'BOLL上', data: b.upper, pane: 'main', kind: 'dashed', color: '#7b8aa6' },
        { name: 'BOLL中', data: b.mid, pane: 'main', color: '#c0a062' },
        { name: 'BOLL下', data: b.lower, pane: 'main', kind: 'dashed', color: '#7b8aa6' },
      );
    }
    let levels: number[] = [];
    if (sub === 'MACD') {
      const m = ta.macd(c.close);
      out.push(
        { name: 'DIF', data: m.dif, pane: 'sub', color: '#e0a526' },
        { name: 'DEA', data: m.dea, pane: 'sub', color: '#4f8fe8' },
        { name: 'MACD', data: m.hist, pane: 'sub', kind: 'bar' },
      );
      levels = [0];
    } else if (sub === 'RSI') {
      out.push(
        { name: 'RSI6', data: ta.rsi(c.close, 6), pane: 'sub', color: '#e0a526' },
        { name: 'RSI14', data: ta.rsi(c.close, 14), pane: 'sub', color: '#4f8fe8' },
      );
      levels = [30, 70];
    } else if (sub === 'KDJ') {
      const k = ta.kdj(c.high, c.low, c.close);
      out.push(
        { name: 'K', data: k.k, pane: 'sub', color: '#e0a526' },
        { name: 'D', data: k.d, pane: 'sub', color: '#4f8fe8' },
        { name: 'J', data: k.j, pane: 'sub', color: '#b26ad6' },
      );
      levels = [20, 80];
    }
    return { out, levels };
  }, [bars, main, sub]);

  const option = useMemo(
    () =>
      klineOption(
        { bars, overlays: overlays.out, subLevels: overlays.levels, visible: months ? Math.round(months * barsPerMonth) : bars.length, legend: false },
        p,
      ),
    [bars, overlays, months, barsPerMonth, p],
  );

  const stats = useMemo(() => stockStats(bars, ppy), [bars, ppy]);
  const diag = useMemo(() => diagnose(bars), [bars]);
  const last = bars[bars.length - 1];
  const inWatch = watchlist.some((w) => w.secid === stock.meta.secid);

  return (
    <div className="page">
      <StockToolbar />

      <div className="quote">
        <div>
          <div className="quote-name">
            <h1>{stock.meta.name}</h1>
            <span className="mono dim">{stock.meta.code}</span>
            <span className="badge">{MARKET_LABEL[stock.meta.market]}</span>
            <span className={`badge ${stock.source === 'demo' ? 'gold' : ''}`}>{SOURCE_LABEL[stock.source]}</span>
            {loading && <span className="spinner" />}
          </div>
          <div className="xs muted mono" style={{ marginTop: 4 }}>
            {bars[0].date} ~ {last.date} · {bars.length} 根{stock.period === 'day' ? '日' : stock.period === 'week' ? '周' : '月'}K
            {stock.source !== 'demo' && stock.source !== 'csv' ? ` · ${stock.adjust === 'qfq' ? '前复权' : stock.adjust === 'hfq' ? '后复权' : '不复权'}` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <span className={`quote-price ${toneClass(stats.changePct)}`}>{fmtPrice(stats.last)}</span>
          <span className={`quote-change ${toneClass(stats.changePct)}`}>
            {stats.change >= 0 ? '+' : ''}
            {fmtPrice(stats.change)} {fmtPct(stats.changePct)}
          </span>
        </div>
        <div className="btn-row" style={{ marginLeft: 'auto' }}>
          <button type="button" className="btn" disabled={inWatch} onClick={() => addWatch(stock.meta)}>
            {inWatch ? '已在自选' : '加入自选'}
          </button>
          <button type="button" className="btn btn-primary" onClick={() => navigate('backtest')}>
            用这只股票回测
          </button>
        </div>
      </div>

      <div className="split-rev">
        <div className="stack">
          <Panel
            title="K 线走势"
            extra={
              <div className="toolbar">
                <Seg
                  ariaLabel="显示范围"
                  value={months}
                  onChange={setMonths}
                  options={[
                    { value: 3, label: '3月' },
                    { value: 6, label: '6月' },
                    { value: 12, label: '1年' },
                    { value: 36, label: '3年' },
                    { value: 0, label: '全部' },
                  ]}
                />
              </div>
            }
          >
            <div className="toolbar" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
              <div className="chips">
                {(Object.keys(main) as MainKey[]).map((k) => (
                  <button key={k} type="button" className={`chip ${main[k] ? 'on' : ''}`} onClick={() => setMain({ ...main, [k]: !main[k] })}>
                    {k !== 'BOLL' && <span className="swatch" style={{ background: MA_COLORS[k] }} />}
                    {k}
                  </button>
                ))}
              </div>
              <Seg
                ariaLabel="副图指标"
                value={sub}
                onChange={setSub}
                options={[
                  { value: 'MACD', label: 'MACD' },
                  { value: 'RSI', label: 'RSI' },
                  { value: 'KDJ', label: 'KDJ' },
                  { value: 'none', label: '无' },
                ]}
              />
            </div>
            <EChart option={option} height={sub === 'none' ? 440 : 520} />
          </Panel>

          <Panel title="区间表现">
            <div className="kv">
              {[
                ['近5日', stats.ret5],
                ['近20日', stats.ret20],
                ['近60日', stats.ret60],
                ['近一年', stats.ret250],
                ['年初至今', stats.ytd],
              ].map(([k, v]) => (
                <div key={k as string}>
                  <span className="k">{k}</span>
                  <span className={`v ${toneClass(v as number)}`}>{fmtPct(v as number)}</span>
                </div>
              ))}
              <div>
                <span className="k">20日年化波动</span>
                <span className="v">{fmtPct(stats.vol20, 1, false)}</span>
              </div>
              <div>
                <span className="k">一年年化波动</span>
                <span className="v">{fmtPct(stats.vol250, 1, false)}</span>
              </div>
              <div>
                <span className="k">一年最大回撤</span>
                <span className="v down">{fmtPct(stats.maxDrawdown1y)}</span>
              </div>
              <div>
                <span className="k">52周最高</span>
                <span className="v">{fmtPrice(stats.high52)}</span>
              </div>
              <div>
                <span className="k">52周最低</span>
                <span className="v">{fmtPrice(stats.low52)}</span>
              </div>
              <div>
                <span className="k">20日均成交额</span>
                <span className="v">{fmtMoney(stats.avgAmount20)}</span>
              </div>
            </div>
          </Panel>
        </div>

        <Panel title="技术面诊断" extra={<span className={`pill ${diag.score >= 58 ? 'bull' : diag.score <= 42 ? 'bear' : 'neutral'}`}>{diag.verdict}</span>}>
          <div className="stack" style={{ gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span className="mono" style={{ fontSize: '2rem', lineHeight: 1 }}>
                {diag.score}
              </span>
              <span className="muted small">/ 100 综合技术评分</span>
            </div>
            <div className="score-bar" aria-hidden="true">
              <i style={{ left: `${diag.score}%` }} />
            </div>
            <div className="xs muted" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>偏空</span>
              <span>中性</span>
              <span>偏多</span>
            </div>
            <div className="diag-list">
              {diag.items.map((it) => (
                <div className="diag-item" key={it.title}>
                  <span className="t">{it.title}</span>
                  <span className="small" style={{ fontWeight: 500 }}>
                    {it.value}
                  </span>
                  <span className={`pill ${it.tone}`}>{it.tone === 'bull' ? '偏多' : it.tone === 'bear' ? '偏空' : '中性'}</span>
                  <span className="d">{it.detail}</span>
                </div>
              ))}
            </div>
            <p className="xs muted">评分按各项信号的多空数量加权得出，只反映技术形态，不考虑基本面与消息面。</p>
          </div>
        </Panel>
      </div>
    </div>
  );
}
