import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { DEFAULT_CONFIG, MARKET_PRESETS, type BacktestConfig, type MarketPreset } from '../lib/backtest/types';
import { DEFAULT_WATCHLIST, DEMO_SPECS, loadStock, POPULAR } from '../lib/data';
import {
  BUILTIN_STRATEGIES,
  customToDef,
  type CustomStrategy,
  type Params,
  type StrategyDef,
  type StrategySpec,
} from '../lib/strategies';
import type { Adjust, Period, StockData, StockMeta } from '../lib/types';
import { safeStorage, uid } from './format';

export interface Toast {
  id: string;
  text: string;
  kind: 'info' | 'error';
}

export type ThemeMode = 'system' | 'light' | 'dark';

interface State {
  stock: StockData | null;
  loading: boolean;
  error: string | null;
  /** 数据源切换提示 */
  notice: string | null;
  toasts: Toast[];

  // 持久化
  period: Period;
  adjust: Adjust;
  lastMeta: StockMeta | null;
  recent: StockMeta[];
  watchlist: StockMeta[];
  customStrategies: CustomStrategy[];
  config: BacktestConfig;
  preset: MarketPreset;
  strategyKey: string;
  paramsByStrategy: Record<string, Params>;
  range: { start?: string; end?: string };
  theme: ThemeMode;
  redUp: boolean;

  load(meta: StockMeta, opts?: { force?: boolean; silentFallback?: boolean }): Promise<void>;
  setPeriod(p: Period): void;
  setAdjust(a: Adjust): void;
  setStockData(d: StockData): void;
  addWatch(m: StockMeta | StockMeta[]): void;
  removeWatch(secid: string): void;
  saveCustom(c: CustomStrategy): void;
  deleteCustom(id: string): void;
  setConfig(p: Partial<BacktestConfig>): void;
  setPreset(p: MarketPreset): void;
  setStrategy(key: string): void;
  setParams(key: string, p: Params): void;
  setRange(r: { start?: string; end?: string }): void;
  setTheme(t: ThemeMode): void;
  setRedUp(v: boolean): void;
  toast(text: string, kind?: Toast['kind']): void;
  dismissNotice(): void;
}

const presetFor = (m: StockMeta): Exclude<MarketPreset, 'custom'> => (m.market === 'HK' ? 'HK' : m.market === 'US' ? 'US' : 'A');

