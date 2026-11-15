/**
 * Knowledge base of the campus assistant.
 *
 * `gather(h)` collects EVERYTHING the app knows about hour `h` of the loaded week from the live store and the
 * derived simulation (`derived.current`): buildings, solar per roof, irradiance, battery fleet, grid, prices, CO2,
 * the agent's decisions and reasons, alarms / faults + playbook, simulated changes, forecast, catalogue and
 * payback. Nothing is hard-coded: every figure in an answer comes from here, so it always matches the map.
 *
 * The answer functions at the bottom (`explainFault`, `whyBattery`, `whatIf`, ...) turn those facts into text;
 * `answerKnowledge` is the intent/entity router used by `lib/assistant.ts#ask` before its older fallbacks.
 */
import { derived, useSim, workingBatteries, effectiveBatteries } from '../store/useSim';
import { computeAlarms, KIND_LABEL, type Alarm } from './alarms';
import { fmtKw, fmtEur } from './format';
import { FAULT_PLAYBOOK, type FaultType } from '../data/faultPlaybook';
import { activeFaults, useFaultAlerts, simClock, type Incident } from '../live/faultAlertStore';
import { BATTERY_MODELS, PANEL_MODELS, SUBSTATION_POWER_LIMIT_MW } from '../data/catalogue';
import { cachedEconomics, computeEconomics, CO2_EUR_PER_KG, LIFETIME_YEARS, paybackYearsOf, WEEKS_PER_YEAR } from './payback';
import { installedKwp, asBuiltCoverage, DEFAULT_TILT, modelOf, fleetSpec, tiltFactor, PV_ASBUILT_KWP } from '../sim/engine';
import { simulateWeek, type WeekInput } from '../sim/challenge';
import { pvHealth, pvYear } from '../data/assets';

export interface KAnswer {
  text: string;
  goTo?: number;
}

const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const p2 = (n: number) => String(n).padStart(2, '0');
const DAYMS = 86_400_000;
const ETA = Math.sqrt(0.9);

