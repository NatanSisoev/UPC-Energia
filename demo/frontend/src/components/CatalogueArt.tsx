import type { PanelModelId } from '../types';

/** Self-made inline illustrations for the catalogue (no external assets; colours come from the theme tokens). */

/** Battery container, its width growing with the energy (MWh) relative to the largest unit; one cell block per ~0.5 MWh. */
export function BatteryArt({ mwh, maxMwh, accent }: { mwh: number; maxMwh: number; accent: string }) {
  const W = 220;
  const w = 50 + (W - 50) * Math.sqrt(mwh / maxMwh);
  const x = (W - w) / 2;
  const blocks = Math.max(2, Math.round(mwh / 0.5) + 1);
  const bw = (w - 16) / blocks;
  return (
    <svg viewBox={`0 0 ${W} 74`} className="h-[74px] w-full" role="img" aria-label={`Battery container, ${mwh} MWh`}>
      <line x1="4" y1="64" x2={W - 4} y2="64" stroke="var(--border)" strokeWidth="1.5" />
      <rect x={x} y="16" width={w} height="46" rx="4" fill="var(--surface)" stroke="var(--border)" strokeWidth="1.5" />
      <rect x={x + 6} y="8" width="10" height="8" rx="1.5" fill="var(--surface-3)" />
      <rect x={x + w - 16} y="8" width="10" height="8" rx="1.5" fill="var(--surface-3)" />
      {Array.from({ length: blocks }, (_, i) => (
        <rect key={i} x={x + 8 + i * bw + 1} y="22" width={Math.max(2, bw - 2)} height="26" rx="2" fill={accent} opacity={0.55 + 0.45 * ((i + 1) / blocks)} />
      ))}
      <rect x={x + 8} y="53" width={w - 16} height="3" rx="1.5" fill="var(--surface-3)" />
      <circle cx={x + w - 11} cy="54.5" r="2" fill={accent} />
    </svg>
  );
}

const CELLS: Record<PanelModelId, { cols: number; rows: number; half: boolean; tandem: boolean }> = {
  mono: { cols: 6, rows: 10, half: false, tandem: false },
  hjt: { cols: 6, rows: 12, half: true, tandem: false },
  tandem: { cols: 6, rows: 14, half: true, tandem: true },
};

/** Solar module with the cell layout of each technology: full cells (PERC), half-cut cells (HJT), two-layer cells (tandem). */
export function PanelArt({ id, accent }: { id: PanelModelId; accent: string }) {
  const c = CELLS[id];
  const W = 120;
  const H = 74;
  const pw = 100;
  const ph = 68;
  const x0 = (W - pw) / 2;
  const y0 = (H - ph) / 2;
  const cw = (pw - 6) / c.cols;
  const ch = (ph - 6) / c.rows;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-[74px] w-full" role="img" aria-label={`Solar module, ${id} technology`}>
      <rect x={x0} y={y0} width={pw} height={ph} rx="3" fill="var(--surface-3)" stroke="var(--border)" strokeWidth="1.5" />
      {Array.from({ length: c.cols * c.rows }, (_, i) => {
        const cx = x0 + 3 + (i % c.cols) * cw;
        const cy = y0 + 3 + Math.floor(i / c.cols) * ch;
        return (
          <g key={i}>
            <rect x={cx + 0.6} y={cy + 0.6} width={cw - 1.2} height={ch - 1.2} rx="0.8" fill={accent} opacity={0.75} />
            {c.tandem && <rect x={cx + 0.6} y={cy + 0.6} width={cw - 1.2} height={(ch - 1.2) / 2} rx="0.8" fill="var(--violet)" opacity={0.6} />}
          </g>
        );
      })}
    </svg>
  );
}

/** Thin horizontal bar: `value` of `max`, with a caption on the left and right. */
export function MiniBar({ label, right, value, max, color = 'var(--accent)' }: { label: string; right: string; value: number; max: number; color?: string }) {
  const pct = Math.max(0, Math.min(1, value / max)) * 100;
  return (
    <div>
      <div className="flex justify-between text-[10.5px] faint">
        <span>{label}</span>
        <span className="tnum">{right}</span>
      </div>
      <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-[var(--surface-3)]">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

/** Payback timeline: the track is the service life, the filled part is the time needed to pay for the item. */
export function PaybackBar({ years, life, pays }: { years: number; life: number; pays: boolean }) {
  const max = Math.max(life, Number.isFinite(years) ? years : life);
  const fill = Number.isFinite(years) ? (years / max) * 100 : 100;
  const lifePos = (life / max) * 100;
  const color = pays ? 'var(--accent)' : 'var(--danger)';
  return (
    <div className="mt-3">
      <div className="relative h-2 rounded-full bg-[var(--surface-3)]">
        <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${fill}%`, background: color }} />
        <div className="absolute -top-0.5 h-3 w-[2px] bg-[var(--text)]" style={{ left: `calc(${lifePos}% - 1px)` }} title={`Service life ${life} yr`} />
      </div>
      <div className="mt-1 flex justify-between text-[10.5px] faint">
        <span>0</span>
        <span className="tnum">{Number.isFinite(years) ? `paid back in ${years.toFixed(1)} yr` : 'never paid back'}</span>
        <span className="tnum">{life} yr life</span>
      </div>
    </div>
  );
}
