import { lazy, Suspense, useEffect } from 'react';
import { fmtPct, fmtPrice, toneClass } from './app/format';
import { navigate, ROUTES, useRoute, type RouteId } from './app/router';
import { DEFAULT_STOCK, useApp, type ThemeMode } from './app/store';
import { Spinner, Toasts } from './components/ui';
import { MarketPage } from './pages/MarketPage';

const BacktestPage = lazy(() => import('./pages/BacktestPage'));
const OptimizePage = lazy(() => import('./pages/OptimizePage'));
const ComparePage = lazy(() => import('./pages/ComparePage'));
const RotationPage = lazy(() => import('./pages/RotationPage'));
const ScreenerPage = lazy(() => import('./pages/ScreenerPage'));
const LabPage = lazy(() => import('./pages/LabPage'));
const GuidePage = lazy(() => import('./pages/GuidePage'));

function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="var(--accent)" />
      <g fill="var(--accent-ink)">
        <rect x="7" y="15" width="4" height="9" rx="1" />
        <rect x="8.5" y="12" width="1" height="14" />
        <rect x="14" y="10" width="4" height="11" rx="1" />
        <rect x="15.5" y="7" width="1" height="17" />
        <rect x="21" y="6" width="4" height="10" rx="1" />
        <rect x="22.5" y="4" width="1" height="14" />
      </g>
    </svg>
  );
}

const THEME_NEXT: Record<ThemeMode, ThemeMode> = { system: 'light', light: 'dark', dark: 'system' };
const THEME_LABEL: Record<ThemeMode, string> = { system: '跟随系统', light: '浅色', dark: '深色' };

function ThemeIcon({ mode }: { mode: ThemeMode }) {
  if (mode === 'light')
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    );
  if (mode === 'dark')
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
      </svg>
    );
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" />
    </svg>
  );
}

function Header({ route }: { route: RouteId }) {
  const stock = useApp((s) => s.stock);
  const theme = useApp((s) => s.theme);
  const setTheme = useApp((s) => s.setTheme);
  const redUp = useApp((s) => s.redUp);
  const setRedUp = useApp((s) => s.setRedUp);
  const bars = stock?.bars ?? [];
  const last = bars[bars.length - 1];
  const prev = bars[bars.length - 2];
  const chg = last && prev ? last.close / prev.close - 1 : 0;
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <a className="brand" href="#market" onClick={(e) => (e.preventDefault(), navigate('market'))}>
          <BrandMark />
          <span>
            <span className="brand-name">Henry's Treasure</span>
            <br />
            <span className="brand-sub">量化策略实验室</span>
          </span>
        </a>
        {stock && last && (
          <div className="topbar-stock">
            <span className="name">{stock.meta.name}</span>
            <span className="code muted mono xs">{stock.meta.code}</span>
            <span className={`mono ${toneClass(chg)}`}>{fmtPrice(last.close)}</span>
            <span className={`mono xs ${toneClass(chg)}`}>{fmtPct(chg)}</span>
          </div>
        )}
        <div className="topbar-actions" style={stock ? undefined : { marginLeft: 'auto' }}>
          <button
            type="button"
            className="icon-btn"
            title={redUp ? '当前：红涨绿跌，点击切换为绿涨红跌' : '当前：绿涨红跌，点击切换为红涨绿跌'}
            aria-label="切换涨跌颜色"
            onClick={() => setRedUp(!redUp)}
          >
            <span style={{ color: 'var(--up)' }}>涨</span>
          </button>
          <button
            type="button"
            className="icon-btn"
            title={`主题：${THEME_LABEL[theme]}（点击切换）`}
            aria-label={`切换主题，当前${THEME_LABEL[theme]}`}
            onClick={() => setTheme(THEME_NEXT[theme])}
          >
            <ThemeIcon mode={theme} />
          </button>
        </div>
      </div>
      <nav className="nav" aria-label="主导航">
        {ROUTES.map((r) => (
          <a key={r.id} href={`#${r.id}`} className={r.id === route ? 'active' : ''} aria-current={r.id === route ? 'page' : undefined}>
            {r.label}
          </a>
        ))}
      </nav>
    </header>
  );
}

function Notice() {
  const notice = useApp((s) => s.notice);
  const dismiss = useApp((s) => s.dismissNotice);
  if (!notice) return null;
  return (
    <div className="page" style={{ paddingBottom: 0 }}>
      <div className="banner warn" role="status">
        <span className="grow">{notice}</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={dismiss}>
          知道了
        </button>
      </div>
    </div>
  );
}

function Page({ route }: { route: RouteId }) {
  switch (route) {
    case 'backtest':
      return <BacktestPage />;
    case 'optimize':
      return <OptimizePage />;
    case 'compare':
      return <ComparePage />;
    case 'rotation':
      return <RotationPage />;
    case 'screener':
      return <ScreenerPage />;
    case 'lab':
      return <LabPage />;
    case 'guide':
      return <GuidePage />;
    default:
      return <MarketPage />;
  }
}

export function App() {
  const route = useRoute();
  const stock = useApp((s) => s.stock);
  const load = useApp((s) => s.load);

  useEffect(() => {
    if (!useApp.getState().stock) {
      const meta = useApp.getState().lastMeta ?? DEFAULT_STOCK;
      void load(meta, { silentFallback: true });
    }
  }, [load]);

  return (
    <>
      <Header route={route} />
      <Notice />
      <main>
        {stock ? (
          <Suspense
            fallback={
              <div className="loading-shell">
                <Spinner /> 加载模块…
              </div>
            }
          >
            <Page route={route} />
          </Suspense>
        ) : route === 'guide' ? (
          <Suspense fallback={null}>
            <GuidePage />
          </Suspense>
        ) : (
          <div className="loading-shell">
            <Spinner /> 正在加载行情数据…
          </div>
        )}
      </main>
      <footer className="footer">
        本站所有分析与回测结果仅供学习研究，不构成任何投资建议。历史表现不代表未来收益，投资有风险，入市需谨慎。
      </footer>
      <Toasts />
    </>
  );
}