export const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[·']/g, ' ');
const has = (q: string, ...words: string[]) => words.some((w) => new RegExp(`(^|[^a-z])${w}`).test(q));

/** "Tue 14 Apr 13:00" for hour index h of the loaded week. */
export function hourLabel(h: number): string {
  const d = derived.current;
  if (!d) return '';
  const t = new Date(d.week.ms[Math.max(0, Math.min(d.week.ms.length - 1, h))]);
  return `${DOW[t.getUTCDay()].slice(0, 3)} ${t.getUTCDate()} ${MON[t.getUTCMonth()]} ${p2(t.getUTCHours())}:00`;
}

const mwh = (kwh: number) => (Math.abs(kwh) >= 1000 ? `${(kwh / 1000).toFixed(1)} MWh` : `${kwh.toFixed(0)} kWh`);
const pct = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(0)}%`;
const eur3 = (v: number) => `${v.toFixed(3)} €/kWh`;
const sumOf = (a: ArrayLike<number>, from = 0, to = a.length) => {
  let t = 0;
  for (let i = from; i < to; i++) t += a[i];
  return t;
};

/* ------------------------------------------------------------- gather ---- */

export function gather(hOverride?: number) {
  const d = derived.current;
  const s = useSim.getState();
  if (!d || !s.snap || !s.campus || !s.replay) return null;
  const snap = s.snap;
  const n = d.week.load.length;
  const h = Math.max(0, Math.min(n - 1, hOverride ?? snap.hour));
  const isNow = h === snap.hour;
  const r = d.chosen;
  const hasBatt = r !== d.sims.none;
  const w = d.week;
  const hod = (i: number) => new Date(w.ms[i]).getUTCHours();
  const dow = (i: number) => new Date(w.ms[i]).getUTCDay();
  const yieldNow = w.pv[h] / PV_ASBUILT_KWP;
  const yieldWeek = sumOf(w.pv) / PV_ASBUILT_KWP;
  const loadNow = w.load[h];

  const buildings = s.campus.features.map((f, bi) => {
    const p = f.properties;
    let weekKwh = 0;
    let peakKw = 0;
    let peakH = 0;
    let offKwh = 0;
    for (let k = 0; k < n; k++) {
      const v = d.shares[bi * 168 + k] * w.load[k];
      weekKwh += v;
      if (v > peakKw) {
        peakKw = v;
        peakH = k;
      }
      if (hod(k) < 6 || hod(k) >= 22 || dow(k) === 0 || dow(k) === 6) offKwh += v;
    }
    const cfg = s.solar[p.osmId] ?? { on: false, fraction: 0, tilt: DEFAULT_TILT };
    const faulted = s.faults.roofs.includes(p.osmId);
    const factor = s.ageing ? pvHealth(pvYear(p)) : 1;
    const potKwp = installedKwp(p, cfg, s.panelModel);
    const kwp = faulted ? 0 : potKwp;
    const k = tiltFactor(cfg.tilt) * factor;
    return {
      id: p.osmId,
      short: p.short,
      name: p.name,
      category: p.category,
      school: p.school,
      areaM2: p.area_m2,
      loadKw: d.shares[bi * 168 + h] * loadNow,
      weekKwh,
      peakKw,
      peakH,
      offKwh,
      kwp,
      potKwp,
      faulted,
      solarKw: kwp * k * yieldNow,
      solarWeekKwh: kwp * k * yieldWeek,
      lostKw: faulted ? potKwp * k * yieldNow : 0,
      lostWeekKwh: faulted ? potKwp * k * yieldWeek : 0,
      tilt: cfg.tilt,
    };
  });
  const byLoad = [...buildings].sort((a, b) => b.loadKw - a.loadKw);

  const units = s.batteries.map((u) => ({ id: u.id, name: modelOf(u).name, mwh: u.capacity, mw: u.power, asBuilt: !!u.asBuilt, faulted: s.faults.batteries.includes(u.id), year: u.year }));
  const cap = workingBatteries(s).reduce((a, b) => a + b.capacity * 1000, 0);
  const spec = fleetSpec(effectiveBatteries(s));
  const battery = {
    units,
    totalMwh: units.reduce((a, u) => a + u.mwh, 0),
    totalMw: units.reduce((a, u) => a + u.mw, 0),
    workingMwh: cap / 1000,
    ratedKw: spec?.powerKw ?? 0,
    soc: hasBatt && cap > 0 ? (isNow ? snap.soc : r.socStart[h] / cap) : 0,
    socEnd: hasBatt && cap > 0 ? r.socEnd[h] / cap : 0,
    socKwh: hasBatt ? (isNow ? snap.soc * cap : r.socStart[h]) : 0,
    kw: r.sp[h],
    chargedKwh: hasBatt ? sumOf(Array.from(r.sp).map((v) => Math.max(0, v))) : 0,
    dischargedKwh: hasBatt ? sumOf(Array.from(r.sp).map((v) => Math.max(0, -v))) : 0,
    yardLimitMw: SUBSTATION_POWER_LIMIT_MW,
    hasBatt,
  };

  const gridImport = Array.from(r.grid).map((v) => Math.max(0, v));
  const baseImport = Array.from(r.baseGrid).map((v) => Math.max(0, v));
  let peakGridH = 0;
  for (let k = 0; k < n; k++) if (gridImport[k] > gridImport[peakGridH]) peakGridH = k;
  const grid = {
    kw: r.grid[h],
    baseKw: r.baseGrid[h],
    weekKwh: sumOf(gridImport),
    baseWeekKwh: sumOf(baseImport),
    peakKw: gridImport[peakGridH],
    peakH: peakGridH,
    exportHours: Array.from(r.grid).filter((v) => v < -1).length,
  };

  const alarms = computeAlarms();
  const m = d.chosen.metrics;
  const mpc = d.summary.mpc;
  const tpl = d.summary.template;
  const reps = s.replay;

  return {
    d, s, snap, n, h, isNow, w, r,
    nowH: d.nowH,
    forecastHour: d.nowH != null && h >= d.nowH,
    when: hourLabel(h),
    load: { kw: loadNow, weekKwh: sumOf(w.load), peakKw: Math.max(...w.load), peakH: w.load.indexOf(Math.max(...w.load)) },
    solar: {
      kw: d.pvTot[h],
      weekKwh: sumOf(d.pvTot),
      peakKw: Math.max(...Array.from(d.pvTot)),
      irr: w.irr[h],
      tempC: w.temp[h],
      cloud: isNow ? snap.cloud : null,
      installedKwp: buildings.reduce((a, b) => a + b.kwp, 0),
      faultedKwp: buildings.reduce((a, b) => a + (b.faulted ? b.potKwp : 0), 0),
    },
    price: { now: w.price[h], min: Math.min(...w.price), max: Math.max(...w.price), mean: sumOf(w.price) / n },
    co2: { now: w.co2[h], min: Math.min(...w.co2), max: Math.max(...w.co2), mean: sumOf(w.co2) / n },
    buildings, byLoad, battery, grid, alarms,
    totals: {
      costEur: m.costAgent, baseCostEur: m.costBase, co2Kg: m.co2Agent, baseCo2Kg: m.co2Base,
      score: m.score, dCo2Pct: m.dCo2Pct, dCostPct: m.dCostPct, violations: m.violations,
      mpc, tpl, none: d.summary.none, real: d.totals.real, chosen: d.totals.chosen,
    },
    replayWeeks: reps,
    agent: s.agent,
  };
}
export type K = NonNullable<ReturnType<typeof gather>>;

const dayIdx = (k: K, h: number) => Math.floor(k.w.ms[h] / DAYMS);
const clock = (k: K, h: number) => `${p2(new Date(k.w.ms[h]).getUTCHours())}:00`;
const hoursOfDay = (k: K, h: number) => {
  const key = dayIdx(k, h);
  const out: number[] = [];
  for (let i = 0; i < k.n; i++) if (dayIdx(k, i) === key) out.push(i);
  return out;
};
const wrap = (k: K, t: string) => (k.forecastHour ? t.replace(/(\s*)$/, ' (forecast hour)$1') : t);

/* --------------------------------------------------- simulated changes ---- */

/** Real-campus vs simulated-configuration deltas, investment and payback (same arithmetic as the Simulated pane). */
export function changes(k: K) {
  const { s } = k;
  const t = k.totals;
  let investBat = 0;
  let invest = 0;
  const lines: string[] = [];
  const added = s.batteries.filter((b) => !b.asBuilt);
  for (const b of added) {
    investBat += modelOf(b).priceEur;
    lines.push(`+ battery **${modelOf(b).name}** (${b.capacity.toFixed(2)} MWh / ${b.power.toFixed(2)} MW, ${fmtEur(modelOf(b).priceEur)})`);
  }
  invest = investBat;
  const cov = asBuiltCoverage(s.campus!.features.map((f) => f.properties));
  const eurKw = PANEL_MODELS.find((m) => m.id === s.panelModel)?.eurPerKw ?? 0;
  let extraKwp = 0;
  for (const f of s.campus!.features) {
    const p = f.properties;
    const c = s.solar[p.osmId];
    if (!c) continue;
    const real = installedKwp(p, { on: p.pv_fraction > 0, fraction: p.pv_fraction > 0 ? cov : 0, tilt: DEFAULT_TILT }, 'mono');
    extraKwp += installedKwp(p, c, s.panelModel) - real;
  }
  if (extraKwp > 0.5) {
    invest += extraKwp * eurKw;
    lines.push(`+ **${extraKwp.toFixed(0)} kWp** more solar (${PANEL_MODELS.find((m) => m.id === s.panelModel)?.name}, ${fmtEur(extraKwp * eurKw)})`);
  } else if (extraKwp < -0.5) lines.push(`− ${(-extraKwp).toFixed(0)} kWp of the real solar plant switched off`);
  if (s.agent !== 'mpc') lines.push(`agent set to **${s.agent === 'template' ? 'simple rule-based template' : 'none (no battery control)'}**`);
  if (s.ageing) lines.push('equipment ageing applied');
  if (s.faults.batteries.length) lines.push(`${s.faults.batteries.length} battery unit(s) marked broken`);
  if (s.faults.roofs.length) lines.push(`${s.faults.roofs.length} solar roof(s) marked broken`);
  if (s.faults.cables.length) lines.push(`${s.faults.cables.length} cable segment(s) marked cut`);
  if (s.faults.outage) lines.push(`grid outage of ${s.faults.outage.hours} h from ${hourLabel(s.faults.outage.startH)}`);
  const dCo2 = t.chosen.co2Kg - t.real.co2Kg;
  const dCost = t.chosen.costEur - t.real.costEur;
  return {
    lines, invest, dCo2, dCost,
    pCo2: t.real.co2Kg > 0 ? (dCo2 / t.real.co2Kg) * 100 : 0,
    pCost: t.real.costEur > 0 ? (dCost / t.real.costEur) * 100 : 0,
    payback: paybackYearsOf(invest, -dCost * WEEKS_PER_YEAR),
    none: lines.length === 0,
  };
}

/* ------------------------------------------------------- outage what-if --- */

/** Can battery + solar cover `hours` of grid loss starting at `startH`? (same model as the outage alarm) */
export function outageSim(k: K, startH: number, hours: number) {
  const end = Math.min(k.n, startH + hours);
  const spec = workingBatteries(k.s).reduce((a, b) => ({ p: a.p + b.power * 1000 }), { p: 0 });
  let soc = k.r !== k.d.sims.none ? k.r.socStart[startH] : 0;
  const soc0 = soc;
  let need = 0;
  let unserved = 0;
  let shortAt = -1;
  for (let i = startH; i < end; i++) {
    const nd = Math.max(0, k.w.load[i] - k.d.pvTot[i]);
    const give = Math.min(nd, spec.p, soc * ETA);
    soc -= give / ETA;
    need += nd;
    unserved += nd - give;
    if (shortAt < 0 && nd - give > 1) shortAt = i;
  }
  return { end, hours: end - startH, soc0, need, unserved, shortAt, covered: unserved <= 1 };
}

/* ---------------------------------------------------------- fault impact -- */

function faultIncident(q: string): Incident | null {
  const fa = useFaultAlerts.getState();
  const shown = [...fa.shown, ...fa.extra.filter((e) => !fa.shown.some((m) => m.key === e.key))];
  const pool: Incident[] = shown.length ? shown : [...activeFaults().values()].map((i) => ({ ...i, at: simClock() }));
  if (!pool.length) return null;
  return pool.find((i) => q.includes(norm(i.asset))) ?? pool[0];
}

function faultImpact(k: K, i: Incident): string[] {
  const out: string[] = [];
  const { s, d, w } = k;
  if (i.type === 'battery') {
    const healthy = fleetSpec(effectiveBatteries({ batteries: s.batteries, faults: { batteries: [], roofs: [], cables: [], outage: null }, ageing: s.ageing }));
    const left = k.battery.workingMwh;
    out.push(`Working storage left: **${left.toFixed(2)} MWh** of ${k.battery.totalMwh.toFixed(2)} MWh${left === 0 ? ' — the agent cannot charge or discharge' : ''}.`);
    if (healthy) {
      const input: WeekInput = { start: w.start, ms: w.ms, load: w.load, pv: d.pvTot, price: w.price, co2: w.co2 };
      const ok = simulateWeek(input, healthy, 'mpc').metrics;
      const cur = (d.sims.mpc ?? d.sims.none).metrics;
      out.push(`Over this week the fault costs about **${fmtEur(cur.costAgent - ok.costAgent)}** and **${(cur.co2Agent - co2Fix(ok.co2Agent)).toFixed(0)} kg CO₂** extra vs a healthy yard; challenge score **${cur.score.toFixed(2)}** instead of ${ok.score.toFixed(2)}.`);
    }
  } else if (i.type === 'pv') {
    const b = k.buildings.find((x) => x.short === i.asset);
    if (b) {
      let eur = 0;
      let co2 = 0;
      const lostKwhAt = (h: number) => (b.potKwp * tiltFactor(b.tilt) * w.pv[h]) / PV_ASBUILT_KWP * (s.ageing ? pvHealth(pvYear(s.campus!.features.find((f) => f.properties.osmId === b.id)!.properties)) : 1);
      for (let h = 0; h < k.n; h++) {
        const l = lostKwhAt(h);
        eur += l * w.price[h];
        co2 += l * w.co2[h];
      }
      out.push(`**${b.short}** (${b.potKwp.toFixed(0)} kWp) is not producing: about **${mwh(b.lostWeekKwh)}** lost this week (${fmtKw(b.lostKw)} at ${k.when}), worth up to ≈**${fmtEur(eur)}** and ≈**${co2.toFixed(0)} kg CO₂** of extra grid supply.`);
      out.push(`The campus still has **${fmtKw(k.solar.kw)}** of solar now; faulted capacity in total is ${k.solar.faultedKwp.toFixed(0)} kWp.`);
    }
  } else {
    const o = s.faults.outage;
    if (o) {
      const sim = outageSim(k, o.startH, o.hours);
      out.push(`Grid lost for **${sim.hours} h** from ${hourLabel(o.startH)}: the campus needs ${mwh(sim.need)} from battery + solar; battery starts at ${mwh(sim.soc0)}.`);
      out.push(sim.covered ? 'Battery and solar cover the whole outage.' : `They run short from **${hourLabel(sim.shortAt)}**: ≈**${mwh(sim.unserved)}** of demand unserved, so non-critical loads must be shed.`);
    }
  }
  const t = k.totals;
  out.push(`Week totals now: ΔCO₂ ${t.dCo2Pct.toFixed(2)}%, ΔCost ${t.dCostPct.toFixed(2)}% vs no battery.`);
  return out;
}
const co2Fix = (v: number) => v;

function systemNow(k: K): string {
  const { snap } = k;
  const b = k.battery;
  const act = !b.hasBatt ? 'no working battery (grid + solar only)' : k.battery.kw > 5 ? `charging at **${fmtKw(k.battery.kw)}**` : k.battery.kw < -5 ? `discharging **${fmtKw(-k.battery.kw)}**` : 'idle';
  return `At ${k.when}: demand **${fmtKw(k.load.kw)}**, solar **${fmtKw(k.solar.kw)}**, grid import **${fmtKw(Math.max(0, k.grid.kw))}**, battery ${act}${b.hasBatt ? ` (SOC ${(b.soc * 100).toFixed(0)}%)` : ''}; price ${eur3(snap.price)}, CO₂ ${snap.co2.toFixed(3)} kg/kWh.`;
}

/* ------------------------------------------------------------- answers ---- */

export function explainFault(k: K, q: string): string {
  const i = faultIncident(q);
  if (!i) return `There is no active simulated fault right now. ${alarmSummary(k)}`;
  const pb = FAULT_PLAYBOOK[i.type];
  const lines: string[] = [];
  lines.push(`**${i.title}** — ${pb.label} on **${i.asset}**, raised at simulated time ${i.at}.`);
  lines.push(`**What happened.** ${i.line} ${pb.happened.join(' ')}`);
  lines.push(`**Impact.**\n${faultImpact(k, i).map((l) => `• ${l}`).join('\n')}`);
  lines.push(`**What the system is doing now.** ${pb.solution.join(' ')} ${systemNow(k)}`);
  lines.push(`**Recommended actions.**\n${recommend(k, i).map((l) => `• ${l}`).join('\n')}`);
  return lines.join('\n\n');
}

function recommend(k: K, i: Incident): string[] {
  const rec = [...FAULT_PLAYBOOK[i.type].solution];
  const { w } = k;
  const fut = Array.from({ length: Math.min(24, k.n - k.h) }, (_, j) => k.h + j);
  const hi = fut.reduce((a, b) => (w.price[b] > w.price[a] ? b : a), fut[0]);
  if (i.type === 'battery') rec.push(`Repair before the next expensive window: the priciest hour in the next 24 h is ${hourLabel(hi)} at ${eur3(w.price[hi])}, when the battery would normally discharge.`);
  if (i.type === 'pv') {
    const ahead = Array.from({ length: k.n - k.h }, (_, j) => k.h + j);
    const pk = ahead.reduce((a, b) => (w.pv[b] > w.pv[a] ? b : a), ahead[0]);
    rec.push(w.pv[pk] > 1 ? `Prioritise repair before the next sunny hours: the plant is forecast to peak at ${hourLabel(pk)} (${fmtKw(w.pv[pk])} for the whole plant).` : 'No sun is left in the loaded week, so repair is not urgent for production.');
  }
  if (i.type === 'outage') rec.push(`Contact the grid operator and keep the battery above ${(useSim.getState().alarmCfg.socLow * 100).toFixed(0)}% SOC for backup.`);
  rec.push('Use **Contact technician** in the fault panel to notify the on-call technician.');
  return rec;
}

function alarmSummary(k: K): string {
  const act = k.alarms.filter((a) => a.startH <= k.h && k.h < a.endH);
  return act.length ? `${act.length} alarm(s) active at ${k.when}: ${act.map((a) => a.title).join('; ')}.` : `No alarms active at ${k.when}.`;
}

/** Active, past and upcoming faults/alarms, with the playbook solution for equipment faults. */
export function faultsStatus(k: K): string {
  const inc = useFaultAlerts.getState().shown;
  const act = k.alarms.filter((a) => a.startH <= k.h && k.h < a.endH);
  const past = k.alarms.filter((a) => a.endH <= k.h);
  const next = k.alarms.filter((a) => a.startH > k.h);
  const typeOf = (a: Alarm): FaultType | null => (a.id.startsWith('bat-') ? 'battery' : a.id.startsWith('pv-') ? 'pv' : a.id === 'outage' ? 'outage' : null);
  const fmt = (a: Alarm) => {
    const t = typeOf(a);
    return `• **${a.title}** (${KIND_LABEL[a.kind]}, ${a.severity}) ${hourLabel(a.startH)}${a.endH - a.startH > 1 ? ` → ${hourLabel(a.endH - 1)}` : ''}${a.predicted ? ' · predicted' : ''}. ${a.detail}${t ? ` Default solution: ${FAULT_PLAYBOOK[t].solution.join(' ')}` : ''}`;
  };
  const parts: string[] = [];
  if (inc.length) parts.push(`**Simulated faults active:**\n${inc.map((i) => `• **${i.title}** since ${i.at}. ${FAULT_PLAYBOOK[i.type].solution.join(' ')}`).join('\n')}`);
  parts.push(act.length ? `**Active at ${k.when} (${act.length}):**\n${act.map(fmt).join('\n')}` : `No alarm is active at ${k.when}.`);
  if (past.length) parts.push(`**Earlier this week (${past.length}):** ${past.slice(-5).map((a) => `${a.title} (${hourLabel(a.startH)})`).join('; ')}${past.length > 5 ? '…' : ''}.`);
  if (next.length) parts.push(`**Coming up (${next.length}):** ${next.slice(0, 4).map((a) => `${a.title} (${hourLabel(a.startH)}${a.predicted ? ', predicted' : ''})`).join('; ')}.`);
  const kinds = new Map<string, number>();
  for (const a of k.alarms) kinds.set(KIND_LABEL[a.kind], (kinds.get(KIND_LABEL[a.kind]) ?? 0) + 1);
  if (kinds.size) parts.push(`Week total: ${k.alarms.length} alarms (${[...kinds].map(([a, c]) => `${c} ${a.toLowerCase()}`).join(', ')}).`);
  return parts.join('\n\n');
}

/** Why the battery did what it did at hour h: price/CO2 windows, rank, SOC, guard. */
export function whyBattery(k: K): string {
  const { r, h, w } = k;
  if (!k.battery.hasBatt) return 'There is no working battery in the current configuration, so the agent has nothing to decide.';
  const why = r.reasons[h];
  const sp = r.sp[h];
  const act = sp > 5 ? 'charged' : sp < -5 ? 'discharged' : 'held';
  const win = Array.from({ length: Math.min(24, k.n - h) }, (_, j) => h + j);
  const cheap = win.reduce((a, b) => (w.price[b] < w.price[a] ? b : a), win[0]);
  const dear = win.reduce((a, b) => (w.price[b] > w.price[a] ? b : a), win[0]);
  const clean = win.reduce((a, b) => (w.co2[b] < w.co2[a] ? b : a), win[0]);
  const dirty = win.reduce((a, b) => (w.co2[b] > w.co2[a] ? b : a), win[0]);
  let nextDis = -1;
  for (let j = h + 1; j < k.n; j++) if (r.sp[j] < -5) { nextDis = j; break; }
  const cap = k.battery.workingMwh * 1000;
  let t = wrap(k, `At **${k.when}** the agent **${act}**${act !== 'held' ? ` at **${fmtKw(Math.abs(sp))}**` : ''}. `);
  t += `SOC went ${(r.socStart[h] / cap * 100).toFixed(0)}% → ${(r.socEnd[h] / cap * 100).toFixed(0)}%. `;
  if (act === 'charged') t += `Why: this hour was in the best ${Math.max(1, Math.round(why.rank * 100))}% of the next 24 h — price ${eur3(w.price[h])} (${pct(why.priceVsMean)} vs the window average) and ${w.co2[h].toFixed(3)} kg CO₂/kWh (${pct(why.co2VsMean)}). Cheapest hour of the window: ${hourLabel(cheap)} (${eur3(w.price[cheap])}); cleanest: ${hourLabel(clean)} (${w.co2[clean].toFixed(3)}). Storing now lets it discharge later when the grid is worse${nextDis >= 0 ? `, e.g. ${hourLabel(nextDis)} at ${eur3(w.price[nextDis])}` : ''}.`;
  else if (act === 'discharged') t += `Why: this hour was in the worst ${Math.max(1, Math.round((1 - why.rank) * 100))}% of the next 24 h — price ${eur3(w.price[h])} (${pct(why.priceVsMean)} vs average), ${w.co2[h].toFixed(3)} kg CO₂/kWh (${pct(why.co2VsMean)}). Priciest hour of the window: ${hourLabel(dear)} (${eur3(w.price[dear])}); dirtiest: ${hourLabel(dirty)} (${w.co2[dirty].toFixed(3)}).${why.guard ? ' The export guard limited the discharge so it never exceeds campus demand.' : ''}`;
  else t += `Why: the price/CO₂ spread to the other hours of the next 24 h (price ${pct(why.priceVsMean)}, CO₂ ${pct(why.co2VsMean)} vs average) is too small to repay the 10 % round-trip loss, or the battery was already ${r.socStart[h] / cap > 0.9 ? 'full' : r.socStart[h] / cap < 0.1 ? 'empty' : 'at a good level'}.`;
  t += ` The score weights CO₂ 70 % and cost 30 %, so the agent ranks hours by a blend of both.`;
  return t;
}

/** "What happens if X fails?" computed from the current state of the simulation. */
export function whatIf(k: K, q: string, startH: number | null): string {
  const hrs = (() => {
    const m = q.match(/(\d+)\s*(h\b|hr|hour|hora|ora)/);
    return m ? Math.max(1, Math.min(48, +m[1])) : 4;
  })();
  const at = startH ?? k.h;
  if (has(q, 'substation', 'subestaci', 'grid', 'outage', 'apagon', 'xarxa', 'red ', 'power cut', 'blackout')) {
    const o = outageSim(k, at, hrs);
    return (
      `If the substation / grid connection fails for **${o.hours} h** from **${hourLabel(at)}**, the campus islands on battery + solar. ` +
      `It needs ≈**${mwh(o.need)}** (demand minus solar); the battery starts at **${mwh(o.soc0)}** (${k.battery.workingMwh > 0 ? ((o.soc0 / (k.battery.workingMwh * 1000)) * 100).toFixed(0) : 0}% SOC, max ${fmtKw(k.battery.ratedKw)}). ` +
      (o.covered ? 'That is **enough** to cover the whole outage.' : `It **runs short from ${hourLabel(o.shortAt)}**: ≈**${mwh(o.unserved)}** of demand would go unserved, so non-critical loads must be shed (biggest loads now: ${k.byLoad.slice(0, 3).map((b) => `${b.short} ${fmtKw(b.loadKw)}`).join(', ')}).`) +
      ` Playbook: ${FAULT_PLAYBOOK.substation.solution.join(' ')} You can inject this in Settings → Faults & alarms.`
    );
  }
  if (has(q, 'batter', 'bateria', 'yard', 'storage')) {
    const imp = (() => {
      const e = (k.d.sims.none.metrics.costAgent - k.d.chosen.metrics.costAgent);
      return k.battery.hasBatt ? `Today the battery saves **${fmtEur(e)}** and **${(k.d.sims.none.metrics.co2Agent - k.d.chosen.metrics.co2Agent).toFixed(0)} kg CO₂** this week (score ${k.totals.score.toFixed(2)}); losing it means falling back to grid + solar, so those savings disappear.` : 'There is no working battery already.';
    })();
    return `If the battery yard fails, the ${k.battery.totalMwh.toFixed(2)} MWh / ${k.battery.totalMw.toFixed(2)} MW of storage is isolated and the campus buys everything from the grid (solar still covers what it can). ${imp} ${FAULT_PLAYBOOK.battery.solution.join(' ')}`;
  }
  if (has(q, 'solar', 'roof', 'panel', 'pv', 'inverter', 'placa')) {
    const roof = k.buildings.find((b) => q.includes(norm(b.short)) && b.potKwp > 0);
    const b = roof ?? [...k.buildings].sort((a, c) => c.solarWeekKwh - a.solarWeekKwh)[0];
    return `If the solar array on **${b.short}** fails (${b.potKwp.toFixed(0)} kWp), the campus loses about **${mwh(b.solarWeekKwh)}** this week (${fmtKw(b.solarKw)} at ${k.when}); the battery and grid replace it, raising cost and CO₂ in daylight. ${FAULT_PLAYBOOK.pv.solution.join(' ')}${roof ? '' : ' (This is the largest producing roof; name a building to check another.)'}`;
  }
  if (has(q, 'cable', 'feeder', 'cabl', 'line')) return `If a feeder cable fails, the buildings on that line lose supply until it is rerouted. The biggest loads at ${k.when} are ${k.byLoad.slice(0, 3).map((b) => `${b.short} (${fmtKw(b.loadKw)})`).join(', ')}. ${FAULT_PLAYBOOK.cable.solution.join(' ')}`;
  return `Tell me what fails: the **substation / grid**, the **battery yard**, a **solar roof** or a **cable**, and optionally for how long and when (e.g. "what happens if the grid fails for 6 h at 18:00?").`;
}

export function buildingRanking(k: K): string {
  const tot = k.load.kw;
  const top = k.byLoad.slice(0, 5);
  const tw = k.buildings.reduce((a, b) => a + b.weekKwh, 0);
  const wk = [...k.buildings].sort((a, b) => b.weekKwh - a.weekKwh).slice(0, 3);
  return (
    wrap(k, `Biggest consumers at **${k.when}** (campus ${fmtKw(tot)}):\n`) +
    top.map((b, i) => `${i + 1}. **${b.short}** ${fmtKw(b.loadKw)} — ${((100 * b.loadKw) / Math.max(1, tot)).toFixed(1)}% of the campus`).join('\n') +
    `\nOver the whole week: ${wk.map((b) => `**${b.short}** ${mwh(b.weekKwh)} (${((100 * b.weekKwh) / tw).toFixed(1)}%)`).join(', ')}. ${k.buildings.length} buildings in total; the smallest draws ${fmtKw(k.byLoad[k.byLoad.length - 1].loadKw)}.`
  );
}

/** "Waste" = energy used in off-hours (22:00–06:00 and weekends), when a campus should be near idle. */
export function wasteAnswer(k: K): string {
  const tot = k.buildings.reduce((a, b) => a + b.offKwh, 0);
  const all = k.buildings.reduce((a, b) => a + b.weekKwh, 0);
  const rank = [...k.buildings].sort((a, b) => b.offKwh - a.offKwh).slice(0, 4);
  return (
    `Taking "waste" as energy used out of hours (nights 22:00–06:00 and weekends), the campus used **${mwh(tot)}** (${((100 * tot) / all).toFixed(0)}% of the week). Top buildings:\n` +
    rank.map((b, i) => `${i + 1}. **${b.short}** ${mwh(b.offKwh)} off-hours — ${((100 * b.offKwh) / b.weekKwh).toFixed(0)}% of its own ${mwh(b.weekKwh)}`).join('\n') +
    `\nData centres and labs keep a high base load by nature; the best savings come from the highest off-hour share in teaching buildings. Cutting 10% of the off-hours load would avoid ≈${mwh(tot * 0.1)}.`
  );
}

export function buildingDeep(k: K, id: string): string {
  const b = k.buildings.find((x) => x.id === id)!;
  const rank = k.byLoad.findIndex((x) => x.id === id) + 1;
  const tw = k.buildings.reduce((a, x) => a + x.weekKwh, 0);
  let t = wrap(k, `**${b.short}** (${b.name}, ${b.category.replace('_', ' ')}) draws **${fmtKw(b.loadKw)}** at ${k.when} — ${((100 * b.loadKw) / Math.max(1, k.load.kw)).toFixed(1)}% of the campus, #${rank} of ${k.buildings.length}. `);
  t += `This week it uses **${mwh(b.weekKwh)}** (${((100 * b.weekKwh) / tw).toFixed(1)}% of the campus), peaking at ${fmtKw(b.peakKw)} on ${hourLabel(b.peakH)}; ${((100 * b.offKwh) / Math.max(1, b.weekKwh)).toFixed(0)}% of it is out of hours.`;
  if (b.potKwp > 0) t += ` Its roof carries **${b.kwp.toFixed(0)} kWp** of solar${b.faulted ? ' (currently **faulted**, producing nothing)' : `: ${fmtKw(b.solarKw)} now, ${mwh(b.solarWeekKwh)} this week`}.`;
  else t += ' It has no usable roof for solar.';
  return t;
}

