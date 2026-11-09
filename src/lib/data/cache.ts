import { createStore, del, get, keys, set } from 'idb-keyval';
import type { StockData } from '../types';

const memory = new Map<string, StockData>();
let store: ReturnType<typeof createStore> | null = null;
let idbBroken = false;

function getStore() {
  if (idbBroken) return null;
  try {
    if (!store) store = createStore('hst-market-data', 'klines');
    return store;
  } catch {
    idbBroken = true;
    return null;
  }
}

/** 行情缓存：内存 + IndexedDB，任何存储异常都静默降级 */
export async function readCache(key: string): Promise<StockData | undefined> {
  const m = memory.get(key);
  if (m) return m;
  const s = getStore();
  if (!s) return undefined;
  try {
    const v = await get<StockData>(key, s);
    if (v) memory.set(key, v);
    return v;
  } catch {
    idbBroken = true;
    return undefined;
  }
}

export async function writeCache(key: string, data: StockData): Promise<void> {
  memory.set(key, data);
  const s = getStore();
  if (!s) return;
  try {
    await set(key, data, s);
  } catch {
    idbBroken = true;
  }
}

export async function clearCache(): Promise<number> {
  const n = memory.size;
  memory.clear();
  const s = getStore();
  if (!s) return n;
  try {
    const ks = await keys(s);
    await Promise.all(ks.map((k) => del(k, s)));
    return Math.max(n, ks.length);
  } catch {
    return n;
  }
}
