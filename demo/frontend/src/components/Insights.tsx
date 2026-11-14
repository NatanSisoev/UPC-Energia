import { useEffect, useMemo, useState } from 'react';
import { Area, Bar, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from 'recharts';
import { create } from 'zustand';
import { useSim } from '../store/useSim';
import { CHALLENGE_SPEC, simulateWeek } from '../sim/challenge';
import { actionByHour, buildProfiles, horizonSweep, sizeSweep, toInput, weightSweep, type ActionByHour, type SweepPoint } from '../sim/insights';
import { Slider } from './ui';

/** Data-insights view: real figures from replay.json plus re-runs of the challenge-exact agent. */

export type InsightTab = 'prices' | 'solar' | 'agent' | 'horizon' | 'whatif';
export const INSIGHT_TABS: Array<{ id: InsightTab; label: string; icon: string }> = [
  { id: 'prices', label: 'Price & CO₂', icon: '💶' },
  { id: 'solar', label: 'Solar & demand', icon: '☀️' },
  { id: 'agent', label: 'What the agent does', icon: '🧠' },
  { id: 'horizon', label: 'Why 24 h', icon: '🔭' },
  { id: 'whatif', label: 'What-if', icon: '🎛️' },
];

export const useInsightsUi = create<{ tab: InsightTab; setTab: (t: InsightTab) => void }>((set) => ({ tab: 'prices', setTab: (tab) => set({ tab }) }));

const tick = { fill: '#8da0d8', fontSize: 10, fontWeight: 700 };
const hod = (h: number) => `${String(h).padStart(2, '0')}h`;
const argmax = (a: number[]) => a.reduce((b, v, i) => (v > a[b] ? i : b), 0);
const argmin = (a: number[]) => a.reduce((b, v, i) => (v < a[b] ? i : b), 0);
const topK = (a: number[], k: number) =>
  a
    .map((v, i) => [v, i] as const)
    .sort((x, y) => y[0] - x[0])
    .slice(0, k)
    .map((x) => x[1])
    .sort((x, y) => x - y);
const hours = (hs: number[]) => hs.map((h) => `${h}h`).join(', ');

function Card({ title, sub, children, className = '' }: { title: string; sub?: string; children: React.ReactElement; className?: string }) {
  return (
    <div className={`panel-flat flex min-h-0 flex-col p-2.5 ${className}`}>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <div className="text-[12px] font-black text-white">{title}</div>
        {sub && <div className="truncate text-[10px] font-bold text-slate-400">{sub}</div>}
      </div>
      <div className="min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function Takeaway({ children }: { children: React.ReactNode }) {
  return (
    <div className="panel-flat flex items-start gap-2.5 border-[#a6e05a55] px-3 py-2 text-[12px] font-bold leading-snug text-slate-200">
      <span className="text-lg">💡</span>
      <div>{children}</div>
    </div>
  );
}

const B = ({ children }: { children: React.ReactNode }) => <b className="text-white">{children}</b>;

export default function Insights() {
  const replay = useSim((s) => s.replay);
  const tab = useInsightsUi((s) => s.tab);
  const setTab = useInsightsUi((s) => s.setTab);
  const prof = useMemo(() => (replay ? buildProfiles(replay) : null), [replay]);
  if (!replay || !prof) return null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex shrink-0 items-center gap-1.5">
        <span className="panel-title mr-2 text-white">📊 What the data says</span>
        {INSIGHT_TABS.map((t) => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)} className={`btn !rounded-xl !px-2.5 !py-1.5 !text-[12px] ${tab === t.id ? 'btn-on' : ''}`} style={{ '--accent': '#a6e05a' } as React.CSSProperties}>
            <span>{t.icon}</span> {t.label}
          </button>
        ))}
        <span className="ml-auto hidden text-[10px] font-bold text-slate-400 xl:block">35 real weeks · {Math.round(replay.length * 168)} hourly rows · UPC Campus Nord telemetry</span>
      </div>
      <div className="min-h-0 flex-1">
        {tab === 'prices' && <PricesTab prof={prof} />}
        {tab === 'solar' && <SolarTab prof={prof} />}
        {tab === 'agent' && <AgentTab />}
        {tab === 'horizon' && <HorizonTab />}
        {tab === 'whatif' && <WhatIfTab />}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ tabs --- */

type Prof = ReturnType<typeof buildProfiles>;