export function solarAnswer(k: K): string {
  const roofs = k.buildings.filter((b) => b.potKwp > 0).sort((a, b) => b.solarWeekKwh - a.solarWeekKwh);
  const day = hoursOfDay(k, k.h);
  const dayKwh = sumOf(day.map((i) => k.d.pvTot[i]));
  const dayLoad = sumOf(day.map((i) => k.w.load[i]));
  return (
    wrap(k, `Solar at **${k.when}**: **${fmtKw(k.solar.kw)}** from ${roofs.length} roofs (${k.solar.installedKwp.toFixed(0)} kWp installed). Irradiance **${k.solar.irr.toFixed(0)} W/m²**, ${k.solar.tempC.toFixed(1)} °C${k.solar.cloud != null ? `, cloud cover ${(k.solar.cloud * 100).toFixed(0)}%` : ''}.\n`) +
    `That day: ${mwh(dayKwh)} produced = ${((100 * dayKwh) / Math.max(1, dayLoad)).toFixed(1)}% of demand; whole week ${mwh(k.solar.weekKwh)}, peak ${fmtKw(k.solar.peakKw)}.\n` +
    `Top roofs: ${roofs.slice(0, 5).map((b) => `**${b.short}** ${fmtKw(b.solarKw)} now / ${mwh(b.solarWeekKwh)} week (${b.kwp.toFixed(0)} kWp)${b.faulted ? ' FAULT' : ''}`).join('; ')}.` +
    (k.solar.faultedKwp > 0 ? `\nFaulted capacity: ${k.solar.faultedKwp.toFixed(0)} kWp.` : '')
  );
}