export const useApp = create<State>()(
  persist(
    (set, get) => ({
      stock: null,
      loading: false,
      error: null,
      notice: null,
      toasts: [],

      period: 'day',
      adjust: 'qfq',
      lastMeta: null,
      recent: [],
      watchlist: DEFAULT_WATCHLIST,
      customStrategies: [],
      config: DEFAULT_CONFIG,
      preset: 'A',
      strategyKey: 'ma_cross',
      paramsByStrategy: {},
      range: {},
      theme: 'system',
      redUp: true,

      async load(meta, opts = {}) {
        set({ loading: true, error: null });
        try {
          const data = await loadStock(meta, { period: get().period, adjust: get().adjust, force: opts.force });
          get().setStockData(data);
          set({ notice: null });
        } catch (e) {
          const msg = (e as Error).message;
          if (!get().stock || opts.silentFallback) {
            const demo = DEMO_SPECS[0].meta;
            const data = await loadStock(demo, { period: get().period });
            get().setStockData(data);
            const reason = msg.split('；')[0].replace(/^[^：]+：/, '');
            set({
              notice: `暂时无法获取「${meta.name || meta.code}」的实时行情（${reason}），已载入演示数据。你可以稍后刷新重试，或导入 CSV。`,
            });
          } else {
            set({ error: msg });
            get().toast(`加载失败：${msg}`, 'error');
          }
        } finally {
          set({ loading: false });
        }
      },

      setStockData(data) {
        const s = get();
        const recent = [data.meta, ...s.recent.filter((r) => r.secid !== data.meta.secid)].slice(0, 12);
        const patch: Partial<State> = { stock: data, recent, error: null };
        if (data.meta.market !== 'CSV') patch.lastMeta = data.meta;
        if (s.preset !== 'custom') {
          const p = presetFor(data.meta);
          patch.preset = p;
          patch.config = { ...s.config, ...MARKET_PRESETS[p] };
        }
        set(patch);
      },

      setPeriod(p) {
        set({ period: p });
        const st = get().stock;
        if (st) void get().load(st.meta);
      },
      setAdjust(a) {
        set({ adjust: a });
        const st = get().stock;
        if (st && st.meta.market !== 'DEMO' && st.meta.market !== 'CSV') void get().load(st.meta);
      },
      addWatch(m) {
        const list = Array.isArray(m) ? m : [m];
        const fresh = list.filter((x) => !get().watchlist.some((w) => w.secid === x.secid));
        if (!fresh.length) {
          get().toast('已经在自选中了');
          return;
        }
        set({ watchlist: [...get().watchlist, ...fresh] });
        get().toast(fresh.length === 1 ? `已加入自选：${fresh[0].name}` : `已加入 ${fresh.length} 只自选股`);
      },
      removeWatch(secid) {
        set({ watchlist: get().watchlist.filter((w) => w.secid !== secid) });
      },
      saveCustom(c) {
        const list = get().customStrategies;
        const i = list.findIndex((x) => x.id === c.id);
        set({ customStrategies: i >= 0 ? list.map((x) => (x.id === c.id ? c : x)) : [...list, c] });
      },
      deleteCustom(id) {
        const key = `custom:${id}`;
        set({
          customStrategies: get().customStrategies.filter((x) => x.id !== id),
          strategyKey: get().strategyKey === key ? 'ma_cross' : get().strategyKey,
        });
      },
      setConfig(p) {
        set({ config: { ...get().config, ...p } });
      },
      setPreset(p) {
        if (p === 'custom') set({ preset: p });
        else set({ preset: p, config: { ...get().config, ...MARKET_PRESETS[p] } });
      },
      setStrategy(key) {
        set({ strategyKey: key });
      },
      setParams(key, p) {
        set({ paramsByStrategy: { ...get().paramsByStrategy, [key]: p } });
      },
      setRange(r) {
        set({ range: r });
      },
      setTheme(t) {
        set({ theme: t });
      },
      setRedUp(v) {
        set({ redUp: v });
      },
      toast(text, kind = 'info') {
        const t = { id: uid(), text, kind };
        set({ toasts: [...get().toasts, t] });
        setTimeout(() => set({ toasts: get().toasts.filter((x) => x.id !== t.id) }), kind === 'error' ? 6000 : 3000);
      },
      dismissNotice() {
        set({ notice: null });
      },
    }),
    {
      name: 'hst-app-v1',
      storage: createJSONStorage(() => safeStorage),
      partialize: (s) => ({
        period: s.period,
        adjust: s.adjust,
        lastMeta: s.lastMeta,
        recent: s.recent,
        watchlist: s.watchlist,
        customStrategies: s.customStrategies,
        config: s.config,
        preset: s.preset,
        strategyKey: s.strategyKey,
        paramsByStrategy: s.paramsByStrategy,
        range: s.range,
        theme: s.theme,
        redUp: s.redUp,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<State>;
        return { ...current, ...p, config: { ...DEFAULT_CONFIG, ...(p.config ?? {}) } };
      },
    },
  ),
);

/** 策略选项：内置 + 自定义 */
export function strategyOptions(customs: CustomStrategy[]): { key: string; def: StrategyDef }[] {
  return [
    ...BUILTIN_STRATEGIES.map((d) => ({ key: d.id, def: d })),
    ...customs.map((c) => ({ key: `custom:${c.id}`, def: customToDef(c) })),
  ];
}

export function strategyByKey(key: string, customs: CustomStrategy[]): { def: StrategyDef; spec: StrategySpec } {
  if (key.startsWith('custom:')) {
    const c = customs.find((x) => `custom:${x.id}` === key);
    if (c) return { def: customToDef(c), spec: { type: 'custom', custom: c } };
  }
  const def = BUILTIN_STRATEGIES.find((d) => d.id === key) ?? BUILTIN_STRATEGIES[0];
  return { def, spec: { type: 'builtin', id: def.id } };
}

export const DEFAULT_STOCK: StockMeta = POPULAR[0];
