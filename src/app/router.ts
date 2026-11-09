import { useEffect, useState } from 'react';

export const ROUTES = [
  { id: 'market', label: '行情分析' },
  { id: 'backtest', label: '策略回测' },
  { id: 'optimize', label: '参数优化' },
  { id: 'compare', label: '策略对比' },
  { id: 'rotation', label: '组合轮动' },
  { id: 'screener', label: '自选扫描' },
  { id: 'lab', label: '策略工坊' },
  { id: 'buffett', label: '巴菲特' },
  { id: 'library', label: '量化书房' },
  { id: 'guide', label: '使用说明' },
] as const;

export type RouteId = (typeof ROUTES)[number]['id'];

function current(): RouteId {
  const h = (typeof location !== 'undefined' ? location.hash : '').replace(/^#\/?/, '');
  return (ROUTES.find((r) => r.id === h)?.id ?? 'market') as RouteId;
}

export function navigate(id: RouteId) {
  if (location.hash !== `#${id}`) location.hash = id;
  window.scrollTo({ top: 0 });
}

export function useRoute(): RouteId {
  const [route, setRoute] = useState<RouteId>(current);
  useEffect(() => {
    const on = () => setRoute(current());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}
