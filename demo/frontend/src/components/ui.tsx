import type { CSSProperties, ReactNode } from 'react';

/** Game-UI primitives shared by every surface. */

export function Panel({
  title,
  subtitle,
  icon,
  right,
  children,
  className = '',
}: {
  title?: string;
  subtitle?: string;
  icon?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel flex flex-col overflow-hidden ${className}`}>
      {title && (
        <header className="flex items-center justify-between gap-2 border-b-2 border-white/5 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            {icon && <span className="text-xl">{icon}</span>}
            <div className="min-w-0">
              <h2 className="panel-title truncate text-white">{title}</h2>
              {subtitle && <p className="truncate text-[11px] font-semibold text-slate-400">{subtitle}</p>}
            </div>
          </div>
          {right}
        </header>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">{children}</div>
    </section>
  );
}

export function Chip({
  active,
  onClick,
  children,
  accent = '#3ee6ff',
  title,
}: {
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
  accent?: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`btn !px-2.5 !py-1 !text-[11px] ${active ? 'btn-on' : ''}`}
      style={{ '--accent': accent } as CSSProperties}
    >
      {children}
    </button>
  );
}

export function Toggle({ checked, onChange, accent = '#3ee6ff', label }: { checked: boolean; onChange: (v: boolean) => void; accent?: string; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className="relative h-6 w-11 shrink-0 rounded-full border-2 border-[#0b1128] transition-colors duration-200"
      style={{ background: checked ? accent : '#2b3868', boxShadow: '0 3px 0 #0b1128' }}
    >
      <span className="absolute top-[1px] h-4 w-4 rounded-full bg-white shadow transition-all duration-200" style={{ left: checked ? 22 : 2 }} />
    </button>
  );
}

export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  accent = '#3ee6ff',
  className = '',
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  accent?: string;
  className?: string;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className={`w-full ${className}`}
      style={{ color: accent, '--fill': `${pct}%` } as CSSProperties}
    />
  );
}

export function Bar({ v, accent, h = 10 }: { v: number; accent: string; h?: number }) {
  return (
    <div className="w-full overflow-hidden rounded-full border-2 border-[#0b1128] bg-[#131b3a]" style={{ height: h }}>
      <div
        className="h-full rounded-full transition-all duration-300"
        style={{
          width: `${Math.round(Math.min(1, Math.max(0, v)) * 100)}%`,
          background: `linear-gradient(180deg, ${accent}, color-mix(in srgb, ${accent} 65%, #000))`,
          boxShadow: `0 0 10px ${accent}88`,
        }}
      />
    </div>
  );
}

/** Round resource pill used in the top HUD. */
export function Resource({ icon, color, label, value, unit, sub }: { icon: ReactNode; color: string; label: string; value: string; unit?: string; sub?: string }) {
  return (
    <div className="pill" style={{ '--c': color, '--edge': `color-mix(in srgb, ${color} 40%, #3a4a7c)` } as CSSProperties}>
      <span className="pill-ico">{icon}</span>
      <div className="leading-none">
        <div className="text-[9px] font-extrabold uppercase tracking-[0.14em] text-slate-400">{label}</div>
        <div className="tnum mt-0.5 text-[17px] font-black" style={{ color }}>
          {value}
          {unit && <span className="ml-1 text-[10px] font-extrabold text-slate-400">{unit}</span>}
        </div>
        {sub && <div className="tnum text-[9px] font-bold text-slate-400">{sub}</div>}
      </div>
    </div>
  );
}

export function Stars({ n, size = 18 }: { n: number; size?: number }) {
  return (
    <span className="inline-flex gap-0.5" aria-label={`${n} of 3 stars`}>
      {[0, 1, 2].map((i) => (
        <span key={i} style={{ fontSize: size, filter: i < n ? 'drop-shadow(0 0 6px #ffc83d)' : 'none', color: i < n ? '#ffc83d' : '#3a4a7c' }}>
          ★
        </span>
      ))}
    </span>
  );
}