function PricesTab({ prof }: { prof: Prof }) {
  const rows = prof.hours.map((h) => ({
    h,
    price: prof.price.mean[h],
    pband: [prof.price.p10[h], prof.price.p90[h]],
    co2: prof.co2.mean[h],
    cband: [prof.co2.p10[h], prof.co2.p90[h]],
  }));
  const pHi = argmax(prof.price.mean);
  const pLo = argmin(prof.price.mean);
  const cHi = argmax(prof.co2.mean);
  const cLo = argmin(prof.co2.mean);
  const spread = prof.price.mean[pHi] / prof.price.mean[pLo];
  return (
    <div className="grid h-full min-h-0 grid-cols-2 grid-rows-[1fr_auto] gap-2">
      <Card title="💶 Electricity price by hour of day" sub="mean · band = 10–90 % of days · €/kWh">
        <ComposedChart data={rows} margin={{ top: 6, right: 8, left: -10, bottom: 0 }}>
          <CartesianGrid stroke="#ffffff12" vertical={false} />
          <XAxis dataKey="h" tick={tick} tickFormatter={hod} interval={2} axisLine={false} tickLine={false} />
          <YAxis tick={tick} axisLine={false} tickLine={false} domain={[0, 'auto']} />
          <Tooltip formatter={(v) => (Array.isArray(v) ? `${Number(v[0]).toFixed(3)} – ${Number(v[1]).toFixed(3)}` : Number(v).toFixed(3))} labelFormatter={(h) => hod(Number(h))} />
          <Area dataKey="pband" name="10–90 %" stroke="none" fill="#6fd3ff33" />
          <Line dataKey="price" name="Mean price" stroke="#6fd3ff" strokeWidth={3} dot={false} />
        </ComposedChart>
      </Card>
      <Card title="🌍 Grid CO₂ intensity by hour of day" sub="mean · band = 10–90 % of days · kg/kWh">
        <ComposedChart data={rows} margin={{ top: 6, right: 8, left: -10, bottom: 0 }}>
          <CartesianGrid stroke="#ffffff12" vertical={false} />
          <XAxis dataKey="h" tick={tick} tickFormatter={hod} interval={2} axisLine={false} tickLine={false} />
          <YAxis tick={tick} axisLine={false} tickLine={false} domain={[0, 'auto']} />
          <Tooltip formatter={(v) => (Array.isArray(v) ? `${Number(v[0]).toFixed(3)} – ${Number(v[1]).toFixed(3)}` : Number(v).toFixed(3))} labelFormatter={(h) => hod(Number(h))} />
          <Area dataKey="cband" name="10–90 %" stroke="none" fill="#7dffb033" />
          <Line dataKey="co2" name="Mean CO₂" stroke="#7dffb0" strokeWidth={3} dot={false} />
        </ComposedChart>
      </Card>
      <div className="col-span-2">
        <Takeaway>
          Price is highest around <B>{pHi}h</B> and lowest around <B>{pLo}h</B> (a <B>×{spread.toFixed(1)}</B> swing); CO₂ peaks at <B>{cHi}h</B> and bottoms out at <B>{cLo}h</B>. The two signals do not move together, so the battery has two
          prizes to chase: any daily swing above the <B>≈11 %</B> round-trip loss (η² = 0.9) is profit.
        </Takeaway>
      </div>
    </div>
  );
}

