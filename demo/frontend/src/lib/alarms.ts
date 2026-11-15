/**
 * Alarm engine: scans the current week (measured part + forecast part) and the injected faults and returns
 * a list of events with severity and time span. Pure function of `derived` + store state, recomputed on demand.
 */
import { useMemo } from 'react';
import { derived, useSim, visibleLimitH, workingBatteries, type AlarmKind } from '../store/useSim';
import { modelOf } from '../sim/engine';
import { fmtKw } from './format';

export type Severity = 'critical' | 'warning' | 'info';

export interface Alarm {
  id: string;
  kind: AlarmKind;
  severity: Severity;
  /** hour span in the week, [startH, endH) */
  startH: number;
  endH: number;
  title: string;
  detail: string;
  /** building osmId or 'battery' / 'substation' the alarm points at on the map */
  target?: string;
  /** starts after "now": predicted by the forecast */
  predicted: boolean;
}

export const KIND_LABEL: Record<AlarmKind, string> = {
  equipment: 'Equipment fault',
  outage: 'Grid outage',
  demand: 'Over-demand',
  price: 'Price spike',
  co2: 'High CO₂',
  soc: 'Battery low',
  data: 'Telemetry gap',
};

/** Group consecutive hours where `test(h)` holds into [start, end) runs. */
function runs(n: number, test: (h: number) => boolean): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let s = -1;
  for (let h = 0; h <= n; h++) {
    const on = h < n && test(h);
    if (on && s < 0) s = h;
    if (!on && s >= 0) {
      out.push([s, h]);
      s = -1;
    }
  }
  return out;
}

const SEV_RANK: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };

export function computeAlarms(): Alarm[] {
  const d = derived.current;
  const s = useSim.getState();
  if (!d || !s.campus) return [];
  const cfg = s.alarmCfg;
  const n = d.week.load.length;
  const nowH = d.nowH ?? n;
  const out: Alarm[] = [];
  const add = (a: Omit<Alarm, 'predicted'>) => out.push({ ...a, predicted: a.startH >= nowH });

  // ---- equipment faults (injected in Settings)
  if (cfg.on.equipment) {
    for (const id of s.faults.batteries) {
      const u = s.batteries.find((b) => b.id === id);
      if (!u) continue;
      const m = modelOf(u);
      const left = workingBatteries(s).reduce((a, b) => a + b.capacity, 0);
      add({
        id: `bat-${id}`,
        kind: 'equipment',
        severity: 'critical',
        startH: 0,
        endH: n,
        title: `Battery offline: ${m.name}`,
        detail: `${u.capacity.toFixed(2)} MWh / ${u.power.toFixed(2)} MW out of service. Working storage: ${left.toFixed(2)} MWh.${left === 0 ? ' No storage left: the agent cannot act.' : ''}`,
        target: 'battery',
      });
    }
    for (const id of s.faults.roofs) {
      const p = s.campus.features.find((f) => f.properties.osmId === id)?.properties;
      if (!p) continue;
      add({ id: `pv-${id}`, kind: 'equipment', severity: 'warning', startH: 0, endH: n, title: `Solar array fault: ${p.short}`, detail: 'Inverter reports no output. Production on this roof is lost until repaired.', target: id });
    }
  }

  // ---- grid outage (injected)
  const o = s.faults.outage;
  if (cfg.on.outage && o) {
    const end = Math.min(n, o.startH + o.hours);
    let unserved = 0;
    let soc = d.chosen.socStart[o.startH] ?? 0;
    const spec = workingBatteries(s).reduce((a, b) => ({ cap: a.cap + b.capacity * 1000, p: a.p + b.power * 1000 }), { cap: 0, p: 0 });
    for (let h = o.startH; h < end; h++) {
      const need = Math.max(0, d.week.load[h] - d.pvTot[h]);
      const give = Math.min(need, spec.p, soc * Math.sqrt(0.9));
      soc -= give / Math.sqrt(0.9);
      unserved += need - give;
    }
    add({
      id: 'outage',
      kind: 'outage',
      severity: 'critical',
      startH: o.startH,
      endH: end,
      title: `Grid outage (${end - o.startH} h)`,
      detail: unserved > 1 ? `Battery and solar cannot cover the campus: ≈${(unserved / 1000).toFixed(1)} MWh of demand unserved. Shed non-critical loads.` : 'Battery and solar cover the campus for the whole outage.',
      target: 'substation',
    });
  }

  // ---- over-demand
  if (cfg.on.demand) {
    for (const [a, b] of runs(n, (h) => d.week.load[h] > cfg.maxDemandKw)) {
      let pk = a;
      for (let h = a; h < b; h++) if (d.week.load[h] > d.week.load[pk]) pk = h;
      add({ id: `dem-${a}`, kind: 'demand', severity: 'warning', startH: a, endH: b, title: `Over-demand ${fmtKw(d.week.load[pk])}`, detail: `Campus demand above the ${fmtKw(cfg.maxDemandKw)} limit for ${b - a} h.`, target: 'substation' });
    }
  }

  // ---- price spikes
  if (cfg.on.price) {
    for (const [a, b] of runs(n, (h) => d.week.price[h] > cfg.priceHigh)) {
      let pk = a;
      for (let h = a; h < b; h++) if (d.week.price[h] > d.week.price[pk]) pk = h;
      add({ id: `pr-${a}`, kind: 'price', severity: 'info', startH: a, endH: b, title: `Price spike ${d.week.price[pk].toFixed(3)} €/kWh`, detail: `Grid price above ${cfg.priceHigh.toFixed(3)} €/kWh for ${b - a} h. Discharging the battery here pays most.` });
    }
  }

  // ---- high CO2
  if (cfg.on.co2) {
    for (const [a, b] of runs(n, (h) => d.week.co2[h] > cfg.co2High)) {
      add({ id: `co2-${a}`, kind: 'co2', severity: 'info', startH: a, endH: b, title: 'High grid CO₂', detail: `Carbon intensity above ${cfg.co2High.toFixed(3)} kg/kWh for ${b - a} h.` });
    }
  }

  // ---- battery low
  const cap = workingBatteries(s).reduce((a, b) => a + b.capacity * 1000, 0);
  if (cfg.on.soc && cap > 0 && d.chosen !== d.sims.none) {
    for (const [a, b] of runs(n, (h) => d.chosen.socEnd[h] / cap < cfg.socLow)) {
      add({ id: `soc-${a}`, kind: 'soc', severity: 'warning', startH: a, endH: b, title: `Battery below ${(cfg.socLow * 100).toFixed(0)}%`, detail: `Little reserve left for ${b - a} h: an outage now could not be covered.`, target: 'battery' });
    }
  }

  // ---- telemetry gaps in the measured data
  if (cfg.on.data) {
    for (let h = 1; h < Math.min(n, nowH); h++) {
      const gap = (d.actual.ms[h] - d.actual.ms[h - 1]) / 3_600_000;
      if (gap > 1.5) add({ id: `gap-${h}`, kind: 'data', severity: 'info', startH: h, endH: h + 1, title: `Telemetry gap (${Math.round(gap - 1)} h missing)`, detail: 'Meter data missing before this hour; values resume here.' });
    }
  }

  return out.sort((x, y) => x.startH - y.startH || SEV_RANK[x.severity] - SEV_RANK[y.severity]);
}

/** All alarms for the current week + configuration (recomputed when the store version changes). */
export function useAlarms(): Alarm[] {
  const stage = useSim((s) => s.fcStage);
  const reveal = useSim((s) => Math.floor(s.fcReveal));
  const version = useSim((s) => s.version);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => {
    // predicted alarms only appear once the forecast has been generated (and only as far as it has been revealed)
    const lim = visibleLimitH(useSim.getState());
    return computeAlarms().filter((x) => x.startH < lim);
  }, [version, stage, reveal]);
}

/** Alarms active at hour h. */
export const activeAt = (alarms: Alarm[], h: number) => alarms.filter((a) => a.startH <= h && h < a.endH);