export function batteryAnswer(k: K): string {
  const b = k.battery;
  if (!b.units.length) return 'No battery is installed. Add one from the Catalogue or Settings → Equipment & budget.';
  const used = b.totalMw;
  const cap = b.workingMwh * 1000;
  return (
    wrap(k, `Battery yard at **${k.when}**: ${b.units.length} unit${b.units.length > 1 ? 's' : ''}, **${b.totalMwh.toFixed(2)} MWh / ${b.totalMw.toFixed(2)} MW** installed (${b.workingMwh.toFixed(2)} MWh working). `) +
    (b.hasBatt ? `SOC **${(b.soc * 100).toFixed(0)}%** (${mwh(b.socKwh)}), ${b.kw > 5 ? `charging **${fmtKw(b.kw)}**` : b.kw < -5 ? `discharging **${fmtKw(-b.kw)}**` : 'idle'}.` : 'All units are offline.') +
    `\nUnits: ${b.units.map((u) => `${u.name} ${u.mwh.toFixed(2)} MWh/${u.mw.toFixed(2)} MW${u.asBuilt ? ' (real)' : ''}${u.faulted ? ' — OFFLINE' : ''}`).join('; ')}.` +
    `\nYard limit (substation connection): ${used.toFixed(2)} of **${b.yardLimitMw.toFixed(1)} MW** used, ${(b.yardLimitMw - used).toFixed(2)} MW free.` +
    (b.hasBatt ? ` This week it charges ${mwh(b.chargedKwh)} and discharges ${mwh(b.dischargedKwh)} (≈${(b.dischargedKwh / Math.max(1, cap)).toFixed(1)} full cycles).` : '')
  );
}