function SolarTab({ prof }: { prof: Prof }) {
  const rows = prof.hours.map((h) => ({ h, winter: prof.pv.winter[h], spring: prof.pv.spring[h], summer: prof.pv.summer[h], autumn: prof.pv.autumn[h], wd: prof.load.weekday[h], sa: prof.load.saturday[h], su: prof.load.sunday[h] }));
  const dow = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d, i) => ({ d, mwh: prof.weekdayMwh[i] }));
  const t = prof.totals;
  return (
    <div className="grid h-full min-h-0 grid-cols-3 grid-rows-[1fr_auto] gap-2">
      <Card title="☀️ Solar output by hour (kW)" sub="campus PV plant · by season">
        <ComposedChart data={rows} margin={{ top: 6, right: 8, left: -10, bottom: 0 }}>
          <CartesianGrid stroke="#ffffff12" vertical={false} />
          <XAxis dataKey="h" tick={tick} tickFormatter={hod} interval={3} axisLine={false} tickLine={false} />
          <YAxis tick={tick} axisLine={false} tickLine={false} />
          <Tooltip formatter={(v) => `${Number(v).toFixed(0)} kW`} labelFormatter={(h) => hod(Number(h))} />
          <Legend wrapperStyle={{ fontSize: 10, fontWeight: 700 }} />
          <Line dataKey="winter" name="Winter" stroke="#8fb2ff" strokeWidth={2} dot={false} />
          <Line dataKey="spring" name="Spring" stroke="#a6e05a" strokeWidth={2} dot={false} />
          <Line dataKey="summer" name="Summer" stroke="#ffc83d" strokeWidth={2.4} dot={false} />
          <Line dataKey="autumn" name="Autumn" stroke="#ff9f5c" strokeWidth={2} dot={false} />
        </ComposedChart>
      </Card>
      <Card title="⚡ Campus demand by hour (kW)" sub="weekday vs weekend">
        <ComposedChart data={rows} margin={{ top: 6, right: 8, left: -10, bottom: 0 }}>
          <CartesianGrid stroke="#ffffff12" vertical={false} />
          <XAxis dataKey="h" tick={tick} tickFormatter={hod} interval={3} axisLine={false} tickLine={false} />
          <YAxis tick={tick} axisLine={false} tickLine={false} domain={[0, 'auto']} />
          <Tooltip formatter={(v) => `${Number(v).toFixed(0)} kW`} labelFormatter={(h) => hod(Number(h))} />
          <Legend wrapperStyle={{ fontSize: 10, fontWeight: 700 }} />
          <Line dataKey="wd" name="Mon–Fri" stroke="#ff6b8a" strokeWidth={2.6} dot={false} />
          <Line dataKey="sa" name="Saturday" stroke="#ab8cff" strokeWidth={2} dot={false} />
          <Line dataKey="su" name="Sunday" stroke="#5cc8ff" strokeWidth={2} dot={false} />
        </ComposedChart>
      </Card>
      <Card title="📅 Energy per day (MWh)" sub="mean by weekday">
        <ComposedChart data={dow} margin={{ top: 6, right: 8, left: -10, bottom: 0 }}>
          <CartesianGrid stroke="#ffffff12" vertical={false} />
          <XAxis dataKey="d" tick={tick} axisLine={false} tickLine={false} />
          <YAxis tick={tick} axisLine={false} tickLine={false} />
          <Tooltip formatter={(v) => `${Number(v).toFixed(1)} MWh`} />
          <Bar dataKey="mwh" name="MWh/day" fill="#ff6b8a" radius={[6, 6, 0, 0]} />
        </ComposedChart>
      </Card>
      <div className="col-span-3">
        <Takeaway>
          Solar peaks at only <B>{t.peakPvKw.toFixed(0)} kW</B> against a campus that draws <B>{(t.meanLoadKw / 1000).toFixed(2)} MW</B> on average (peak {(t.peakLoadKw / 1000).toFixed(2)} MW): PV covers just <B>{((100 * t.pvMwh) / t.loadMwh).toFixed(1)} %</B> of the energy and
          exceeds demand in <B>{t.surplusHoursPct.toFixed(1)} %</B> of hours. There is no solar surplus to store — the battery must arbitrage the <i>grid</i>: charge when it is cheap and clean, discharge when it is not.
        </Takeaway>
      </div>
    </div>
  );
}

