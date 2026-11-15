import { SOURCE, shares, type Mix, type Source } from '../lib/supply';
import { fmtKw } from '../lib/format';

const ORDER: Source[] = ['grid', 'battery', 'solar'];

/**
 * "Where does the power come from?" as a donut: grid / battery / solar share of the supply mix, with a legend of
 * kW (or the `fmt` unit) and %. `h` only picks the size (compact when <= 6, used by tooltips and the sidebar).
 */
export default function SupplyBar({ mix, legend = true, h = 8, fmt = fmtKw }: { mix: Mix; legend?: boolean; h?: number; /** value formatter for the legend (default kW) */ fmt?: (v: number) => string }) {
  const s = shares(mix);
  const size = h <= 6 ? 76 : 92;
  const r = 38;
  const C = 2 * Math.PI * r;
  let acc = 0;
  const arcs = ORDER.map((k) => {
    const a = { k, f: s[k], dash: `${s[k] * C} ${C}`, off: -acc * C };
    acc += s[k];
    return a;
  });
  return (
    <div className="flex items-center gap-3">
      <svg viewBox="0 0 100 100" width={size} height={size} className="shrink-0 -rotate-90" role="img" aria-label="Where the power comes from">
        <circle cx="50" cy="50" r={r} fill="none" stroke="var(--surface-3)" strokeWidth="18" />
        {arcs.map((a) =>
          a.f > 0.002 ? (
            <circle key={a.k} cx="50" cy="50" r={r} fill="none" stroke={SOURCE[a.k].color} strokeWidth="18" strokeDasharray={a.dash} strokeDashoffset={a.off} style={{ transition: 'stroke-dasharray .35s, stroke-dashoffset .35s' }}>
              <title>{`${SOURCE[a.k].long}: ${(a.f * 100).toFixed(0)}%`}</title>
            </circle>
          ) : null,
        )}
      </svg>
      {legend && (
        <div className="flex min-w-0 flex-1 flex-col gap-1 text-[11px]">
          {ORDER.map((k) => (
            <span key={k} className="flex items-center gap-1.5">
              <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: SOURCE[k].color }} />
              <span className="muted">{SOURCE[k].label}</span>
              <span className="tnum ml-auto font-medium">{(s[k] * 100).toFixed(0)}%</span>
              <span className="tnum faint w-[58px] text-right">{fmt(mix[k])}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Legend chips only (for charts). */
export function SourceLegend() {
  return (
    <span className="flex items-center gap-2.5 text-[10px] muted">
      {ORDER.map((k) => (
        <span key={k} className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-sm" style={{ background: SOURCE[k].color }} />
          {SOURCE[k].label}
        </span>
      ))}
    </span>
  );
}