export function gridAnswer(k: K): string {
  const g = k.grid;
  return (
    wrap(k, `Grid import at **${k.when}**: **${fmtKw(Math.max(0, g.kw))}** (without battery ${fmtKw(Math.max(0, g.baseKw))}); price ${eur3(k.price.now)}, ${k.co2.now.toFixed(3)} kg CO₂/kWh.\n`) +
    `Week: **${mwh(g.weekKwh)}** imported (${mwh(g.baseWeekKwh)} without battery, ${((1 - g.weekKwh / Math.max(1, g.baseWeekKwh)) * 100).toFixed(1)}% less change), peak ${fmtKw(g.peakKw)} on ${hourLabel(g.peakH)}; ${g.exportHours} hours with surplus export. Cost **${fmtEur(k.totals.costEur)}** and **${k.totals.co2Kg.toFixed(0)} kg CO₂** vs ${fmtEur(k.totals.baseCostEur)} / ${k.totals.baseCo2Kg.toFixed(0)} kg with no battery.`
  );
}

export function priceCo2Answer(k: K, both = true): string {
  const w = k.w;
  const days = new Map<number, number[]>();
  for (let i = 0; i < k.n; i++) days.set(dayIdx(k, i), [...(days.get(dayIdx(k, i)) ?? []), i]);
  const avgs = [...days.values()].map((ix) => `${DOW[new Date(w.ms[ix[0]]).getUTCDay()].slice(0, 3)} ${eur3(sumOf(ix.map((i) => w.price[i])) / ix.length)}`);
  const iMin = w.price.indexOf(k.price.min);
  const iMax = w.price.indexOf(k.price.max);
  const cMin = w.co2.indexOf(k.co2.min);
  const cMax = w.co2.indexOf(k.co2.max);
  return (
    wrap(k, `At **${k.when}**: price **${eur3(k.price.now)}**, CO₂ **${k.co2.now.toFixed(3)} kg/kWh** (${pct(k.price.now / k.price.mean - 1)} / ${pct(k.co2.now / k.co2.mean - 1)} vs the week average).\n`) +
    `Week price: min ${eur3(k.price.min)} (${hourLabel(iMin)}), max ${eur3(k.price.max)} (${hourLabel(iMax)}), mean ${eur3(k.price.mean)}. Daily means: ${avgs.join(', ')}.` +
    (both ? `\nWeek CO₂: cleanest ${k.co2.min.toFixed(3)} (${hourLabel(cMin)}), dirtiest ${k.co2.max.toFixed(3)} (${hourLabel(cMax)}), mean ${k.co2.mean.toFixed(3)} kg/kWh.` : '')
  );
}

