export const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

export function fmtPct(x: number | undefined, digits = 2, sign = true): string {
  if (!isNum(x)) return x === Infinity ? '∞' : '—';
  const s = (x * 100).toFixed(digits);
  return `${sign && x > 0 ? '+' : ''}${s}%`;
}

export function fmtNum(x: number | undefined, digits = 2): string {
  if (!isNum(x)) return x === Infinity ? '∞' : '—';
  return x.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function fmtPrice(x: number | undefined): string {
  if (!isNum(x)) return '—';
  const d = Math.abs(x) < 10 ? 3 : 2;
  return x.toFixed(d);
}

/** 金额：自动换算为 万 / 亿 */
export function fmtMoney(x: number | undefined, digits = 2): string {
  if (!isNum(x)) return '—';
  const a = Math.abs(x);
  if (a >= 1e8) return `${(x / 1e8).toFixed(digits)} 亿`;
  if (a >= 1e4) return `${(x / 1e4).toFixed(digits)} 万`;
  return x.toFixed(digits);
}

export function toneClass(x: number | undefined): string {
  if (!isNum(x) || x === 0) return '';
  return x > 0 ? 'up' : 'down';
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

/** 安全的 localStorage */
export const safeStorage = {
  getItem(k: string): string | null {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  setItem(k: string, v: string) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* 忽略 */
    }
  },
  removeItem(k: string) {
    try {
      localStorage.removeItem(k);
    } catch {
      /* 忽略 */
    }
  },
};

export function shiftDate(date: string, years: number, months = 0): string {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCFullYear(d.getUTCFullYear() + years);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
