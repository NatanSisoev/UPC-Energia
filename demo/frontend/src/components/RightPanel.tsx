import { useMemo } from 'react';
import { derived, useSim } from '../store/useSim';
import { BATTERY_MODELS, PANEL_MODELS, SUBSTATION_POWER_LIMIT_MW } from '../data/catalogue';
import { asBuiltCoverage, installedKwp, modelOf, panelKwm2, PV_ASBUILT_KWP } from '../sim/engine';
import { Bar, Chip, Panel, Slider, Stars, Toggle } from './ui';
import { fmtEur, fmtKw } from '../lib/format';
import { ROOF } from '../scene/world';

/** Right-hand build menu: routed tabs. */
export default function RightPanel({ tab }: { tab: 'overview' | 'solar' | 'batteries' | 'impact' }) {
  if (tab === 'solar') return <SolarLab />;
  if (tab === 'batteries') return <BatteryLab />;
  if (tab === 'impact') return <Impact />;
  return <Overview />;
}

/* ------------------------------------------------------------ OVERVIEW ---- */

function Overview() {
  const snap = useSim((s) => s.snap);
  const campus = useSim((s) => s.campus)!;
  const selection = useSim((s) => s.selection);
  const select = useSim((s) => s.select);
  const top = [...campus.features]
    .sort((a, b) => (snap?.perB[b.properties.osmId]?.loadKw ?? 0) - (snap?.perB[a.properties.osmId]?.loadKw ?? 0))
    .slice(0, 9);
  const max = snap?.perB[top[0].properties.osmId]?.loadKw ?? 1;
  const sel = campus.features.find((f) => f.properties.osmId === selection)?.properties;

  return (
    <Panel title="Campus overview" icon="🏫" subtitle={`${campus.features.length} buildings · real UPC Campus Nord data`}>
      {sel && (
        <div className="panel-flat pop-in mb-3 p-3" style={{ borderColor: `rgb(${ROOF[sel.category].join(',')})` }}>
          <div className="flex items-center justify-between">
            <div className="font-display text-[15px] text-white">{sel.short}</div>
            <button type="button" className="text-[11px] font-extrabold text-slate-400 hover:text-white" onClick={() => select(null)}>✕</button>
          </div>
          <div className="text-[11px] font-semibold text-slate-400">{sel.name}</div>
          <div className="tnum mt-2 grid grid-cols-3 gap-2 text-center">
            <Mini label="Load" v={fmtKw(snap?.perB[sel.osmId]?.loadKw ?? 0)} c="#ff6b8a" />
            <Mini label="Solar" v={fmtKw(snap?.perB[sel.osmId]?.solarKw ?? 0)} c="#ffc83d" />
            <Mini label="Floors" v={`${sel.levels ?? Math.round(sel.height_m / 3.5)}`} c="#9bb4ff" />
          </div>
        </div>
      )}
      <div className="label-caps mb-1.5">Biggest consumers right now</div>
      <div className="flex flex-col gap-1">
        {top.map((f) => {
          const p = f.properties;
          const load = snap?.perB[p.osmId]?.loadKw ?? 0;
          return (
            <button key={p.osmId} type="button" onClick={() => select(p.osmId === selection ? null : p.osmId)} className={`flex items-center gap-2 rounded-xl px-2 py-1.5 text-left transition hover:bg-white/5 ${p.osmId === selection ? 'bg-white/10' : ''}`}>
              <span className="h-3 w-3 shrink-0 rounded-[4px] border border-black/30" style={{ background: `rgb(${ROOF[p.category].join(',')})` }} />
              <span className="w-24 shrink-0 truncate text-[12px] font-extrabold text-slate-100">{p.short}</span>
              <div className="flex-1"><Bar v={load / max} accent="#ff6b8a" h={8} /></div>
              <span className="tnum w-16 shrink-0 text-right text-[11px] font-black text-rose-300">{fmtKw(load)}</span>
            </button>
          );
        })}
      </div>
      <div className="panel-flat mt-4 p-3 text-[12px] font-semibold leading-relaxed text-slate-300">
        <b className="text-white">How to play · </b>press <span className="text-cyan-300">▶</span>, scrub the week ribbon, switch who drives the battery, then open
        <span className="text-amber-300"> Solar</span>, <span className="text-violet-300">Battery</span> and <span className="text-lime-300">Impact</span> to change the campus and watch the score move.
        Use <b className="text-white">Layers</b> for heatmaps, people and weather, and <b className="text-white">Sun</b> to freeze the light.
      </div>
    </Panel>
  );
}

