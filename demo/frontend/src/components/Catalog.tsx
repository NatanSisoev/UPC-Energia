import { useMemo, useState } from 'react';
import { Mail, X } from 'lucide-react';
import { BATTERY_MODELS, PANEL_MODELS } from '../data/catalogue';
import { derived, useSim } from '../store/useSim';
import { roofKwp } from '../sim/engine';

/**
 * Where "Ask budget" emails go. Left empty on purpose: the mail client opens with subject and body filled in and
 * the user picks the recipient. Set a supplier / UPC Sostenible address here to pre-fill it.
 */
export const BUDGET_EMAIL = '';

/** Coverage of the usable roof assumed for the "roof potential" figure (same as the old "max" solar preset). */
const MAX_COVERAGE = 0.6;

function mailto(subject: string, lines: string[]): string {
  return `mailto:${BUDGET_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.join('\n'))}`;
}

function campusContext(): string[] {
  const d = derived.current;
  if (!d) return [];
  const peak = Math.max(...d.week.load);
  const avg = d.week.load.reduce((a, b) => a + b, 0) / d.week.load.length;
  return [
    'Site: UPC Campus Nord, Barcelona.',
    `Reference week demand: average ${(avg / 1000).toFixed(2)} MW, peak ${(peak / 1000).toFixed(2)} MW.`,
    'Existing PV plant: about 160 kWp.',
  ];
}

/** Solar & storage catalog: equipment cards with a one-click budget request (opens an email). */
export default function Catalog({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<'solar' | 'battery'>('solar');
  const campus = useSim((s) => s.campus);
  const roofs = useMemo(() => (campus ? campus.features.map((f) => f.properties).filter((p) => p.pv_fraction > 0) : []), [campus]);

  return (
    <div className="absolute inset-0 z-30 flex justify-end bg-black/20" onClick={onClose}>
      <div className="flex h-full w-[460px] max-w-full flex-col bg-white shadow-xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Solar and storage catalog">
        <div className="flex items-start justify-between border-b border-[#e3e6ea] px-6 py-5">
          <div>
            <div className="eyebrow">Catalog</div>
            <h2 className="mt-1 text-[20px] font-semibold text-[#1d1d1b]">Solar &amp; storage</h2>
            <p className="mt-1 text-[13px] text-[#5f6368]">Equipment that fits Campus Nord. Ask for a budget and we prepare the request for you.</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="flex gap-6 border-b border-[#e3e6ea] px-6">
          {(
            [
              ['solar', 'Solar panels'],
              ['battery', 'Batteries'],
            ] as const
          ).map(([k, l]) => (
            <button key={k} type="button" onClick={() => setTab(k)} className={`-mb-px border-b-2 py-3 text-[14px] ${tab === k ? 'border-[#007bc0] font-semibold text-[#007bc0]' : 'border-transparent text-[#5f6368] hover:text-[#1d1d1b]'}`}>
              {l}
            </button>
          ))}
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-6 py-5">
          {tab === 'solar' &&
            PANEL_MODELS.map((m) => {
              const kwp = roofs.reduce((a, p) => a + roofKwp(p, m.id), 0) * MAX_COVERAGE;
              return (
                <article key={m.id} className="rounded-lg border border-[#e3e6ea] p-4">
                  <h3 className="text-[15px] font-semibold text-[#1d1d1b]">{m.name}</h3>
                  <dl className="mt-3 grid grid-cols-3 gap-3 text-[12px]">
                    <Spec k="Efficiency" v={`${m.efficiency}%`} />
                    <Spec k="Power density" v={`${(m.kwm2 * 1000).toFixed(0)} W/m²`} />
                    <Spec k="Roof potential" v={`${kwp.toFixed(0)} kWp`} />
                  </dl>
                  <BudgetButton
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
                  />
                </article>
              );
            })}
          {tab === 'battery' &&
            BATTERY_MODELS.map((m) => (
              <article key={m.id} className="rounded-lg border border-[#e3e6ea] p-4">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="text-[15px] font-semibold text-[#1d1d1b]">{m.name}</h3>
                  <span className="text-[12px] text-[#5f6368]">{m.vendor}</span>
                </div>
                <p className="mt-1 text-[13px] text-[#5f6368]">{m.note}</p>
                <dl className="mt-3 grid grid-cols-4 gap-3 text-[12px]">
                  <Spec k="Energy" v={`${m.capacity.toFixed(2)} MWh`} />
                  <Spec k="Power" v={`${m.power.toFixed(2)} MW`} />
                  <Spec k="Round trip" v={`${m.rte}%`} />
                  <Spec k="Cycles" v={m.cycles.toLocaleString('en')} />
                </dl>
                <BudgetButton
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
                />
              </article>
            ))}
          <p className="text-[11px] text-[#80868b]">Specifications are indicative, rounded from public vendor data. Final sizing and prices come with the supplier's budget.</p>
        </div>
      </div>
    </div>
  );
}

function Spec({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-[#80868b]">{k}</dt>
      <dd className="tnum mt-0.5 font-semibold text-[#1d1d1b]">{v}</dd>
    </div>
  );
}

function BudgetButton({ href }: { href: string }) {
  return (
    <a href={href} className="btn-primary mt-4">
      <Mail size={15} /> Ask budget
    </a>
  );
}
