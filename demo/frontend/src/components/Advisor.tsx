import { derived, useSim } from '../store/useSim';
import { fmtKw } from '../lib/format';
import { Bar, Chip } from './ui';
import type { AgentKind } from '../types';

const AGENTS: Array<[AgentKind, string, string]> = [
  ['mpc', '🧠 24 h MPC', '#a6e05a'],
  ['template', '📏 Template', '#ffb627'],
  ['none', '🚫 No battery', '#8da0d8'],
];

function pct(v: number): string {
  return `${v >= 0 ? '+' : '−'}${Math.abs(Math.round(v * 100))}%`;
}

/** The agent's "voice": what it does this hour and why, plus the next 24 h it is looking at. */
export default function Advisor() {
  const snap = useSim((s) => s.snap);
  const agent = useSim((s) => s.agent);
  const version = useSim((s) => s.version);
  void version;
  const d = derived.current;
  if (!snap || !d) return null;

  const r = snap.reason;
  const kw = Math.abs(snap.battKw);
  const accent = snap.battKw > 5 ? '#ab8cff' : snap.battKw < -5 ? '#ffb627' : '#7be0a8';
  const head =
    agent === 'none'
      ? 'No battery installed'
      : snap.battKw > 5
        ? `Charging ${fmtKw(kw)}`
        : snap.battKw < -5
          ? `Discharging ${fmtKw(kw)}`
          : 'Holding charge';

  let why = '';
  if (agent === 'none') why = 'The campus buys every kWh at whatever the grid charges right now — this is the baseline every score is measured against.';
  else if (agent === 'template') why = 'Fixed rules: charge at night if the price is low, discharge 18–22 h. It never looks at tomorrow\'s prices.';
  else if (r.action === 'charge') why = `This hour is among the best ${Math.max(5, Math.round(r.rank * 100))}% of the next 24 h — price ${pct(r.priceVsMean)}, CO₂ ${pct(r.co2VsMean)} vs. the window average. Stock up.`;
  else if (r.action === 'discharge') why = `This hour is among the worst ${Math.max(5, Math.round((1 - r.rank) * 100))}% of the next 24 h — price ${pct(r.priceVsMean)}, CO₂ ${pct(r.co2VsMean)}. Release stored energy${r.guard ? ' (capped so nothing is exported for free)' : ''}.`;
  else why = 'The spread to the next cheap/clean hours is too small to beat the 10 % round-trip loss. Waiting.';

  // next 24 h bars: price height, action colour
  const rows = [];
  let pMax = 0;
  for (let i = 0; i < 24; i++) {
    const h = snap.hour + i;
    if (h >= 168) break;
    pMax = Math.max(pMax, d.week.price[h]);
  }
  for (let i = 0; i < 24; i++) {
    const h = snap.hour + i;
    if (h >= 168) break;
    rows.push({ i, p: d.week.price[h] / pMax, sp: d.chosen.sp[h], co2: d.week.co2[h] });
  }

  return (
    <div className="pointer-events-auto flex w-[300px] flex-col gap-2.5">
      <div className="panel pop-in overflow-visible !rounded-[22px] p-3.5">
        <div className="flex items-start gap-3">
          <div
            className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-2xl"
            style={{ background: `linear-gradient(180deg, ${accent}, color-mix(in srgb, ${accent} 60%, #000))`, boxShadow: `0 4px 0 #0b1128, 0 0 22px -2px ${accent}` }}
          >
            {snap.battKw > 5 ? '🔋' : snap.battKw < -5 ? '⚡' : '😴'}
          </div>
          <div className="min-w-0">
            <div className="label-caps">Battery agent</div>
            <div className="font-display text-[17px] leading-tight" style={{ color: accent }}>
              {head}
            </div>
          </div>
        </div>
        <p className="mt-2.5 rounded-xl bg-black/25 px-3 py-2 text-[12px] font-semibold leading-snug text-slate-200">{why}</p>

        {agent !== 'none' && (
          <div className="mt-3">
            <div className="mb-1 flex items-center justify-between text-[11px] font-extrabold">
              <span className="text-slate-300">State of charge</span>
              <span className="tnum" style={{ color: accent }}>
                {(snap.soc * 100).toFixed(0)}% · {Math.round(snap.soc * snap.capacityKwh)} / {Math.round(snap.capacityKwh)} kWh
              </span>
            </div>
            <Bar v={snap.soc} accent={accent} h={14} />
          </div>
        )}

        <div className="mt-3">
          <div className="label-caps mb-1">Next 24 h · price &amp; action</div>
          <div className="flex h-14 items-end gap-[2px]">
            {rows.map((r2) => (
              <div key={r2.i} className="relative flex h-full flex-1 flex-col justify-end" title={`+${r2.i} h`}>
                <div
                  className="rounded-t-[3px]"
                  style={{
                    height: `${Math.max(8, r2.p * 100)}%`,
                    background: r2.sp > 5 ? '#ab8cff' : r2.sp < -5 ? '#ffb627' : '#3d5a85',
                    outline: r2.i === 0 ? '2px solid #fff' : 'none',
                    boxShadow: r2.i === 0 ? '0 0 10px #fff' : 'none',
                  }}
                />
              </div>
            ))}
          </div>
          <div className="mt-1 flex gap-3 text-[9px] font-extrabold uppercase tracking-wider text-slate-400">
            <span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-[#ab8cff]" />charge</span>
            <span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-[#ffb627]" />discharge</span>
            <span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-[#3d5a85]" />idle</span>
          </div>
        </div>
      </div>

      <div className="panel pop-in !rounded-[20px] px-3 py-2.5">
        <div className="label-caps mb-1.5">Who is driving?</div>
        <div className="flex flex-wrap gap-1.5">
          {AGENTS.map(([k, label, color]) => (
            <Chip key={k} active={agent === k} accent={color} onClick={() => useSim.getState().setAgent(k)}>
              {label}
            </Chip>
          ))}
        </div>
      </div>
    </div>
  );
}