export function weekAnswer(k: K): string {
  const t = k.totals;
  const reps = k.replayWeeks;
  const avgWeek = reps.reduce((a, x) => a + sumOf(x.load), 0) / reps.length;
  const days = new Map<number, number[]>();
  for (let i = 0; i < k.n; i++) days.set(dayIdx(k, i), [...(days.get(dayIdx(k, i)) ?? []), i]);
  const dayLoad = [...days.values()].map((ix) => [ix, sumOf(ix.map((i) => k.w.load[i]))] as const);
  const hiD = dayLoad.reduce((a, b) => (b[1] > a[1] ? b : a));
  const loD = dayLoad.reduce((a, b) => (b[1] < a[1] ? b : a));
  const dn = (ix: number[]) => DOW[new Date(k.w.ms[ix[0]]).getUTCDay()];
  return (
    `**Week of ${k.w.start.slice(0, 10)}${k.nowH != null ? ' (measured + forecast)' : ''}:** demand **${mwh(k.load.weekKwh)}** (${pct(k.load.weekKwh / avgWeek - 1)} vs the average of ${reps.length} weeks), peak ${fmtKw(k.load.peakKw)} on ${hourLabel(k.load.peakH)}. ` +
    `Solar ${mwh(k.solar.weekKwh)} = ${((100 * k.solar.weekKwh) / k.load.weekKwh).toFixed(1)}% of demand. Grid import ${mwh(k.grid.weekKwh)}.\n` +
    `Heaviest day: ${dn(hiD[0])} ${mwh(hiD[1])}; lightest: ${dn(loD[0])} ${mwh(loD[1])}.\n` +
    `Result (${k.agent}): cost ${fmtEur(t.costEur)} (no battery ${fmtEur(t.baseCostEur)}), CO₂ ${t.co2Kg.toFixed(0)} kg (${t.baseCo2Kg.toFixed(0)} kg); ΔCO₂ **${t.dCo2Pct.toFixed(2)}%**, ΔCost **${t.dCostPct.toFixed(2)}%**, challenge score **${t.score.toFixed(2)}** with ${t.violations} infractions (MPC agent ${t.mpc.score.toFixed(2)}, rule-based template ${t.tpl.score.toFixed(2)}).`
  );
}

export function decisionsAnswer(k: K): string {
  const hs = hoursOfDay(k, k.h);
  const ch = hs.filter((i) => k.r.sp[i] > 5);
  const di = hs.filter((i) => k.r.sp[i] < -5);
  if (!k.battery.hasBatt) return 'No working battery, so there are no charge/discharge decisions.';
  const rng = (ix: number[]) => (ix.length ? `${clock(k, ix[0])}–${p2((new Date(k.w.ms[ix[ix.length - 1]]).getUTCHours() + 1) % 24)}:00 at avg ${eur3(sumOf(ix.map((i) => k.w.price[i])) / ix.length)}, ${(sumOf(ix.map((i) => k.w.co2[i])) / ix.length).toFixed(3)} kg/kWh, ${mwh(sumOf(ix.map((i) => Math.abs(k.r.sp[i]))))}` : 'none');
  return `The agent's plan for ${hourLabel(hs[0]).replace(/ \d\d:00$/, '')}: **charges** ${ch.length} h (${rng(ch)}) and **discharges** ${di.length} h (${rng(di)}). It charges when the blended price/CO₂ rank of the hour is in the best part of the next 24 h and discharges in the worst, subject to the 500 kW limit, 90 % round trip and the export guard. ${whyBrief(k)}`;
}
const whyBrief = (k: K) => `Right now (${k.when}) it is ${k.battery.kw > 5 ? 'charging' : k.battery.kw < -5 ? 'discharging' : 'idle'}.`;

export function forecastAnswer(k: K): string {
  const { d } = k;
  if (d.nowH == null) return 'The forecast split is switched off, so the whole week is shown as measured history. Turn it on in Settings to see what the agent plans for the future.';
  const nowH = d.nowH;
  const win = Array.from({ length: Math.min(24, k.n - nowH) }, (_, j) => nowH + j);
  let ae = 0;
  let ap = 0;
  let cnt = 0;
  for (let i = nowH; i < k.n; i++) {
    ae += Math.abs(d.week.load[i] - d.actual.load[i]) / Math.max(1, d.actual.load[i]);
    ap += Math.abs(d.week.price[i] - d.actual.price[i]) / Math.max(1e-3, d.actual.price[i]);
    cnt++;
  }
  const pk = win.reduce((a, b) => (d.week.load[b] > d.week.load[a] ? b : a), win[0]);
  const lo = win.reduce((a, b) => (d.week.price[b] < d.week.price[a] ? b : a), win[0]);
  const hi = win.reduce((a, b) => (d.week.price[b] > d.week.price[a] ? b : a), win[0]);
  return (
    `"Now" is **${hourLabel(nowH)}**; hours after it are forecast (${k.n - nowH} h) from what was knowable at that time. Next 24 h: demand peaks at **${fmtKw(d.week.load[pk])}** (${hourLabel(pk)}), cheapest price ${eur3(d.week.price[lo])} at ${hourLabel(lo)}, dearest ${eur3(d.week.price[hi])} at ${hourLabel(hi)}, solar up to ${fmtKw(Math.max(...win.map((i) => d.pvTot[i])))}.\n` +
    `Against what really happened in the replay the forecast is off by **${((100 * ae) / Math.max(1, cnt)).toFixed(1)}%** on demand and **${((100 * ap) / Math.max(1, cnt)).toFixed(0)}%** on price (mean absolute error per hour). Forecast shown on the timeline: ${useSim.getState().fcStage === 'ready' ? 'yes' : 'not generated yet (use the Forecast button)'}.`
  );
}

