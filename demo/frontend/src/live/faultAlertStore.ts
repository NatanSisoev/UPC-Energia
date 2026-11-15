import { create } from 'zustand';
import { derived, useSim } from '../store/useSim';
import { modelOf } from '../sim/engine';
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
  set: (p: Partial<FaultAlertState>) => void;
}

export const useFaultAlerts = create<FaultAlertState>((set) => ({ shown: [], dismissed: false, notified: '', set: (p) => set(p) }));

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
