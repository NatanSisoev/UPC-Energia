import { create } from 'zustand';
import { derived, useSim } from '../store/useSim';
import { modelOf } from '../sim/engine';
import type { Alarm } from '../lib/alarms';
import { FAULT_PLAYBOOK, type FaultType } from '../data/faultPlaybook';

/** A manually simulated fault that is currently active. */
export interface Incident {
  key: string;
  title: string;
  line: string;
  type: FaultType;
  asset: string;
  /** simulated clock when it was raised */
  at: string;
}

interface FaultAlertState {
  shown: Incident[];
  /** user closed the banner (the panel/e-mail status stay available while faults are active) */
  dismissed: boolean;
  notified: string;
  /** incidents built from alarms that are not manual faults (price spike, over-demand...) so the panel can still show them */
  extra: Incident[];
  /** incident the panel should highlight */
  focus: string | null;
  /** bumped on every openFaultPanel call; App opens the sidebar on change (never toggles) */
  openReq: number;
  set: (p: Partial<FaultAlertState>) => void;
}

export const useFaultAlerts = create<FaultAlertState>((set) => ({ shown: [], dismissed: false, notified: '', extra: [], focus: null, openReq: 0, set: (p) => set(p) }));

/**
 * Single entry point to open the fault panel (banner, alarm list, map chip, timeline marks).
 * Opens (never toggles) the panel for the alarm/fault, and centres the map on its asset when it has one.
 */
export function openFaultPanel(alarm?: Alarm | null): void {
  const st = useFaultAlerts.getState();
  let focus: string | null = st.shown[0]?.key ?? null;
  let extra = st.extra;
  if (alarm) {
    focus = alarm.id;
    if (!st.shown.some((i) => i.key === alarm.id)) {
      const type: FaultType = alarm.id.startsWith('bat-') ? 'battery' : alarm.id.startsWith('pv-') ? 'pv' : alarm.id === 'outage' ? 'outage' : alarm.target === 'substation' ? 'substation' : 'generic';
      const inc: Incident = { key: alarm.id, title: alarm.title, line: alarm.detail, type, asset: alarm.target && alarm.target !== 'battery' && alarm.target !== 'substation' ? (useSim.getState().campus?.features.find((f) => f.properties.osmId === alarm.target)?.properties.short ?? alarm.target) : alarm.target ?? 'Campus', at: simClock() };
      extra = [inc, ...extra.filter((i) => i.key !== inc.key)].slice(0, 8);
    }
    // centre the map on the affected asset (existing click-to-focus); the fault panel then wins the sidebar
    if (alarm.target && alarm.target !== 'battery' && alarm.target !== 'substation') useSim.getState().select(alarm.target);
  }
  st.set({ extra, focus, openReq: st.openReq + 1 });
}

export const TECH_PHONE = (import.meta.env.VITE_TECH_PHONE as string | undefined)?.trim() ?? '';
export const TECH_EMAIL = (import.meta.env.VITE_TECH_EMAIL as string | undefined)?.trim() ?? '';

export const solutionOf = (i: Incident) => FAULT_PLAYBOOK[i.type].solution.join(' ');

export function simClock(): string {
  const st = useSim.getState();
  const d = derived.current;
  if (!st.snap || !d) return 'unknown time';
  const t = new Date(d.week.ms[st.snap.hour]);
  return `${t.toISOString().slice(0, 10)} ${String(t.getUTCHours()).padStart(2, '0')}:00`;
}

/** Fault keys currently active, with a human description. */
export function activeFaults(): Map<string, Omit<Incident, 'at'>> {
  const s = useSim.getState();
  const out = new Map<string, Omit<Incident, 'at'>>();
  for (const id of s.faults.batteries) {
    const u = s.batteries.find((b) => b.id === id);
    if (!u) continue;
    const name = modelOf(u).name;
    out.set(`bat-${id}`, { key: `bat-${id}`, type: 'battery', asset: name, title: `Battery offline: ${name}`, line: `Battery unit "${name}" (${u.capacity.toFixed(2)} MWh / ${u.power.toFixed(2)} MW) is offline.` });
  }
  for (const id of s.faults.roofs) {
    const p = s.campus?.features.find((f) => f.properties.osmId === id)?.properties;
    if (!p) continue;
    out.set(`pv-${id}`, { key: `pv-${id}`, type: 'pv', asset: p.short, title: `Solar array fault: ${p.short}`, line: `Solar array on ${p.short} reports no output (inverter fault).` });
  }
  const o = s.faults.outage;
  if (o) out.set('outage', { key: 'outage', type: 'outage', asset: 'Grid supply', title: `Grid outage (${o.hours} h)`, line: `Grid outage of ${o.hours} h (substation / supply lost).` });
  return out;
}

/** mailto: prefilled with fault, asset, simulated time and the proposed solution. */
export function mailto(items: Incident[]): string {
  const subject = `SIMULATED fault: ${items.map((i) => i.title).join('; ')}`;
  const body = `${items.map((i) => `Fault: ${FAULT_PLAYBOOK[i.type].label}\nAsset: ${i.asset}\nSimulated time: ${i.at}\nProposed solution: ${solutionOf(i)}`).join('\n\n')}\n\n(Simulated fault from the UPC Campus Nord energy twin.)`;
  return `mailto:${TECH_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