export function insightsAnswer(k: K): string {
  const { d, w } = k;
  const out: string[] = [];
  // 1. demand anomalies vs same weekday-hour in the other weeks
  const key = (ms: number) => new Date(ms).getUTCDay() * 24 + new Date(ms).getUTCHours();
  const sm = new Float64Array(168);
  const sq = new Float64Array(168);
  const ct = new Float64Array(168);
  for (const x of k.replayWeeks) {
    if (x.start === w.start) continue;
    for (let i = 0; i < x.load.length; i++) {
      const j = key(x.ms[i]);
      sm[j] += x.load[i];
      sq[j] += x.load[i] ** 2;
      ct[j]++;
    }
  }
  const lim = d.nowH ?? k.n;
  const zs: Array<[number, number, number]> = [];
  for (let i = 0; i < lim; i++) {
    const j = key(d.actual.ms[i]);
    if (ct[j] < 3) continue;
    const mu = sm[j] / ct[j];
    const sd = Math.sqrt(Math.max(1e-6, sq[j] / ct[j] - mu * mu));
    zs.push([i, (d.actual.load[i] - mu) / sd, mu]);
  }
  zs.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  if (zs[0] && Math.abs(zs[0][1]) < 1.5) out.push(`Demand is regular: no measured hour deviates more than ${Math.abs(zs[0][1]).toFixed(1)}σ from the typical value for its weekday-hour in the other ${k.replayWeeks.length - 1} weeks.`);
  else if (zs[0]) out.push(`Unusual demand: **${hourLabel(zs[0][0])}** was ${fmtKw(d.actual.load[zs[0][0]])}, ${zs[0][1] > 0 ? 'above' : 'below'} the typical ${fmtKw(zs[0][2])} for that weekday-hour (${Math.abs(zs[0][1]).toFixed(1)}σ).`);
  // 2. off-hours share + base load
  const off = k.buildings.reduce((a, b) => a + b.offKwh, 0) / Math.max(1, k.load.weekKwh);
  out.push(`${(off * 100).toFixed(0)}% of the week's energy is used out of hours; the minimum campus load is ${fmtKw(Math.min(...w.load))} vs a ${fmtKw(k.load.peakKw)} peak (base-load ratio ${((100 * Math.min(...w.load)) / k.load.peakKw).toFixed(0)}%).`);
  // 3. price vs CO2 tension
  const mp = k.price.mean;
  const mc = k.co2.mean;
  const conflict = Array.from({ length: k.n }, (_, i) => i).filter((i) => (w.price[i] < mp * 0.8 && w.co2[i] > mc * 1.15) || (w.price[i] > mp * 1.2 && w.co2[i] < mc * 0.85));
  out.push(`Price and CO₂ disagree in ${conflict.length} hours${conflict[0] != null ? ` (e.g. ${hourLabel(conflict[0])}: ${eur3(w.price[conflict[0]])}, ${w.co2[conflict[0]].toFixed(3)} kg/kWh)` : ''}; the agent resolves it with the 70/30 CO₂/cost weighting.`);
  // 4. solar coverage / export
  out.push(`Solar covers ${((100 * k.solar.weekKwh) / k.load.weekKwh).toFixed(1)}% of demand, with ${k.grid.exportHours} export hours — the campus never has real surplus, so extra panels are used on site.`);
  // 5. battery use
  if (k.battery.hasBatt) {
    const cap = k.battery.workingMwh * 1000;
    const low = Array.from(k.r.socEnd).filter((v) => v / cap < 0.2).length;
    out.push(`Battery: ${(k.battery.dischargedKwh / cap).toFixed(1)} equivalent cycles this week, below 20% SOC for ${low} h; savings vs no battery ${fmtEur(k.totals.baseCostEur - k.totals.costEur)} and ${(k.totals.baseCo2Kg - k.totals.co2Kg).toFixed(0)} kg CO₂.`);
  }
  const act = k.alarms.length;
  if (act) out.push(`${act} alarms this week (${k.alarms.filter((a) => a.severity === 'critical').length} critical).`);
  return `**Insights for the week of ${w.start.slice(0, 10)}**\n${out.map((l) => `• ${l}`).join('\n')}`;
}

export function changesAnswer(k: K): string {
  const c = changes(k);
  if (c.none) return `No simulated changes: the campus is the real one (challenge battery, real solar plant, MPC agent), so nothing differs from reality. Add batteries or solar in the Catalogue or Settings and I will report the CO₂/cost delta, investment and payback.`;
  const sg = (v: number) => (v < 0 ? '−' : '+');
  return (
    `**Simulated changes**\n${c.lines.map((l) => `• ${l}`).join('\n')}\n` +
    `Vs the real campus over this week: CO₂ **${sg(c.dCo2)}${Math.abs(c.dCo2).toFixed(0)} kg** (${c.pCo2.toFixed(1)}%), energy cost **${sg(c.dCost)}${fmtEur(Math.abs(c.dCost))}** (${c.pCost.toFixed(1)}%).\n` +
    `Investment **${fmtEur(c.invest)}**; ${Number.isFinite(c.payback) && c.payback > 0 ? `payback ≈ **${c.payback.toFixed(1)} years** (week saving × 52, no financing or degradation)` : 'no payback: the changes do not save energy cost'}.`
  );
}

export function warmEconomics(): void {
  const s = useSim.getState();
  if (cachedEconomics() || !s.replay || !s.campus) return;
  void computeEconomics(s.replay, s.campus.features.map((f) => f.properties));
}

