import { useEffect, useId, useState, type ReactNode } from 'react';
import { useApp } from '../app/store';

export function Panel({
  title,
  extra,
  children,
  flush,
  className,
}: {
  title?: ReactNode;
  extra?: ReactNode;
  children: ReactNode;
  flush?: boolean;
  className?: string;
}) {
  return (
    <section className={`panel ${className ?? ''}`}>
      {(title || extra) && (
        <div className="panel-head">
          {title && <h2 className="panel-title">{title}</h2>}
          {extra}
        </div>
      )}
      <div className={`panel-body ${flush ? 'flush' : ''}`}>{children}</div>
    </section>
  );
}

export function Collapsible({
  title,
  children,
  defaultOpen = true,
  extra,
}: {
  title: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  extra?: ReactNode;
}) {
  return (
    <details className="panel" open={defaultOpen}>
      <summary>
        <span className="panel-title">{title}</span>
        {extra && <span style={{ marginLeft: 'auto' }}>{extra}</span>}
      </summary>
      <div className="panel-body">{children}</div>
    </details>
  );
}

const roundTo = (v: number, step: number) => {
  const d = (String(step).split('.')[1] ?? '').length;
  return Number(v.toFixed(Math.min(8, d + 2)));
};

export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  hint,
  slider = false,
  scale = 1,
  suffix,
  id,
}: {
  label: ReactNode;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  hint?: ReactNode;
  slider?: boolean;
  /** 显示值 = 实际值 × scale（如百分比） */
  scale?: number;
  suffix?: string;
  id?: string;
}) {
  const autoId = useId();
  const fid = id ?? autoId;
  const shown = roundTo(value * scale, step);
  const [text, setText] = useState(String(shown));
  useEffect(() => setText(String(shown)), [shown]);

  const commit = (raw: string) => {
    let v = Number(raw);
    if (!Number.isFinite(v)) {
      setText(String(shown));
      return;
    }
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    setText(String(v));
    if (v !== shown) onChange(v / scale);
  };

  const input = (
    <input
      id={fid}
      className="input num"
      type="number"
      inputMode="decimal"
      value={text}
      min={min}
      max={max}
      step={step}
      onChange={(e) => {
        setText(e.target.value);
        const v = Number(e.target.value);
        if (e.target.value !== '' && Number.isFinite(v) && (min === undefined || v >= min) && (max === undefined || v <= max)) onChange(v / scale);
      }}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => e.key === 'Enter' && commit((e.target as HTMLInputElement).value)}
    />
  );

  return (
    <div className="field">
      <label htmlFor={fid}>
        <span>{label}</span>
        {suffix && <span className="muted">{suffix}</span>}
      </label>
      {slider && min !== undefined && max !== undefined ? (
        <div className="range-row">
          <input
            type="range"
            aria-label={typeof label === 'string' ? label : undefined}
            min={min}
            max={max}
            step={step}
            value={shown}
            onChange={(e) => onChange(Number(e.target.value) / scale)}
          />
          {input}
        </div>
      ) : (
        input
      )}
      {hint && <span className="field-hint">{hint}</span>}
    </div>
  );
}

export function SelectField<T extends string | number>({
  label,
  value,
  options,
  onChange,
  id,
}: {
  label: ReactNode;
  value: T;
  options: { value: T; label: string; group?: string }[];
  onChange: (v: T) => void;
  id?: string;
}) {
  const autoId = useId();
  const fid = id ?? autoId;
  const groups = [...new Set(options.map((o) => o.group ?? ''))];
  const toVal = (s: string) => (typeof value === 'number' ? (Number(s) as T) : (s as T));
  return (
    <div className="field">
      <label htmlFor={fid}>{label}</label>
      <select id={fid} className="select" value={String(value)} onChange={(e) => onChange(toVal(e.target.value))}>
        {groups.length > 1
          ? groups.map((g) => (
              <optgroup key={g} label={g || '其他'}>
                {options
                  .filter((o) => (o.group ?? '') === g)
                  .map((o) => (
                    <option key={String(o.value)} value={String(o.value)}>
                      {o.label}
                    </option>
                  ))}
              </optgroup>
            ))
          : options.map((o) => (
              <option key={String(o.value)} value={String(o.value)}>
                {o.label}
              </option>
            ))}
      </select>
    </div>
  );
}

export function Seg<T extends string | number>({
  value,
  options,
  onChange,
  block,
  ariaLabel,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  block?: boolean;
  ariaLabel?: string;
}) {
  return (
    <div className={`seg ${block ? 'block' : ''}`} role="radiogroup" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          type="button"
          role="radio"
          aria-checked={o.value === value}
          key={String(o.value)}
          className={o.value === value ? 'on' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({ value, tabs, onChange }: { value: T; tabs: { id: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button type="button" role="tab" aria-selected={t.id === value} key={t.id} className={t.id === value ? 'on' : ''} onClick={() => onChange(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Tile({ label, value, sub, tone }: { label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: string }) {
  return (
    <div className="tile">
      <span className="tile-label">{label}</span>
      <span className={`tile-value ${tone ?? ''}`}>{value}</span>
      {sub !== undefined && <span className="tile-sub">{sub}</span>}
    </div>
  );
}

export function Check({ label, checked, onChange }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind === 'error' ? 'error' : ''}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

export function Progress({ value }: { value: number }) {
  return (
    <div className="progress" role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Spinner() {
  return <span className="spinner" aria-label="加载中" />;
}
