/**
 * What the screen is showing right now:
 *  - time:     'live' (the timeline sits on "now"), 'history' (measured data) or 'forecast' (predicted);
 *  - scenario: one entry per way the simulated campus differs from the real, as-built one (each added or resized
 *              battery, each roof with changed solar, panel technology, agent, ageing, every injected fault),
 *              with the map target to fly to. Empty list = the real campus.
 */
import { useSim } from '../store/useSim';
import { modelOf, asBuiltCoverage, DEFAULT_TILT } from '../sim/engine';
import { PANEL_MODELS } from '../data/catalogue';

export type TimeMode = 'live' | 'history' | 'forecast';

export interface Change {
  label: string;
  /** map target: building osmId, 'battery', 'substation' (or none) */
  target?: string;
  kind: 'added' | 'changed' | 'fault' | 'setting';
}

export function useViewMode(): { time: TimeMode; scenario: Change[]; simRoofs: string[]; simUnits: string[] } {
  const hour = useSim((s) => s.snap?.hour ?? 0);
  const forecastOn = useSim((s) => s.forecastOn);
  const nowH = useSim((s) => s.nowH);
  const batteries = useSim((s) => s.batteries);
  const solar = useSim((s) => s.solar);
  const panelModel = useSim((s) => s.panelModel);
  const agent = useSim((s) => s.agent);
  const faults = useSim((s) => s.faults);
  const ageing = useSim((s) => s.ageing);
  const campus = useSim((s) => s.campus);
  return computeMode({ hour, forecastOn, nowH, batteries, solar, panelModel, agent, faults, ageing, campus });
}

export function computeMode(s: Pick<ReturnType<typeof useSim.getState>, 'forecastOn' | 'nowH' | 'batteries' | 'solar' | 'panelModel' | 'agent' | 'faults' | 'ageing' | 'campus'> & { hour: number }) {
  const time: TimeMode = !s.forecastOn ? 'history' : s.hour === s.nowH ? 'live' : s.hour < s.nowH ? 'history' : 'forecast';
  const scenario: Change[] = [];
  const simUnits: string[] = [];
  const simRoofs: string[] = [];

  // storage: the as-built unit (removed / resized) and every added unit, one entry each
  const base = s.batteries.find((b) => b.asBuilt);
  if (!base) scenario.push({ label: 'Original 2 MWh battery removed', target: 'battery', kind: 'changed' });
  else if (Math.abs(base.capacity - 2) > 1e-6 || Math.abs(base.power - 0.5) > 1e-6) {
    scenario.push({ label: `Original battery resized to ${base.capacity.toFixed(2)} MWh / ${base.power.toFixed(2)} MW`, target: 'battery', kind: 'changed' });
    simUnits.push(base.id);
  }
  for (const b of s.batteries.filter((x) => !x.asBuilt)) {
    scenario.push({ label: `+ ${modelOf(b).name} · ${b.capacity.toFixed(2)} MWh / ${b.power.toFixed(2)} MW`, target: 'battery', kind: 'added' });
    simUnits.push(b.id);
  }

  // solar: every roof whose array differs from the real plant
  if (s.campus) {
    const cov = asBuiltCoverage(s.campus.features.map((f) => f.properties));
    for (const f of s.campus.features) {
      const p = f.properties;
      const c = s.solar[p.osmId];
      const has = p.pv_fraction > 0;
      if (!c) continue;
      const realFrac = has ? cov : 0;
      const name = p.short.replace(/^Edifici\s+/, '');
      if (c.on !== has || Math.abs(c.fraction - realFrac) > 1e-6) {
        const pct = (v: number) => `${(v * 100).toFixed(v < 0.1 ? 1 : 0)}%`;
        scenario.push({
          label: !c.on || c.fraction === 0 ? `Solar removed on ${name}` : `Solar on ${name}: roof ${pct(realFrac)} → ${pct(c.fraction)}`,
          target: p.osmId,
          kind: c.fraction > realFrac && c.on ? 'added' : 'changed',
        });
        simRoofs.push(p.osmId);
      } else if (c.tilt !== DEFAULT_TILT) {
        scenario.push({ label: `Solar tilt on ${name}: ${DEFAULT_TILT}° → ${c.tilt}°`, target: p.osmId, kind: 'changed' });
        simRoofs.push(p.osmId);
      }
    }
  }
  if (s.panelModel !== 'mono') scenario.push({ label: `Panel technology: ${PANEL_MODELS.find((m) => m.id === s.panelModel)?.name}`, kind: 'setting' });
  if (s.agent !== 'mpc') scenario.push({ label: s.agent === 'template' ? 'Template agent drives the battery' : 'Battery agent switched off', target: 'battery', kind: 'setting' });
  if (s.ageing) scenario.push({ label: 'Equipment ageing applied', kind: 'setting' });

  // faults, one entry each
  for (const id of s.faults.batteries) {
    const u = s.batteries.find((b) => b.id === id);
    if (u) scenario.push({ label: `Fault: ${modelOf(u).name} offline`, target: 'battery', kind: 'fault' });
  }
  for (const id of s.faults.roofs) {
    const p = s.campus?.features.find((f) => f.properties.osmId === id)?.properties;
    if (p) scenario.push({ label: `Fault: PV array on ${p.short.replace(/^Edifici\s+/, '')}`, target: id, kind: 'fault' });
  }
  for (const i of s.faults.cables) scenario.push({ label: `Fault: cable C-${String(i + 1).padStart(2, '0')} cut`, target: `cable:${i}`, kind: 'fault' });
  if (s.faults.outage) scenario.push({ label: `Fault: grid outage ${s.faults.outage.hours} h`, target: 'substation', kind: 'fault' });

  return { time, scenario, simRoofs, simUnits };
}

export const TIME_LABEL: Record<TimeMode, { label: string; hint: string; color: string }> = {
  live: { label: 'Live', hint: 'The timeline is at “now”: current measured state.', color: 'var(--ok)' },
  history: { label: 'History', hint: 'Measured data from the campus meters.', color: 'var(--muted)' },
  forecast: { label: 'Forecast', hint: 'Predicted demand and solar; the battery shows its planned action.', color: 'var(--accent)' },
};
