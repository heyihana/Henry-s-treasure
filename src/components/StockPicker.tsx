import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../app/store';
import { DEMO_SPECS, guessSecid, parseCsv, POPULAR, registerCsv, searchEastmoney, type SearchResult } from '../lib/data';
import { marketFromSecid } from '../lib/data/eastmoney';
import type { StockMeta } from '../lib/types';
import { Seg, Spinner } from './ui';

const MARKET_LABEL: Record<string, string> = { A: 'A股', HK: '港股', US: '美股', DEMO: '演示', CSV: 'CSV' };

interface Group {
  title: string;
  items: (StockMeta & { typeName?: string })[];
}

function localMatch(q: string, list: StockMeta[]): StockMeta[] {
  const s = q.trim().toLowerCase();
  if (!s) return [];
  return list.filter((m) => m.code.toLowerCase().includes(s) || m.name.toLowerCase().includes(s));
}

export function StockSearch({
  onPick,
  placeholder = '输入代码 / 名称 / 拼音，如 600519、茅台、AAPL',
  autoFocus,
}: {
  onPick: (m: StockMeta) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const recent = useApp((s) => s.recent);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [remote, setRemote] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const s = q.trim();
    if (!s) {
      setRemote([]);
      return;
    }
    let alive = true;
    setSearching(true);
    const t = setTimeout(() => {
      searchEastmoney(s)
        .then((r) => alive && setRemote(r))
        .catch(() => alive && setRemote([]))
        .finally(() => alive && setSearching(false));
    }, 260);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const groups = useMemo<Group[]>(() => {
    const demos = DEMO_SPECS.map((d) => d.meta);
    if (!q.trim()) {
      return [
        { title: '最近访问', items: recent.slice(0, 6) },
        { title: '热门', items: POPULAR.slice(0, 10) },
        { title: '演示数据（离线可用）', items: demos },
      ].filter((g) => g.items.length);
    }
    const seen = new Set<string>();
    const dedupe = (arr: StockMeta[]) => arr.filter((m) => (seen.has(m.secid) ? false : (seen.add(m.secid), true)));
    const out: Group[] = [];
    const r = dedupe(remote);
    if (r.length) out.push({ title: '搜索结果', items: r });
    const local = dedupe(localMatch(q, [...recent, ...POPULAR, ...demos]));
    if (local.length) out.push({ title: r.length ? '本地匹配' : '匹配', items: local.slice(0, 8) });
    const guess = guessSecid(q);
    if (guess && !seen.has(guess)) {
      out.push({
        title: '按代码加载',
        items: [{ code: guess.split('.').slice(1).join('.'), name: `加载 ${q.trim().toUpperCase()}`, secid: guess, market: marketFromSecid(guess) }],
      });
    }
    return out;
  }, [q, remote, recent]);

  const flat = groups.flatMap((g) => g.items);

  const pick = (m: StockMeta) => {
    setOpen(false);
    setQ('');
    onPick(m.name.startsWith('加载 ') ? { ...m, name: m.code } : m);
  };

  let idx = -1;
  return (
    <div className="search" ref={boxRef}>
      <input
        className="input"
        type="search"
        id="stock-search"
        aria-label="搜索股票"
        placeholder={placeholder}
        value={q}
        autoFocus={autoFocus}
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(flat.length - 1, a + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (e.key === 'Enter' && flat[active]) {
            e.preventDefault();
            pick(flat[active]);
          } else if (e.key === 'Escape') setOpen(false);
        }}
      />
      {open && (
        <div className="search-results" role="listbox">
          {searching && (
            <div className="search-group" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <Spinner /> 正在搜索…
            </div>
          )}
          {groups.map((g) => (
            <div key={g.title}>
              <div className="search-group">{g.title}</div>
              {g.items.map((m) => {
                idx++;
                const i = idx;
                return (
                  <button
                    type="button"
                    role="option"
                    aria-selected={i === active}
                    key={g.title + m.secid}
                    className={`search-item ${i === active ? 'active' : ''}`}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => pick(m)}
                  >
                    <span className="code">{m.code}</span>
                    <span className="nm">{m.name}</span>
                    <span className="badge">{(m as SearchResult).typeName || MARKET_LABEL[m.market] || m.market}</span>
                  </button>
                );
              })}
            </div>
          ))}
          {!groups.length && !searching && <div className="search-group">没有匹配结果</div>}
        </div>
      )}
    </div>
  );
}

export function CsvImportButton({ onLoaded }: { onLoaded?: () => void }) {
  const setStockData = useApp((s) => s.setStockData);
  const toast = useApp((s) => s.toast);
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" className="btn" onClick={() => ref.current?.click()} title="导入 CSV 行情数据">
        导入 CSV
      </button>
      <input
        ref={ref}
        type="file"
        accept=".csv,.txt,text/csv"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          try {
            const bars = parseCsv(await file.text());
            const name = file.name.replace(/\.[^.]+$/, '');
            const data = {
              meta: { code: name.slice(0, 12), name, secid: `csv.${name}`, market: 'CSV' as const },
              bars,
              period: 'day' as const,
              adjust: 'none' as const,
              source: 'csv' as const,
              fetchedAt: Date.now(),
            };
            registerCsv(data);
            setStockData(data);
            toast(`已导入 ${name}：${bars.length} 根 K 线`);
            onLoaded?.();
          } catch (err) {
            toast(`导入失败：${(err as Error).message}`, 'error');
          }
        }}
      />
    </>
  );
}

/** 页面顶部的证券选择工具条 */
export function StockToolbar({ showPeriod = true }: { showPeriod?: boolean }) {
  const load = useApp((s) => s.load);
  const stock = useApp((s) => s.stock);
  const loading = useApp((s) => s.loading);
  const period = useApp((s) => s.period);
  const adjust = useApp((s) => s.adjust);
  const setPeriod = useApp((s) => s.setPeriod);
  const setAdjust = useApp((s) => s.setAdjust);
  const live = stock && stock.meta.market !== 'DEMO' && stock.meta.market !== 'CSV';
  return (
    <div className="toolbar">
      <StockSearch onPick={(m) => void load(m)} />
      {showPeriod && (
        <Seg
          ariaLabel="K线周期"
          value={period}
          onChange={setPeriod}
          options={[
            { value: 'day', label: '日K' },
            { value: 'week', label: '周K' },
            { value: 'month', label: '月K' },
          ]}
        />
      )}
      {live && (
        <Seg
          ariaLabel="复权方式"
          value={adjust}
          onChange={setAdjust}
          options={[
            { value: 'qfq', label: '前复权' },
            { value: 'hfq', label: '后复权' },
            { value: 'none', label: '不复权' },
          ]}
        />
      )}
      {live && (
        <button type="button" className="btn" disabled={loading} onClick={() => stock && void load(stock.meta, { force: true })}>
          {loading ? <Spinner /> : null}刷新
        </button>
      )}
      <CsvImportButton />
    </div>
  );
}