function Mini({ label, v, c }: { label: string; v: string; c: string }) {
  return (
    <div className="rounded-lg bg-black/25 py-1.5">
      <div className="text-[9px] font-extrabold uppercase tracking-wider text-slate-400">{label}</div>
      <div className="text-[13px] font-black" style={{ color: c }}>{v}</div>
    </div>
  );
}

/* --------------------------------------------------------------- SOLAR ---- */

function SolarLab() {
  const campus = useSim((s) => s.campus)!;
  const solar = useSim((s) => s.solar);
  const panelModel = useSim((s) => s.panelModel);
  const snap = useSim((s) => s.snap);
  const selection = useSim((s) => s.selection);
  const st = useSim.getState();
  const pv = useMemo(() => campus.features.filter((f) => f.properties.pv_fraction > 0), [campus]);
  const cov0 = useMemo(() => asBuiltCoverage(campus.features.map((f) => f.properties)), [campus]);
  const kwp = pv.reduce((a, f) => a + installedKwp(f.properties, solar[f.properties.osmId] ?? { on: false, fraction: 0, tilt: 18 }, panelModel), 0);

  return (
    <Panel
      title="Solar lab"
      icon="☀️"
      subtitle={`${kwp.toFixed(0)} kWp installed · ${fmtKw(snap?.solarKw ?? 0)} now · as-built plant ${PV_ASBUILT_KWP} kWp`}
      right={
        <div className="flex gap-1">
          <Chip onClick={() => st.solarPreset('off')} accent="#8da0d8">off</Chip>
          <Chip onClick={() => st.solarPreset('asbuilt')} accent="#ffc83d">real</Chip>
          <Chip onClick={() => st.solarPreset('max')} accent="#ffc83d">max</Chip>
        </div>
      }
    >
      <div className="label-caps mb-1.5">Panel technology</div>
      <div className="mb-4 grid grid-cols-3 gap-1.5">
        {PANEL_MODELS.map((p) => (
          <button key={p.id} type="button" onClick={() => st.setPanelModel(p.id)} className={`btn !flex-col !items-start !gap-0 !rounded-xl !px-2 !py-1.5 ${panelModel === p.id ? 'btn-on' : ''}`} style={{ '--accent': '#ffc83d' } as React.CSSProperties}>
            <span className="text-[11px] font-black">{p.name.split(' ').slice(0, 2).join(' ')}</span>
            <span className="text-[9px] font-bold opacity-80">{(p.kwm2 * 1000).toFixed(0)} W/m² · {p.efficiency}%</span>
          </button>
        ))}
      </div>
      <div className="label-caps mb-1.5">Roofs</div>
      <div className="flex flex-col gap-2">
        {pv.map((f) => {
          const p = f.properties;
          const cfg = solar[p.osmId] ?? { on: false, fraction: 0, tilt: 18 };
          const now = snap?.perB[p.osmId]?.solarKw ?? 0;
          const sel = selection === p.osmId;
          return (
            <div key={p.osmId} onClick={() => st.select(sel ? null : p.osmId)} className={`cursor-pointer rounded-2xl border-2 px-3 py-2 transition ${sel ? 'border-amber-300/70 bg-amber-300/10' : 'border-white/5 bg-black/20 hover:bg-black/30'}`}>
              <div className="flex items-center gap-2.5">
                <Toggle checked={cfg.on} onChange={(v) => st.setSolar(p.osmId, { on: v })} accent="#ffc83d" label={`Inverters ${p.short}`} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12px] font-extrabold text-white">{p.short}</div>
                  <div className="truncate text-[10px] font-semibold text-slate-400">{(roofKwpOf(p.area_m2, p.pv_fraction, panelModel) * cfg.fraction).toFixed(1)} kWp</div>
                </div>
                <div className="tnum text-[13px] font-black text-amber-300">{fmtKw(now)}</div>
              </div>
              <div className="mt-1.5 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                <span className="w-[74px] shrink-0 text-[9px] font-extrabold uppercase tracking-wide text-slate-400">roof {(cfg.fraction * 100).toFixed(cfg.fraction < 0.1 ? 1 : 0)}%</span>
                <div className="relative flex-1">
                  <Slider min={0} max={0.6} step={0.005} value={cfg.fraction} accent="#ffc83d" onChange={(v) => st.setSolar(p.osmId, { fraction: v, on: v > 0 })} />
                  <span className="pointer-events-none absolute top-[3px] h-[18px] w-[2px] bg-white/70" style={{ left: `${(cov0 / 0.6) * 100}%` }} title="real plant" />
                </div>
                <span className="w-[52px] shrink-0 text-right text-[9px] font-extrabold uppercase text-slate-400">tilt {cfg.tilt}°</span>
                <div className="w-14 shrink-0"><Slider min={5} max={35} value={cfg.tilt} accent="#ffc83d" onChange={(v) => st.setSolar(p.osmId, { tilt: v })} /></div>
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-[10px] font-semibold text-slate-500">White tick = the real plant in the challenge data. Output uses the real campus yield per kWp. Exported surplus earns nothing in the contest, so extra PV only pays when the battery can absorb it.</p>
    </Panel>
  );
}

function roofKwpOf(area: number, pvf: number, panel: Parameters<typeof panelKwm2>[0]): number {
  return area * pvf * panelKwm2(panel);
}

/* ----------------------------------------------------------- BATTERIES ---- */

function BatteryLab() {
  const batteries = useSim((s) => s.batteries);
  const snap = useSim((s) => s.snap);
  const st = useSim.getState();
  const totalPower = batteries.reduce((a, b) => a + b.power, 0);
  const over = totalPower > SUBSTATION_POWER_LIMIT_MW;

  return (
    <Panel title="Battery depot" icon="🔋" subtitle={`${batteries.length} unit(s) · ${snap ? fmtKw(Math.abs(snap.battKw)) : '—'} right now`} right={<span className={`tnum text-[11px] font-black ${over ? 'text-rose-300' : 'text-slate-400'}`}>{totalPower.toFixed(1)}/{SUBSTATION_POWER_LIMIT_MW.toFixed(1)} MW</span>}>
      {over && <div className="mb-2 rounded-xl border-2 border-rose-400/40 bg-rose-400/10 px-3 py-2 text-[11px] font-bold text-rose-200">⚠ Substation transformer limit exceeded.</div>}
      <div className="label-caps mb-1.5">Installed</div>
      <div className="mb-4 flex flex-col gap-2">
        {batteries.length === 0 && <div className="rounded-2xl border-2 border-dashed border-white/15 px-3 py-4 text-center text-[11px] font-bold text-slate-400">Empty yard — pick a battery below. (Without one, the score is 0.)</div>}
        {batteries.map((u) => {
          const m = modelOf(u);
          return (
            <div key={u.id} className="rounded-2xl border-2 border-white/5 bg-black/20 px-3 py-2.5">
              <div className="flex items-center gap-2.5">
                <span className="h-3 w-3 rounded-[4px]" style={{ background: m.accent, boxShadow: `0 0 8px ${m.accent}` }} />
                <div className="flex-1 truncate text-[12px] font-extrabold text-white">{m.name} <span className="font-semibold text-slate-400">· {m.vendor}</span></div>
                <button type="button" onClick={() => st.removeBattery(u.id)} className="text-[12px] font-black text-slate-400 hover:text-rose-300" aria-label="remove">🗑</button>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-0.5">
                  <span className="text-[9px] font-extrabold uppercase tracking-wide text-slate-400">energy {u.capacity.toFixed(2)} MWh</span>
                  <Slider min={m.capacity * 0.2} max={m.capacity} step={m.capacity / 40} value={u.capacity} accent={m.accent} onChange={(v) => st.updateBattery(u.id, { capacity: v })} />
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="text-[9px] font-extrabold uppercase tracking-wide text-slate-400">power {u.power.toFixed(2)} MW</span>
                  <Slider min={m.power * 0.2} max={m.power} step={m.power / 40} value={u.power} accent={m.accent} onChange={(v) => st.updateBattery(u.id, { power: v })} />
                </label>
              </div>
            </div>
          );
        })}
      </div>
      <div className="label-caps mb-1.5">Catalogue — tap to install</div>
      <div className="flex flex-col gap-1.5">
        {BATTERY_MODELS.map((m) => (
          <button key={m.id} type="button" onClick={() => st.installBattery(m.id)} className="btn !justify-start !rounded-2xl !px-3 !py-2 !text-left">
            <span className="h-3 w-3 shrink-0 rounded-[4px]" style={{ background: m.accent }} />
            <div className="min-w-0 flex-1">
              <div className="text-[12px] font-black">{m.name}</div>
              <div className="truncate text-[10px] font-semibold opacity-70">{m.vendor}</div>
            </div>
            <div className="tnum text-right text-[10px] font-bold">
              <div>{m.capacity.toFixed(2)} MWh · {m.power.toFixed(2)} MW</div>
              <div className="opacity-60">RTE {m.rte}% · {(m.priceEur / 1000).toFixed(0)} k€</div>
            </div>
          </button>
        ))}
      </div>
    </Panel>
  );
}

/* -------------------------------------------------------------- IMPACT ---- */

function Impact() {
  const snap = useSim((s) => s.snap);
  const replay = useSim((s) => s.replay)!;
  const weekIdx = useSim((s) => s.weekIdx);
  const version = useSim((s) => s.version);
  void version;
  const d = derived.current;
  if (!snap || !d) return <Panel title="Impact"><div className="text-[12px] text-slate-400">warming up…</div></Panel>;

  const cards = [
    { k: 'none' as const, name: 'No battery', emoji: '🚫', color: '#8da0d8' },
    { k: 'template' as const, name: 'Template rules', emoji: '📏', color: '#ffb627' },
    { k: 'mpc' as const, name: '24 h MPC (ours)', emoji: '🧠', color: '#a6e05a' },
  ];
  const best = Math.max(0.01, ...cards.map((c) => d.summary[c.k].score));
  const m = d.summary.mpc;
  const maxWeek = Math.max(...replay.map((w) => w.mpc.score));

  return (
    <Panel title="Impact report" icon="🏆" subtitle="Challenge metric · same formulas as sim/ and the leaderboard">
      <div className="label-caps mb-1.5">This week · whole-week score</div>
      <div className="flex flex-col gap-2">
        {cards.map((c) => {
          const s = d.summary[c.k];
          const stars = s.score >= 6 ? 3 : s.score >= 3 ? 2 : s.score > 0.4 ? 1 : 0;
          return (
            <div key={c.k} className="rounded-2xl border-2 bg-black/20 px-3 py-2" style={{ borderColor: `${c.color}55` }}>
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-black text-white">{c.emoji} {c.name}</span>
                <span className="flex items-center gap-2"><Stars n={stars} size={13} /><span className="tnum font-display text-[18px]" style={{ color: c.color }}>{s.score.toFixed(2)}</span></span>
              </div>
              <div className="my-1.5"><Bar v={s.score / best} accent={c.color} h={9} /></div>
              <div className="tnum flex justify-between text-[10px] font-bold text-slate-400">
                <span>ΔCO₂ {s.dCo2Pct.toFixed(2)}%</span>
                <span>ΔCost {s.dCostPct.toFixed(2)}%</span>
                <span>{fmtEur(s.costSavedEur)} · {s.co2SavedKg.toFixed(0)} kg</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="panel-flat mt-3 p-3">
        <div className="label-caps mb-1">How the score is computed</div>
        <div className="font-display text-[13px] text-cyan-200">score = 0.7·ΔCO₂% + 0.3·ΔCost% − penalty·infractions</div>
        <p className="mt-1 text-[10.5px] font-semibold leading-snug text-slate-400">
          Each Δ is the saving vs. the same campus with no battery, counting grid <i>imports</i> only (exports pay nothing and earn no CO₂ credit).
          This week: 0.7 × {m.dCo2Pct.toFixed(2)} + 0.3 × {m.dCostPct.toFixed(2)} − 0 infractions ({m.violations}) = <b className="text-white">{m.score.toFixed(2)}</b>.
        </p>
      </div>

      <div className="mt-3">
        <div className="label-caps mb-1.5">All 35 real weeks · MPC vs template (Python reference)</div>
        <div className="flex h-20 items-end gap-[2px]">
          {replay.map((w, i) => (
            <button key={w.start} type="button" onClick={() => useSim.getState().setWeek(i)} title={`${w.start.slice(0, 10)}: ${w.mpc.score.toFixed(2)} vs ${w.template.score.toFixed(2)}`} className="relative flex h-full flex-1 flex-col justify-end">
              <div className="rounded-t-[2px] bg-[#a6e05a]" style={{ height: `${(w.mpc.score / maxWeek) * 100}%`, outline: i === weekIdx ? '2px solid #fff' : 'none' }} />
              <div className="absolute bottom-0 inset-x-0 rounded-t-[2px] bg-[#ffb627]" style={{ height: `${(w.template.score / maxWeek) * 100}%` }} />
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[10px] font-semibold text-slate-500">Mean {(replay.reduce((a, w) => a + w.mpc.score, 0) / replay.length).toFixed(2)} (MPC) vs {(replay.reduce((a, w) => a + w.template.score, 0) / replay.length).toFixed(2)} (template). Click a bar to replay that week.</p>
      </div>
    </Panel>
  );
}