export function catalogueAnswer(k: K, q: string): string {
  const eco = cachedEconomics();
  if (!eco) warmEconomics();
  const tok = (m: { id: string; name: string; vendor?: string }) => [norm(m.name), norm(m.name).split(' ')[0], norm(m.vendor ?? '').split(' ')[0], m.id].filter((t) => t.length >= 3);
  const word = (t: string) => new RegExp(`(^|[^a-z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(q);
  const bm = BATTERY_MODELS.find((m) => tok(m).some(word));
  const pm = PANEL_MODELS.find((m) => [norm(m.name), norm(m.name).split(' ')[0], m.id].some(word));
  const pay = (id: string, solar: boolean) => {
    const e = solar ? eco?.solar[id] : eco?.battery[id];
    return e ? ` Saves ≈${fmtEur(e.annualSavingEur)}/yr → payback **${Number.isFinite(e.paybackYears) ? e.paybackYears.toFixed(1) + ' years' : 'never'}** (life ${solar ? LIFETIME_YEARS.solar : LIFETIME_YEARS.battery} y${e.pays ? '' : ', does not pay back'}).` : ' Payback is still being computed — ask again in a few seconds.';
  };
  if (bm) {
    const room = SUBSTATION_POWER_LIMIT_MW - k.battery.totalMw;
    return `**${bm.name}** (${bm.vendor}): ${bm.capacity} MWh / ${bm.power} MW, ${bm.rte}% round trip, ${bm.cycles} cycles, **${fmtEur(bm.priceEur)}** (${(bm.priceEur / (bm.capacity * 1000)).toFixed(0)} €/kWh).${pay(bm.id, false)} ${bm.power <= room + 1e-9 ? `Fits in the yard (${room.toFixed(2)} MW free).` : `Exceeds the ${SUBSTATION_POWER_LIMIT_MW} MW connection limit (${room.toFixed(2)} MW free).`}`;
  }
  if (pm) {
    const e = eco?.solar[pm.id];
    return `**${pm.name}**: ${(pm.efficiency).toFixed(1)}% efficiency, ${pm.kwm2} kW/m², **${pm.eurPerKw} €/kWp**${e ? `; full usable roof = ${e.kwp.toFixed(0)} kWp for ${fmtEur(e.priceEur)}` : ''}.${pay(pm.id, true)}`;
  }
  const bl = BATTERY_MODELS.map((m) => `${m.name} ${m.capacity} MWh/${m.power} MW ${fmtEur(m.priceEur)}${eco?.battery[m.id] && Number.isFinite(eco.battery[m.id].paybackYears) ? ` (${eco.battery[m.id].paybackYears.toFixed(1)} y)` : ''}`);
  const sl = PANEL_MODELS.map((m) => `${m.name} ${m.eurPerKw} €/kWp${eco?.solar[m.id] && Number.isFinite(eco.solar[m.id].paybackYears) ? ` (${eco.solar[m.id].paybackYears.toFixed(1)} y)` : ''}`);
  let best = '';
  if (eco) {
    const b = BATTERY_MODELS.map((m) => [m.name, eco.battery[m.id].paybackYears] as const).sort((a, c) => a[1] - c[1])[0];
    best = ` Fastest battery payback: **${b[0]}** (${b[1].toFixed(1)} y). CO₂ valued at ${CO2_EUR_PER_KG} €/kg.`;
  }
  return `**Batteries:** ${bl.join('; ')}.\n**Solar panels:** ${sl.join('; ')}.${best} Yard limit ${SUBSTATION_POWER_LIMIT_MW} MW (${k.battery.totalMw.toFixed(2)} used).${eco ? '' : ' Payback figures are still being computed.'}`;
}

/* -------------------------------------------------------------- router ---- */

/**
 * Intent + entity router. `q` is the normalised question, `when` an hour index parsed from it (or null). Returns
 * null when the question is not about something this module knows, so the caller can fall back.
 */
export function answerKnowledge(q: string, when: { h: number; hasHour: boolean } | null): KAnswer | null {
  const hh = when && when.h >= 0 ? when.h : undefined;
  const k = gather(hh);
  if (!k) return null;
  const go = when?.hasHour && when.h >= 0 && when.h !== k.snap.hour ? { goTo: when.h * 60 + 30 } : {};
  const ret = (text: string): KAnswer => ({ text, ...go });

  if (has(q, 'explain the active fault', 'explain the fault', 'what happened')) return ret(explainFault(k, q));
  const failing = has(q, 'fail', 'fall', 'goes down', 'go down', 'breaks', 'break', 'trips', 'tripped', 'se cae', 'falla', 'cut', 'blackout', 'loses', 'lose');
  if (failing && has(q, 'what happens', 'what if', 'what would', 'what will', 'if the', 'if a', 'if we', 'qu[eé] pasa', 'que passa', 'si ')) return ret(whatIf(k, q, hh ?? null));
  if (has(q, 'why', 'por que', 'perque', 'how come', 'reason') && has(q, 'batter', 'bateria', 'charg', 'carg', 'carreg', 'discharg', 'hold', 'idle', 'agent')) return ret(whyBattery(k));
  if (has(q, 'alarm', 'alert', 'alarma', 'fault', 'averia', 'broken', 'roto', 'outage', 'apagon', 'tall', 'problem', 'incid', 'solution', 'playbook')) return ret(faultsStatus(k));
  if (has(q, 'waste', 'wasting', 'wasteful', 'inefficien', 'idle building', 'standby', 'off hours', 'out of hours', 'desperdic', 'malgast', 'derroch')) return ret(wasteAnswer(k));
  if (has(q, 'insight', 'anomal', 'unusual', 'strange', 'weird', 'surpris', 'outlier', 'interesting', 'notable')) return ret(insightsAnswer(k));
  if (has(q, 'forecast', 'predict', 'prevision', 'pronostic', 'prediccio')) return ret(forecastAnswer(k));
  if (has(q, 'catalog', 'how much (does|is|do)', 'cost of', 'price of', 'prices of', 'cheapest battery', 'which battery', 'payback', 'roi', 'worth', 'megapack', 'tesla', 'byd', 'catl', 'huawei', 'lg ', 'tandem', 'hjt', 'perc') && !has(q, 'electricity', 'grid price', 'price now')) {
    const hasItem = BATTERY_MODELS.some((m) => [norm(m.name).split(' ')[0], norm(m.vendor).split(' ')[0], m.id].some((t) => t.length >= 3 && q.includes(t))) || PANEL_MODELS.some((m) => q.includes(norm(m.name).split(' ')[0]));
    if (hasItem || has(q, 'catalog', 'battery', 'bateria', 'panel', 'solar')) return ret(catalogueAnswer(k, q));
    return ret(changesAnswer(k));
  }
  if (has(q, 'invest', 'simulat', 'my changes', 'what did i change', 'what changed', 'delta', 'what if i', 'budget')) return ret(changesAnswer(k));
  if (has(q, 'decision', 'schedule', 'plan', 'agent do', 'dispatch', 'strategy', 'estrategia') && has(q, 'batter', 'agent', 'today', 'day', 'decision')) return ret(decisionsAnswer(k));
  if (has(q, 'soc', 'state of charge', 'yard', 'how full', 'how many batter', 'how many unit', 'battery units', 'capacity', 'batter\\w+ (status|state|level)', 'cuanta bateria')) return ret(batteryAnswer(k));
  if (has(q, 'grid', 'import', 'red ', 'xarxa') && !has(q, 'price', 'co2')) return ret(gridAnswer(k));
  if (has(q, 'irradian', 'weather', 'temperature', 'cloud', 'meteo', 'temps') || (has(q, 'solar', 'pv', 'panel', 'roof', 'fotovolt', 'placa') && !has(q, 'add', 'install', 'place', 'put', 'room', 'anad', 'instal', 'afegir', 'posar'))) {
    const hit = k.buildings.find((b) => q.includes(norm(b.short)) && b.potKwp > 0);
    return ret(hit ? buildingDeep(k, hit.id) : solarAnswer(k));
  }
  const dayish = has(q, 'week', 'weekly', 'semana', 'setmana', 'total', 'overall', 'summary', 'resum', 'vs no battery', 'without battery', 'compared');
  if (dayish && has(q, 'price', 'preu', 'precio', 'co2', 'carbon')) return ret(priceCo2Answer(k));
  if (dayish && !has(q, 'yesterday', 'ayer', 'ahir')) return ret(weekAnswer(k));
  if (has(q, 'price', 'preu', 'precio', 'co2', 'carbon') && hh !== undefined) return ret(priceCo2Answer(k, has(q, 'co2', 'carbon')));
  if (has(q, 'load share', 'share', 'percent', 'proportion', 'quota', 'which building', 'what building', 'all buildings', 'every building', 'most', 'biggest', 'rank', 'top')) {
    if (has(q, 'building', 'edifici', 'edificio', 'consum')) return ret(buildingRanking(k));
  }
  return null;
}
