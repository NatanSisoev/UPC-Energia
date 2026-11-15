import { mixAt, shares, SOURCE, type Source } from '../lib/supply';
import { derived, useSim } from '../store/useSim';
import { fmtKw } from '../lib/format';

const ORDER: Source[] = ['solar', 'battery', 'grid'];
const R = 40;
const CIRC = 2 * Math.PI * R;

/**
 * "Where is the power from?" as a pie (donut) chart: the share of demand covered by solar, the battery and the
 * grid this hour. Shows the whole campus by default; when a building is selected, shows that building instead.
 * Never rendered on hover.
 */
export default function EnergyFlow() {
  const campus = useSim((s) => s.campus);
  const selection = useSim((s) => s.selection);
  const tMin = useSim((s) => s.tMin);
  const snap = useSim((s) => s.snap);
  const d = derived.current;
  if (!snap || !campus || !d) return null;

  let mix = mixAt(snap.hour);
  let name = 'Whole campus';
  const bi = selection ? campus.features.findIndex((f) => f.properties.osmId === selection) : -1;
  if (bi >= 0) {
    // the building's demand is its share of the campus meter; campus solar/battery/grid are allocated to it pro rata
    const curH = Math.min(d.week.load.length - 1, Math.floor(tMin / 60));
    const load = d.shares[bi * 168 + curH] * d.week.load[curH];
    const k = load / Math.max(1e-9, mix.load);
    mix = { grid: mix.grid * k, battery: mix.battery * k, solar: mix.solar * k, load };
    name = campus.features[bi].properties.short;
  }
  const s = shares(mix);

  let acc = 0;
  const arcs = ORDER.map((k) => {
    const a = { k, f: Math.max(0, s[k]), dash: `${Math.max(0, s[k]) * CIRC} ${CIRC}`, off: -acc * CIRC };
    acc += Math.max(0, s[k]);
    return a;
  });

  const pct = (k: Source) => `${Math.round(s[k] * 100)}%`;

  return (
    <div className="card pointer-events-auto w-[280px] p-2.5" aria-label={`Where the energy of ${name} comes from`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="eyebrow">Where is the power from?</span>
        <span className="truncate text-[11px] font-medium">{name}</span>
      </div>

      <div className="mt-1.5 flex items-center gap-3">
        <svg viewBox="0 0 100 100" className="h-[84px] w-[84px] shrink-0" role="img" aria-label="Pie chart of solar, battery and grid supply">
          <g transform="rotate(-90 50 50)">
            <circle cx="50" cy="50" r={R} fill="none" stroke="var(--surface-3)" strokeWidth="20" />
            {arcs.map((a) =>
              a.f > 0.002 ? (
                <circle key={a.k} cx="50" cy="50" r={R} fill="none" stroke={SOURCE[a.k].color} strokeWidth="20" strokeDasharray={a.dash} strokeDashoffset={a.off} style={{ transition: 'stroke-dasharray .35s, stroke-dashoffset .35s' }}>
                  <title>{`${SOURCE[a.k].long}: ${Math.round(a.f * 100)}%`}</title>
                </circle>
              ) : null,
            )}
          </g>
          <text x="50" y="48" textAnchor="middle" fontSize="13" fontWeight="700" fill="currentColor" className="tnum">
            {mix.load >= 1000 ? (mix.load / 1000).toFixed(2) : mix.load.toFixed(0)}
          </text>
          <text x="50" y="60" textAnchor="middle" fontSize="7.5" fill="currentColor" opacity="0.6">
            {mix.load >= 1000 ? 'MW' : 'kW'} demand
          </text>
        </svg>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          {ORDER.map((k) => (
            <div key={k} className="flex items-center gap-2 text-[12px]">
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: SOURCE[k].color }} />
              <div className="min-w-0 flex-1 leading-tight">
                <div className="font-semibold">{SOURCE[k].label}</div>
                <div className="tnum text-[10.5px] muted">{fmtKw(mix[k])}</div>
              </div>
              <span className="tnum text-[13px] font-semibold" style={{ color: SOURCE[k].color }}>
                {pct(k)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
