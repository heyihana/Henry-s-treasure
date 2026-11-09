import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/sora/latin-600.css';
import '@fontsource/sora/latin-700.css';
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import './styles.css';
import { App } from './App';
import { useApp } from './app/store';
import { applyThemeAttrs } from './app/theme';

// 主题属性在状态变化时同步写入，保证图表读取颜色时已生效
applyThemeAttrs(useApp.getState().theme, useApp.getState().redUp);
useApp.subscribe((s, prev) => {
  if (s.theme !== prev.theme || s.redUp !== prev.redUp) applyThemeAttrs(s.theme, s.redUp);
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
