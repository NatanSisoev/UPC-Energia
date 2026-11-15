/** Small form primitives in the app's technical style (all colours come from the theme tokens). */
import type { ReactNode } from 'react';

export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className={`switch ${on ? 'on' : ''}`} onClick={() => onChange(!on)} />;
}

export function Seg<T extends string | number>({ value, options, onChange, label }: { value: T; options: Array<[T, ReactNode]>; onChange: (v: T) => void; label?: string }) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map(([v, l]) => (
        <button key={String(v)} type="button" role="radio" aria-checked={v === value} className={v === value ? 'on' : ''} onClick={() => onChange(v)}>
          {l}
        </button>
      ))}
    </div>
  );
}

export function Range({ value, min, max, step = 1, onChange, label }: { value: number; min: number; max: number; step?: number; onChange: (v: number) => void; label: string }) {
  const fill = ((value - min) / Math.max(1e-9, max - min)) * 100;
  return (
    <input
      type="range"
      className="range"
      aria-label={label}
      min={min}
      max={max}
      step={step}
      value={value}
      style={{ '--fill': `${fill}%` } as React.CSSProperties}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  );
}

/** One settings line: title + hint on the left, control on the right. */
export function Row({ title, hint, children, icon }: { title: ReactNode; hint?: ReactNode; children?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex items-center gap-4 border-b border-[var(--border)] py-3 last:border-b-0">
      {icon && <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[var(--surface-2)] text-[var(--muted)]">{icon}</div>}
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] font-medium">{title}</div>
        {hint && <div className="mt-0.5 text-[12px] leading-snug text-[var(--muted)]">{hint}</div>}
      </div>
      {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </div>
  );
}

export function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="mb-6">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="eyebrow">{title}</h3>
        {right}
      </div>
      <div className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-4">{children}</div>
    </section>
  );
}
