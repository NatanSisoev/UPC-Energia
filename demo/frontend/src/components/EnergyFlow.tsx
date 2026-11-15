import { mixAt, shares, SOURCE, type Source } from '../lib/supply';
import { useSim } from '../store/useSim';
import { fmtKw } from '../lib/format';

const ORDER: Source[] = ['solar', 'battery', 'grid'];
const R = 40;
const CIRC = 2 * Math.PI * R;

/**
 * "Where is the power coming from right now?" as a pie (donut) chart: the share of the campus demand covered by
 * solar, the battery and the grid this hour, with the demand in the centre. Below: a plain sentence, and what the
 * battery is doing (charging / discharging / idle) with its charge level.
 */
export default function EnergyFlow() {
  const snap = useSim((s) => s.snap);
  if (!snap) return null;

  const mix = mixAt(snap.hour);
  const s = shares(mix);

  let acc = 0;
  const arcs = ORDER.map((k) => {
    const a = { k, f: Math.max(0, s[k]), dash: `${Math.max(0, s[k]) * CIRC} ${CIRC}`, off: -acc * CIRC };
    acc += Math.max(0, s[k]);
    return a;
  });

  const pct = (k: Source) => `${Math.round(s[k] * 100)}%`;
  const batt = snap.battKw; // + charging, − discharging
  const idle = Math.abs(batt) < 1;

  return (
    <div className="card pointer-events-auto w-[280px] p-2.5" aria-label="Where the energy comes from">
      <div className="flex items-baseline justify-between">
        <span className="eyebrow">Where is the power from?</span>
        <span className="tnum text-[11px] muted">demand {fmtKw(mix.load)}</span>
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
            {(mix.load / 1000).toFixed(2)}
          </text>
          <text x="50" y="60" textAnchor="middle" fontSize="7.5" fill="currentColor" opacity="0.6">
            MW demand
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

      {/* what the battery is doing */}
      {snap.capacityKwh > 0 && (
        <div className="mt-2 flex items-center gap-2 text-[11.5px]">
          <span className="font-semibold" style={{ color: SOURCE.battery.color }}>
            {idle ? '■ Battery idle' : batt > 0 ? `▲ Charging ${fmtKw(batt)}` : `▼ Discharging ${fmtKw(-batt)}`}
          </span>
          <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-[var(--surface-3)]" title={`Charge level ${(snap.soc * 100).toFixed(0)}%`}>
            <div className="h-full rounded-full" style={{ width: `${(snap.soc * 100).toFixed(1)}%`, background: SOURCE.battery.color }} />
          </div>
          <span className="tnum muted">{(snap.soc * 100).toFixed(0)}%</span>
        </div>
      )}
      {snap.capacityKwh > 0 && batt > 1 && (
        <div className="mt-0.5 text-[10.5px] faint">Charging power is taken from the grid and is not counted as campus supply.</div>
      )}
    </div>
  );
}
