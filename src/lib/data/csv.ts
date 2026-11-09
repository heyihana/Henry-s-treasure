import type { Bar } from '../types';

const HEADER_ALIASES: Record<keyof Pick<Bar, 'date' | 'open' | 'high' | 'low' | 'close' | 'volume' | 'amount'>, string[]> = {
  date: ['date', 'datetime', 'time', 'trade_date', 'day', '日期', '交易日期', '时间'],
  open: ['open', '开盘', '开盘价', '今开'],
  high: ['high', '最高', '最高价'],
  low: ['low', '最低', '最低价'],
  close: ['close', 'adj close', 'adj_close', '收盘', '收盘价', '最新价'],
  volume: ['volume', 'vol', '成交量', '成交量(股)', '成交量(手)'],
  amount: ['amount', 'turnover', '成交额', '成交金额'],
};

function splitLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (q && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else q = !q;
    } else if (ch === sep && !q) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

export function normalizeDate(raw: string): string | null {
  const s = raw.trim().replace(/\//g, '-');
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const t = Date.parse(s);
  if (Number.isFinite(t)) return new Date(t).toISOString().slice(0, 10);
  return null;
}

/**
 * 解析 CSV 行情。支持中英文表头（日期/开盘/最高/最低/收盘/成交量），逗号、制表符、分号分隔，
 * 自动按日期升序排列并去重。
 */
export function parseCsv(text: string): Bar[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) throw new Error('CSV 内容为空');
  const sep = lines[0].includes('\t') ? '\t' : lines[0].includes(';') && !lines[0].includes(',') ? ';' : ',';
  const header = splitLine(lines[0], sep).map((h) => h.toLowerCase().replace(/^"|"$/g, ''));
  const col: Partial<Record<keyof typeof HEADER_ALIASES, number>> = {};
  (Object.keys(HEADER_ALIASES) as (keyof typeof HEADER_ALIASES)[]).forEach((k) => {
    const idx = header.findIndex((h) => HEADER_ALIASES[k].includes(h));
    if (idx >= 0) col[k] = idx;
  });
  for (const k of ['date', 'open', 'high', 'low', 'close'] as const) {
    if (col[k] === undefined) throw new Error(`CSV 缺少必需的列：${k}（可用中文表头：日期/开盘/最高/最低/收盘）`);
  }
  const map = new Map<string, Bar>();
  for (let i = 1; i < lines.length; i++) {
    const f = splitLine(lines[i], sep);
    const date = normalizeDate(f[col.date!] ?? '');
    if (!date) continue;
    const num = (k: keyof typeof HEADER_ALIASES) => (col[k] === undefined ? NaN : Number(String(f[col[k]!]).replace(/,/g, '')));
    const bar: Bar = {
      date,
      open: num('open'),
      high: num('high'),
      low: num('low'),
      close: num('close'),
      volume: Number.isFinite(num('volume')) ? num('volume') : 0,
    };
    const amt = num('amount');
    if (Number.isFinite(amt)) bar.amount = amt;
    if ([bar.open, bar.high, bar.low, bar.close].every((x) => Number.isFinite(x) && x > 0)) map.set(date, bar);
  }
  const bars = [...map.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  if (bars.length < 10) throw new Error('有效数据少于 10 行，请检查 CSV 格式');
  return bars;
}

export function toCsv(rows: (string | number)[][]): string {
  return rows
    .map((r) =>
      r
        .map((v) => {
          const s = typeof v === 'number' ? (Number.isFinite(v) ? String(Math.round(v * 1e6) / 1e6) : '') : v;
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(','),
    )
    .join('\n');
}

export function barsToCsv(bars: Bar[]): string {
  return toCsv([
    ['date', 'open', 'high', 'low', 'close', 'volume'],
    ...bars.map((b) => [b.date, b.open, b.high, b.low, b.close, b.volume]),
  ]);
}

/** 触发浏览器下载（带 BOM，Excel 打开中文不乱码） */
export function downloadText(filename: string, text: string, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob(['﻿' + text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
