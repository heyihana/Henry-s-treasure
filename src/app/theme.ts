import { useMemo, useSyncExternalStore } from 'react';
import { useApp } from './store';

export interface Palette {
  bg: string;
  panel: string;
  panel2: string;
  line: string;
  lineStrong: string;
  fg: string;
  fg2: string;
  fg3: string;
  accent: string;
  up: string;
  down: string;
  red: string;
  green: string;
  blue: string;
  violet: string;
  mono: string;
  body: string;
  series: string[];
}

/** 把主题 / 涨跌色设置同步到 <html> 属性上 */
let themeSetByApp = false;

export function applyThemeAttrs(theme: string, redUp: boolean) {
  const root = document.documentElement;
  if (theme === 'system') {
    // 只移除自己设置过的属性，保留宿主页面（如嵌入环境）设置的主题
    if (themeSetByApp) root.removeAttribute('data-theme');
    themeSetByApp = false;
  } else {
    root.setAttribute('data-theme', theme);
    themeSetByApp = true;
  }
  if (redUp) root.removeAttribute('data-updown');
  else root.setAttribute('data-updown', 'green');
}

let schemeVersion = 0;
const listeners = new Set<() => void>();
if (typeof window !== 'undefined' && window.matchMedia) {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const on = () => {
    schemeVersion++;
    listeners.forEach((l) => l());
  };
  mq.addEventListener?.('change', on);
  // 宿主环境可能直接修改 data-theme
  new MutationObserver(on).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-updown'] });
}

function useSchemeVersion() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => schemeVersion,
  );
}

export function readPalette(): Palette {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fb: string) => cs.getPropertyValue(name).trim() || fb;
  const accent = v('--accent', '#e3b350');
  const blue = v('--blue', '#5b97ee');
  const violet = v('--violet', '#b07ee0');
  return {
    bg: v('--bg', '#0c111d'),
    panel: v('--panel', '#131a2a'),
    panel2: v('--panel-2', '#1a2236'),
    line: v('--line', '#253049'),
    lineStrong: v('--line-strong', '#34405c'),
    fg: v('--fg', '#e7eaf1'),
    fg2: v('--fg-2', '#a6afc3'),
    fg3: v('--fg-3', '#707b94'),
    accent,
    up: resolveVar(cs, '--up', v('--red', '#f0574f')),
    down: resolveVar(cs, '--down', v('--green', '#2fb57f')),
    red: v('--red', '#f0574f'),
    green: v('--green', '#2fb57f'),
    blue,
    violet,
    mono: "'JetBrains Mono', Menlo, monospace",
    body: "'IBM Plex Sans', 'PingFang SC', 'Microsoft YaHei', sans-serif",
    series: [accent, blue, violet, '#3fb7a5', '#e07a5f', '#8fa3c0', '#c46fa0', '#7dbb4f', '#d9a23b', '#5fb0d6'],
  };
}

function resolveVar(cs: CSSStyleDeclaration, name: string, fallback: string): string {
  const raw = cs.getPropertyValue(name).trim();
  const m = raw.match(/^var\((--[\w-]+)\)$/);
  if (m) return cs.getPropertyValue(m[1]).trim() || fallback;
  return raw || fallback;
}

export function usePalette(): Palette {
  const theme = useApp((s) => s.theme);
  const redUp = useApp((s) => s.redUp);
  const ver = useSchemeVersion();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => readPalette(), [theme, redUp, ver]);
}
