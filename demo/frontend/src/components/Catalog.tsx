import { useMemo, useState } from 'react';
import { Mail, Plus } from 'lucide-react';
import { BATTERY_MODELS, PANEL_MODELS } from '../data/catalogue';
import { derived, useSim } from '../store/useSim';
import { roofKwp } from '../sim/engine';
import { Seg } from './kit';

/**
 * Where "Ask budget" emails go. Left empty on purpose: the mail client opens with subject and body filled in and
 * the user picks the recipient. Set a supplier / UPC Sostenible address here to pre-fill it.
 */
export const BUDGET_EMAIL = '';

/** Coverage of the usable roof assumed for the "roof potential" figure (same as the "max" solar preset). */
const MAX_COVERAGE = 0.6;

export function mailto(subject: string, lines: string[]): string {
  return `mailto:${BUDGET_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.join('\n'))}`;
}

export function campusContext(): string[] {
  const d = derived.current;
  if (!d) return [];
  const peak = Math.max(...d.actual.load);
  const avg = d.actual.load.reduce((a, b) => a + b, 0) / d.actual.load.length;
  return ['Site: UPC Campus Nord, Barcelona.', `Reference week demand: average ${(avg / 1000).toFixed(2)} MW, peak ${(peak / 1000).toFixed(2)} MW.`, 'Existing PV plant: about 160 kWp.'];
}

/** Equipment catalog: solar panels and batteries, each with "Ask budget" (pre-filled email) and "Simulate" (add to the model). */
export default function Catalog() {
  const [tab, setTab] = useState<'solar' | 'battery'>('battery');
  const campus = useSim((s) => s.campus);
  const panelModel = useSim((s) => s.panelModel);
  const roofs = useMemo(() => (campus ? campus.features.map((f) => f.properties).filter((p) => p.pv_fraction > 0) : []), [campus]);
  const st = useSim.getState();

  return (
    <div>
      <div className="mb-3">
        <Seg
          label="Catalog"
          value={tab}
          onChange={setTab}
          options={[
            ['battery', 'Batteries'],
            ['solar', 'Solar panels'],
          ]}
        />
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {tab === 'solar' &&
          PANEL_MODELS.map((m) => {
            const kwp = roofs.reduce((a, p) => a + roofKwp(p, m.id), 0) * MAX_COVERAGE;
            return (
              <article key={m.id} className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-4">
                <div className="flex items-baseline justify-between gap-2">
                  <h4 className="text-[14px] font-semibold">{m.name}</h4>
                  {panelModel === m.id && <span className="badge badge-ok">in model</span>}
                </div>
                <dl className="mt-3 grid grid-cols-3 gap-3 text-[12px]">
                  <Spec k="Efficiency" v={`${m.efficiency}%`} />
                  <Spec k="Density" v={`${(m.kwm2 * 1000).toFixed(0)} W/m²`} />
                  <Spec k="Roof potential" v={`${kwp.toFixed(0)} kWp`} />
                </dl>
                <div className="mt-4 flex gap-2">
                  <a
                    className="btn-primary"
                    href={mailto(`Budget request: ${m.name} solar panels — UPC Campus Nord`, [
                      'Hello,',
                      '',
                      `We would like a budget for a rooftop PV installation with ${m.name} modules (${m.efficiency}% efficiency).`,
                      `Estimated size: up to ${kwp.toFixed(0)} kWp on ${roofs.length} suitable roofs.`,
                      ...campusContext(),
                      '',
                      'Please include supply, installation, inverters and an estimated timeline.',
                      '',
                      'Thank you.',
                    ])}
                  >
                    <Mail size={14} /> Ask budget
                  </a>
                  <button type="button" className="btn" onClick={() => st.setPanelModel(m.id)}>
                    Use in model
                  </button>
                </div>
              </article>
            );
          })}
        {tab === 'battery' &&
          BATTERY_MODELS.map((m) => (
            <article key={m.id} className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-4">
              <div className="flex items-baseline justify-between gap-2">
                <h4 className="text-[14px] font-semibold">{m.name}</h4>
                <span className="text-[11.5px] muted">{m.vendor}</span>
              </div>
              <p className="mt-1 text-[12px] muted">{m.note}</p>
              <dl className="mt-3 grid grid-cols-4 gap-2 text-[12px]">
                <Spec k="Energy" v={`${m.capacity.toFixed(2)} MWh`} />
                <Spec k="Power" v={`${m.power.toFixed(2)} MW`} />
                <Spec k="RTE" v={`${m.rte}%`} />
                <Spec k="Cycles" v={m.cycles.toLocaleString('en')} />
              </dl>
              <div className="mt-4 flex gap-2">
                <a
                  className="btn-primary"
                  href={mailto(`Budget request: ${m.name} battery (${m.vendor}) — UPC Campus Nord`, [
                    'Hello,',
                    '',
                    `We would like a budget for a ${m.name} battery storage system by ${m.vendor} (${m.capacity.toFixed(2)} MWh / ${m.power.toFixed(2)} MW, ${m.rte}% round-trip efficiency).`,
                    ...campusContext(),
                    '',
                    'Please include supply, installation, grid connection and maintenance.',
                    '',
                    'Thank you.',
                  ])}
                >
                  <Mail size={14} /> Ask budget
                </a>
                <button type="button" className="btn" onClick={() => st.installBattery(m.id)} title="Add one unit to the simulated campus">
                  <Plus size={14} /> Simulate
                </button>
              </div>
            </article>
          ))}
      </div>
      <p className="mt-3 text-[11.5px] faint">Specifications are indicative, rounded from public vendor data. Final sizing and prices come with the supplier's budget.</p>
    </div>
  );
}

function Spec({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-[10.5px] faint">{k}</dt>
      <dd className="tnum mt-0.5 font-medium">{v}</dd>
    </div>
  );
}