function useAsync<T>(make: (cb: (d: number, t: number) => void) => Promise<T>, deps: unknown[]) {
  const [val, setVal] = useState<T | null>(null);
  const [prog, setProg] = useState(0);
  useEffect(() => {
    let alive = true;
    make((d, t) => alive && setProg(d / t)).then((v) => alive && setVal(v));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { val, prog };
}

function Loading({ prog, what }: { prog: number; what: string }) {
  return (
    <div className="panel-flat flex h-full flex-col items-center justify-center gap-2 text-[12px] font-extrabold text-slate-300">
      Running the real agent on {what}…
      <div className="h-2 w-56 overflow-hidden rounded-full bg-[#131b3a]">
        <div className="h-full rounded-full bg-[#a6e05a] transition-all" style={{ width: `${Math.round(prog * 100)}%` }} />
      </div>
    </div>
  );
}

function AgentTab() {
  const replay = useSim((s) => s.replay)!;
  const { val, prog } = useAsync<ActionByHour>((cb) => actionByHour(replay, cb), [replay]);
  if (!val) return <Loading prog={prog} what="all 35 weeks" />;
  const prof = buildProfiles(replay);
  const rows = prof.hours.map((h) => ({ h, mpc: val.mpc.sp[h], tpl: val.template.sp[h], soc: val.mpc.soc[h], price: prof.price.mean[h] }));
  /** % of hours in which the battery charges or discharges */
  const act = (s: ActionByHour['mpc']) => s.charge.reduce((a, v, i) => a + v + s.discharge[i], 0) / 24;
  const chg = topK(val.mpc.charge, 4);
  const dis = topK(val.mpc.discharge, 4);
  return (
    <div className="grid h-full min-h-0 grid-cols-2 grid-rows-[1fr_auto] gap-2">
      <Card title="🔋 Average battery action by hour (kW, + = charging)" sub="all 35 weeks · real agent vs organisers' rules">
        <ComposedChart data={rows} margin={{ top: 6, right: 8, left: -10, bottom: 0 }}>
          <CartesianGrid stroke="#ffffff12" vertical={false} />
          <XAxis dataKey="h" tick={tick} tickFormatter={hod} interval={2} axisLine={false} tickLine={false} />
          <YAxis tick={tick} axisLine={false} tickLine={false} />
          <ReferenceLine y={0} stroke="#ffffff55" />
          <Tooltip formatter={(v) => `${Number(v).toFixed(0)} kW`} labelFormatter={(h) => hod(Number(h))} />
          <Legend wrapperStyle={{ fontSize: 10, fontWeight: 700 }} />
          <Bar dataKey="mpc" name="24 h MPC (ours)" fill="#a6e05a" radius={[4, 4, 0, 0]} />
          <Line dataKey="tpl" name="Template rules" stroke="#ffb627" strokeWidth={2.4} dot={false} />
        </ComposedChart>
      </Card>
      <Card title="🔌 Charge level and price through the day" sub="mean SOC % (left) · mean price €/kWh (right)">
        <ComposedChart data={rows} margin={{ top: 6, right: 8, left: -10, bottom: 0 }}>
          <CartesianGrid stroke="#ffffff12" vertical={false} />
          <XAxis dataKey="h" tick={tick} tickFormatter={hod} interval={2} axisLine={false} tickLine={false} />
          <YAxis yAxisId="a" tick={tick} axisLine={false} tickLine={false} domain={[0, 100]} />
          <YAxis yAxisId="b" orientation="right" tick={tick} axisLine={false} tickLine={false} />
          <Tooltip labelFormatter={(h) => hod(Number(h))} formatter={(v, n) => (n === 'Price' ? Number(v).toFixed(3) : `${Number(v).toFixed(0)} %`)} />
          <Legend wrapperStyle={{ fontSize: 10, fontWeight: 700 }} />
          <Area yAxisId="a" dataKey="soc" name="Charge level" stroke="#ab8cff" fill="#ab8cff30" strokeWidth={2.4} dot={false} />
          <Line yAxisId="b" dataKey="price" name="Price" stroke="#6fd3ff" strokeWidth={2} dot={false} />
        </ComposedChart>
      </Card>
      <div className="col-span-2">
        <Takeaway>
          The agent has no fixed schedule: it re-plans every hour with a 24 h optimisation on <i>price × CO₂</i> and ends up charging mostly at <B>{hours(chg)}</B> and discharging mostly at <B>{hours(dis)}</B>. It acts in{' '}
          <B>{(act(val.mpc)).toFixed(0)} %</B> of all hours; the template, with its three fixed clock windows, acts in only <B>{(act(val.template)).toFixed(0)} %</B>.
        </Takeaway>
      </div>
    </div>
  );
}

function HorizonTab() {
  const replay = useSim((s) => s.replay)!;
  const { val, prog } = useAsync<SweepPoint[]>((cb) => horizonSweep(replay, cb), [replay]);
  if (!val) return <Loading prog={prog} what="7 weeks × 6 look-ahead lengths" />;
  const at = (h: number) => val.find((p) => p.x === h)!;
  const s24 = at(24).score;
  const rows = val.map((p) => ({ h: p.x, score: p.score, pct: (100 * p.score) / s24 }));
  return (
    <div className="grid h-full min-h-0 grid-cols-[3fr_2fr] grid-rows-[1fr_auto] gap-2">
      <Card title="🔭 Score vs hours of look-ahead" sub="real agent, 7 weeks spread over the year">
        <ComposedChart data={rows} margin={{ top: 10, right: 14, left: -6, bottom: 0 }}>
          <CartesianGrid stroke="#ffffff12" vertical={false} />
          <XAxis dataKey="h" type="number" scale="log" domain={[1, 48]} ticks={[1, 3, 6, 12, 24, 48]} tick={tick} tickFormatter={(h) => `${h} h`} axisLine={false} tickLine={false} />
          <YAxis tick={tick} axisLine={false} tickLine={false} domain={[0, 'auto']} />
          <Tooltip formatter={(v) => Number(v).toFixed(2)} labelFormatter={(h) => `${h} h look-ahead`} />
          <ReferenceLine x={24} stroke="#a6e05a" strokeDasharray="4 3" label={{ value: 'challenge gives 24 h', fill: '#a6e05a', fontSize: 10, position: 'insideTopLeft' }} />
          <Line dataKey="score" name="Mean score" stroke="#a6e05a" strokeWidth={3} dot={{ r: 4, fill: '#a6e05a' }} />
        </ComposedChart>
      </Card>
      <div className="panel-flat flex flex-col justify-center gap-2 p-3">
        {rows.map((r) => (
          <div key={r.h} className="flex items-center gap-2">
            <span className="tnum w-10 text-[12px] font-black text-slate-300">{r.h} h</span>
            <div className="h-3 flex-1 overflow-hidden rounded-full bg-[#131b3a]">
              <div className="h-full rounded-full" style={{ width: `${Math.min(100, r.pct)}%`, background: r.h === 24 ? '#a6e05a' : '#6f86d6' }} />
            </div>
            <span className="tnum w-24 text-right text-[11px] font-black text-white">{r.score.toFixed(2)} · {r.pct.toFixed(0)} %</span>
          </div>
        ))}
        <p className="mt-1 text-[10px] font-semibold text-slate-400">48 h is hypothetical: the challenge only publishes the next 24 h of price and CO₂.</p>
      </div>
      <div className="col-span-2">
        <Takeaway>
          With <B>6 h</B> of look-ahead the agent already reaches <B>{Math.round((100 * at(6).score) / s24)} %</B> of the 24 h score, with <B>12 h</B> <B>{((100 * at(12).score) / s24).toFixed(1)} %</B>; going on to <B>48 h</B> changes the score by{' '}
          <B>{(at(48).score - s24 >= 0 ? '+' : '') + (at(48).score - s24).toFixed(2)}</B>. A 2 MWh / 0.5 MW battery empties or fills within about 8 h, so a day of foresight is plenty — the challenge's 24 h window is not the bottleneck.
        </Takeaway>
      </div>
    </div>
  );
}

function WhatIfTab() {
  const replay = useSim((s) => s.replay)!;
  const weekIdx = useSim((s) => s.weekIdx);
  const [co2Share, setCo2Share] = useState(0.7);
  const live = useMemo(() => {
    const w = replay[weekIdx];
    const r = simulateWeek(toInput(w), CHALLENGE_SPEC, 'mpc', { alphaCo2: co2Share, betaCost: 1 - co2Share });
    return r.metrics;
  }, [replay, weekIdx, co2Share]);
  const w = useAsync<SweepPoint[]>((cb) => weightSweep(replay, cb), [replay]);
  const s = useAsync<SweepPoint[]>((cb) => sizeSweep(replay, cb), [replay]);
  const wrows = (w.val ?? []).map((p) => ({ share: Math.round(p.x * 100), score: p.score, dCo2: p.dCo2, dCost: p.dCost }));
  const srows = (s.val ?? []).map((p) => ({ mwh: (CHALLENGE_SPEC.capacityKwh * p.x) / 1000, score: p.score, dCo2: p.dCo2, dCost: p.dCost }));
  const best = wrows.reduce((b, r) => (r.score > b.score ? r : b), { share: 0, score: -1, dCo2: 0, dCost: 0 });
  const at = (mwh: number) => srows.find((r) => r.mwh === mwh)?.score ?? 0;
  const sizeNote = srows.length
    ? `2 → 4 MWh lifts the mean score from ${at(2).toFixed(2)} to ${at(4).toFixed(2)} (×${(at(4) / Math.max(at(2), 1e-9)).toFixed(1)}), 4 → 8 MWh to ${at(8).toFixed(2)} (×${(at(8) / Math.max(at(4), 1e-9)).toFixed(1)}): more storage pays, with diminishing returns.`
    : 'computing…';
  return (
    <div className="grid h-full min-h-0 grid-cols-[1.1fr_1.4fr_1.4fr] grid-rows-[1fr_auto] gap-2">
      <div className="panel-flat flex flex-col gap-2 p-3">
        <div className="text-[12px] font-black text-white">🎛️ Optimiser weight: CO₂ vs cost</div>
        <p className="text-[10.5px] font-semibold leading-snug text-slate-400">
          The agent minimises <i>share × CO₂ + (1 − share) × cost</i> over the next 24 h. The challenge scores <b className="text-white">70 / 30</b>. Drag to re-run the real agent on the week you are replaying.
        </p>
        <div className="flex justify-between text-[11px] font-extrabold text-slate-300">
          <span>CO₂ {Math.round(co2Share * 100)} %</span>
          <span>Cost {Math.round((1 - co2Share) * 100)} %</span>
        </div>
        <Slider min={0} max={1} step={0.05} value={co2Share} accent="#a6e05a" onChange={setCo2Share} />
        <div className="grid grid-cols-3 gap-1.5 text-center">
          {[
            ['ΔCO₂', `${live.dCo2Pct.toFixed(2)} %`, '#7dffb0'],
            ['ΔCost', `${live.dCostPct.toFixed(2)} %`, '#6fd3ff'],
            ['Score', live.score.toFixed(2), '#ffc83d'],
          ].map(([l, v, c]) => (
            <div key={l} className="panel-flat px-1 py-1.5">
              <div className="label-caps !text-[9px]">{l}</div>
              <div className="tnum text-[15px] font-black" style={{ color: c }}>{v}</div>
            </div>
          ))}
        </div>
        <p className="text-[10px] font-semibold text-slate-500">Week of {replay[weekIdx].start.slice(0, 10)} · violations {live.violations}</p>
      </div>
      {w.val ? (
        <Card title="⚖️ Trade-off across weights" sub="mean of 7 weeks · score uses the challenge 70/30">
          <ComposedChart data={wrows} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
            <CartesianGrid stroke="#ffffff12" vertical={false} />
            <XAxis dataKey="share" tick={tick} tickFormatter={(v) => `${v}%`} axisLine={false} tickLine={false} label={{ value: 'CO₂ share in the optimiser', fill: '#8da0d8', fontSize: 10, position: 'insideBottom', offset: -2 }} />
            <YAxis tick={tick} axisLine={false} tickLine={false} />
            <Tooltip formatter={(v) => `${Number(v).toFixed(2)}`} labelFormatter={(v) => `CO₂ share ${v} %`} />
            <Legend wrapperStyle={{ fontSize: 10, fontWeight: 700 }} verticalAlign="top" />
            <ReferenceLine x={70} stroke="#ffffff55" strokeDasharray="3 3" />
            <Line dataKey="dCo2" name="ΔCO₂ %" stroke="#7dffb0" strokeWidth={2.2} dot />
            <Line dataKey="dCost" name="ΔCost %" stroke="#6fd3ff" strokeWidth={2.2} dot />
            <Line dataKey="score" name="Challenge score" stroke="#ffc83d" strokeWidth={3} dot />
          </ComposedChart>
        </Card>
      ) : (
        <Loading prog={w.prog} what="weight sweep" />
      )}
      {s.val ? (
        <Card title="🔋 Bigger battery?" sub="score vs installed MWh (power = 0.25 C)">
          <ComposedChart data={srows} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
            <CartesianGrid stroke="#ffffff12" vertical={false} />
            <XAxis dataKey="mwh" tick={tick} tickFormatter={(v) => `${v} MWh`} axisLine={false} tickLine={false} />
            <YAxis tick={tick} axisLine={false} tickLine={false} domain={[0, 'auto']} />
            <Tooltip formatter={(v) => Number(v).toFixed(2)} labelFormatter={(v) => `${v} MWh`} />
            <ReferenceLine x={2} stroke="#a6e05a" strokeDasharray="3 3" label={{ value: 'challenge: 2 MWh', fill: '#a6e05a', fontSize: 10, position: 'insideTopLeft' }} />
            <Line dataKey="score" name="Mean score" stroke="#ffc83d" strokeWidth={3} dot={{ r: 4 }} />
            <Scatter dataKey="score" fill="#ffc83d" />
          </ComposedChart>
        </Card>
      ) : (
        <Loading prog={s.prog} what="battery-size sweep" />
      )}
      <div className="col-span-3">
        <Takeaway>
          The score is best when the optimiser's own weight matches the 70/30 scoring (here <B>{best.share} % CO₂</B>, score {best.score.toFixed(2)}); optimising one signal alone gives up the other. The size curve shows the battery, not the algorithm, is the
          limit: {sizeNote}
        </Takeaway>
      </div>
    </div>
  );
}
