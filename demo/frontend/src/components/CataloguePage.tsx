import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ArrowLeft, Mail, Plus } from 'lucide-react';
import { BATTERY_MODELS, CABLE_MODELS, PANEL_MODELS, SUBSTATION_POWER_LIMIT_MW, cableMva } from '../data/catalogue';
import type { BuildingProps, PanelModelId } from '../types';
import { useSim } from '../store/useSim';
import { installedKwp, roofKwp, DEFAULT_TILT } from '../sim/engine';
import { useDark } from '../lib/theme';
import { Seg } from './kit';
import { campusContext } from './Catalog';
import { sendBudgetRequest } from '../lib/budget';
import { computeEconomics, CO2_EUR_PER_KG, LIFETIME_YEARS, type ItemEconomics, type Economics } from '../lib/payback';
import { BatteryArt, CableArt, PanelArt, MiniBar, PaybackBar } from './CatalogueArt';
import { fmtEur } from '../lib/format';

/** Roof coverage assumed for the "roof potential" figure (same as the "max" solar preset). */
const MAX_COVERAGE = 0.6;

/**
 * Separate catalogue page: batteries (add to the simulated yard, limited by the substation connection) and solar
 * panels (choose the module technology used by the model). The simulation state lives in the zustand store, so it
 * survives navigating here and back.
 */
export default function CataloguePage() {
  useDark(); // keeps <html data-theme> in sync on this route too
  useEffect(() => {
    if (!useSim.getState().campus) void useSim.getState().load(); // direct visit: the map page has not loaded the data
  }, []);
  const [tab, setTab] = useState<'battery' | 'solar' | 'cable'>(() => {
    const t = new URLSearchParams(location.search).get('tab');
    return t === 'solar' || t === 'cable' ? t : 'battery';
  }) // ?tab=solar deep link;
  const batteries = useSim((s) => s.batteries);
  const campus = useSim((s) => s.campus);
  const panelModel = useSim((s) => s.panelModel);
  const installBattery = useSim((s) => s.installBattery);
  const setPanelModel = useSim((s) => s.setPanelModel);
  const solarCfg = useSim((s) => s.solar);
  const [picking, setPicking] = useState<PanelModelId | null>(null); // which module card has its building picker open
  const roofs = useMemo(() => (campus ? campus.features.map((f) => f.properties).filter((p) => p.pv_fraction > 0) : []), [campus]);
  const replay = useSim((s) => s.replay);
  const [eco, setEco] = useState<Economics | null>(null);
  useEffect(() => {
    if (!replay || !roofs.length) return;
    let live = true;
    void computeEconomics(replay, roofs).then((e) => live && setEco(e));
    return () => {
      live = false;
    };
  }, [replay, roofs]);
  const maxMwh = Math.max(...BATTERY_MODELS.map((m) => m.capacity));
  const maxEff = Math.max(...PANEL_MODELS.map((m) => m.efficiency));
  const usedMw = batteries.reduce((a, b) => a + b.power, 0);
  const usedMwh = batteries.reduce((a, b) => a + b.capacity, 0);

  return (
    <div className="h-full w-full overflow-y-auto bg-[var(--bg)]">
      <div className="mx-auto max-w-[1100px] px-5 py-5">
        <Link to="/" className="btn !py-1 !text-[12px]">
          <ArrowLeft size={13} /> Back to the map
        </Link>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="eyebrow">Equipment</div>
            <h1 className="text-[22px] font-semibold">Catalogue</h1>
          </div>
          <Seg
            label="Catalogue section"
            value={tab}
            onChange={setTab}
            options={[
              ['battery', 'Batteries'],
              ['solar', 'Solar panels'],
              ['cable', 'Cables'],
            ]}
          />
        </div>

        {tab === 'battery' && (
          <>
            <div className="mt-4 flex flex-wrap gap-x-8 gap-y-1 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-[12.5px]">
              <span>
                <span className="faint">Yard connection </span>
                <b className="tnum">
                  {usedMw.toFixed(2)} / {SUBSTATION_POWER_LIMIT_MW.toFixed(1)} MW
                </b>
              </span>
              <span>
                <span className="faint">Installed </span>
                <b className="tnum">{usedMwh.toFixed(2)} MWh</b>
              </span>
              <span className="faint">
                {batteries.length} unit{batteries.length === 1 ? '' : 's'} in the simulated yard
              </span>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
              {BATTERY_MODELS.filter((m) => m.id !== 'challenge').map((m) => {
                const over = usedMw + m.power > SUBSTATION_POWER_LIMIT_MW;
                return (
                  <article key={m.id} className={`flex flex-col rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-4 ${over ? 'opacity-60' : ''}`}>
                    <div className="mb-3 rounded-md bg-[var(--surface-2)] px-2 py-2">
                      <BatteryArt mwh={m.capacity} maxMwh={maxMwh} accent={m.accent} />
                    </div>
                    <div className="flex items-baseline justify-between gap-2">
                      <h3 className="text-[14px] font-semibold">{m.name}</h3>
                      <span className="text-[11.5px] muted">{m.vendor}</span>
                    </div>
                    <p className="mt-1 flex-1 text-[12px] muted">{m.note}</p>
                    <dl className="mt-3 grid grid-cols-4 gap-2 text-[12px]">
                      <Spec k="Energy" v={`${m.capacity.toFixed(2)} MWh`} />
                      <Spec k="Power" v={`${m.power.toFixed(2)} MW`} />
                      <Spec k="RTE" v={`${m.rte}%`} />
                      <Spec k="Cycles" v={m.cycles.toLocaleString('en')} />
                    </dl>
                    <div className="mt-3">
                      <MiniBar label="Energy vs largest unit" right={`${m.capacity.toFixed(2)} / ${maxMwh.toFixed(2)} MWh`} value={m.capacity} max={maxMwh} color={m.accent} />
                    </div>
                    <Econ e={eco?.battery[m.id]} life={LIFETIME_YEARS.battery} />
                    <div className="mt-4 flex gap-2">
                      <button type="button" className="btn" disabled={over} onClick={() => installBattery(m.id)} title={over ? 'Exceeds the substation connection limit' : 'Add one unit to the simulated campus'}>
                        <Plus size={14} /> Add to yard
                      </button>
                      <button type="button" data-budget className="btn-primary" onClick={() => void sendBudgetRequest(`Budget request: ${m.name} battery (${m.vendor}) — UPC Campus Nord`, [
                          'Hello,',
                          '',
                          `We would like a budget for a ${m.name} battery storage system by ${m.vendor} (${m.capacity.toFixed(2)} MWh / ${m.power.toFixed(2)} MW, ${m.rte}% round-trip efficiency).`,
                          ...campusContext(),
                          '',
                          'Please include supply, installation, grid connection and maintenance.',
                          '',
                          'Thank you.',
                        ])}>
                        <Mail size={14} /> Ask budget
                      </button>
                    </div>
                    {over && <div className="mt-2 text-[11px] faint">Exceeds the {SUBSTATION_POWER_LIMIT_MW.toFixed(1)} MW connection limit.</div>}
                  </article>
                );
              })}
            </div>
          </>
        )}

        {tab === 'solar' && (
          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {PANEL_MODELS.map((m) => {
              const kwp = roofs.reduce((a, p) => a + roofKwp(p, m.id), 0) * MAX_COVERAGE;
              const roofsOn = roofs.filter((p) => (solarCfg[p.osmId]?.model ?? panelModel) === m.id).length;
              const on = roofsOn === roofs.length;
              return (
                <article key={m.id} className="flex flex-col rounded-[10px] border bg-[var(--surface)] p-4" style={{ borderColor: on ? 'var(--accent)' : 'var(--border)' }}>
                  <div className="mb-3 rounded-md bg-[var(--surface-2)] px-2 py-2">
                    <PanelArt id={m.id} accent={m.accent} />
                  </div>
                  <div className="flex items-baseline justify-between gap-2">
                    <h3 className="text-[14px] font-semibold">{m.name}</h3>
                    {roofsOn > 0 && <span className="badge badge-ok">{on ? 'on all roofs' : `on ${roofsOn} roof${roofsOn === 1 ? '' : 's'}`}</span>}
                  </div>
                  <dl className="mt-3 grid flex-1 grid-cols-3 gap-3 text-[12px]">
                    <Spec k="Efficiency" v={`${m.efficiency}%`} />
                    <Spec k="Density" v={`${(m.kwm2 * 1000).toFixed(0)} W/m²`} />
                    <Spec k="Roof potential" v={`${kwp.toFixed(0)} kWp`} />
                  </dl>
                  <div className="mt-3">
                    <MiniBar label="Module efficiency" right={`${m.efficiency}%`} value={m.efficiency} max={maxEff * 1.1} color={m.accent} />
                  </div>
                  <Econ e={eco?.solar[m.id]} life={LIFETIME_YEARS.solar} />
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button type="button" className="btn" disabled={on} onClick={() => setPanelModel(m.id)} title="Replace the panel technology on every roof">
                      {on ? 'On all roofs' : 'Swap all roofs'}
                    </button>
                    <button type="button" className={`btn ${picking === m.id ? 'btn-on' : ''}`} onClick={() => setPicking(picking === m.id ? null : m.id)} aria-expanded={picking === m.id} title="Pick which buildings get these panels">
                      Choose buildings…
                    </button>
                    <button type="button" data-budget className="btn-primary" onClick={() => void sendBudgetRequest(`Budget request: ${m.name} solar panels — UPC Campus Nord`, [
                        'Hello,',
                        '',
                        `We would like a budget for a rooftop PV installation with ${m.name} modules (${m.efficiency}% efficiency).`,
                        `Estimated size: up to ${kwp.toFixed(0)} kWp on ${roofs.length} suitable roofs.`,
                        ...campusContext(),
                        '',
                        'Please include supply, installation, inverters and an estimated timeline.',
                        '',
                        'Thank you.',
                      ])}>
                      <Mail size={14} /> Ask budget
                    </button>
                  </div>
                  {picking === m.id && <RoofPicker model={m.id} roofs={roofs} onDone={() => setPicking(null)} />}
                </article>
              );
            })}
          </div>
        )}

        {tab === 'cable' && (
          <>
            <p className="mt-4 text-[12.5px] muted">Cables of the campus network by level: low-voltage building feeders, the 20 kV ring and the DC strings on the roofs. Capacity is what a cable carries continuously; a 500 kW battery needs at least 0.5 MVA on its link.</p>
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
              {CABLE_MODELS.map((c) => {
                const mva = cableMva(c);
                const fitsBattery = c.level !== 'DC' && mva >= 0.5;
                const maxMva = Math.max(...CABLE_MODELS.filter((x) => x.level === c.level).map(cableMva));
                const lossKwKm = ((c.level === 'DC' ? 2 : 3) * c.rOhmKm * c.ampacityA ** 2) / 1000;
                return (
                  <article key={c.id} className="flex flex-col rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-4">
                    <div className="mb-3 rounded-md bg-[var(--surface-2)] px-2 py-2">
                      <CableArt cores={c.id.includes('2x') ? 2 : c.level === 'DC' ? 1 : c.level === 'LV' ? 4 : 3} accent={c.accent} level={c.level} />
                    </div>
                    <div className="flex items-baseline justify-between gap-2">
                      <h3 className="text-[14px] font-semibold">{c.name}</h3>
                      <span className="badge">{c.level}</span>
                    </div>
                    <p className="mt-1 flex-1 text-[12px] muted">{c.note}</p>
                    <dl className="mt-3 grid grid-cols-4 gap-2 text-[12px]">
                      <Spec k="Voltage" v={`${c.voltageKv} kV`} />
                      <Spec k="Current" v={`${c.ampacityA} A`} />
                      <Spec k="Capacity" v={`${mva >= 1 ? mva.toFixed(1) : mva.toFixed(2)} ${c.level === 'DC' ? 'MW' : 'MVA'}`} />
                      <Spec k="Loss, rated" v={`${lossKwKm.toFixed(0)} kW/km`} />
                    </dl>
                    <div className="mt-3">
                      <MiniBar label={`Capacity vs largest ${c.level}`} right={`${mva.toFixed(2)} / ${maxMva.toFixed(2)}`} value={mva} max={maxMva} color={c.accent} />
                    </div>
                    <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-[var(--border)] pt-3 text-[12px]">
                      <Spec k="Conductor" v={`${c.conductor} ${c.section}`} />
                      <Spec k="Per 100 m" v={fmtEur(c.eurPerM * 100)} />
                      <Spec k="Per metre" v={`€${c.eurPerM}`} />
                    </dl>
                    {fitsBattery && <span className="badge badge-ok mt-2 self-start">Carries a 500 kW battery</span>}
                    <div className="mt-4 flex gap-2">
                      <button type="button" data-budget className="btn-primary" onClick={() => void sendBudgetRequest(`Budget request: ${c.name} cable — UPC Campus Nord`, [
                          'Hello,',
                          '',
                          `We would like a budget for ${c.name} cable (${c.section}, ${c.voltageKv} kV, ${c.ampacityA} A).`,
                          ...campusContext(),
                          '',
                          'Please include supply, trenching, terminations and testing, and tell us the lead time.',
                          '',
                          'Thank you.',
                        ])}>
                        <Mail size={14} /> Ask budget
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
            <p className="mt-4 text-[11.5px] faint">Prices are indicative installed costs (cable, trench and joints) per metre; the map's cables are drawn for the flows, not sized from this list.</p>
          </>
        )}
        <p className="mt-4 text-[11.5px] faint">
          Savings are {eco ? `estimated from ${eco.weeks} representative weeks (of ${eco.of} replayed), scaled to 52 weeks` : 'being estimated'}: grid cost avoided plus CO₂ avoided valued at {(CO2_EUR_PER_KG * 1000).toFixed(0)} €/t.
          {tab === 'cable' ? '' : `${tab === 'battery' ? ' Each battery is simulated alone with the MPC agent.' : ' Panels are priced and simulated for the whole usable roof (60 % coverage) on top of the existing plant.'} Payback is price ÷ annual saving, without financing, degradation or tariff changes.`}
        </p>
        <p className="mt-2 text-[11.5px] faint">Specifications are indicative, rounded from public vendor data. Final sizing and prices come with the supplier's budget.</p>
      </div>
    </div>
  );
}

function Econ({ e, life }: { e?: ItemEconomics & { kwp?: number }; life: number }) {
  if (!e) return <div className="mt-3 border-t border-[var(--border)] pt-3 text-[11.5px] faint">Estimating payback…</div>;
  const yrs = e.paybackYears;
  return (
    <div className="mt-3 border-t border-[var(--border)] pt-3">
      <dl className="grid grid-cols-3 gap-2 text-[12px]">
        <Spec k={e.kwp ? `Price (${e.kwp.toFixed(0)} kWp)` : 'Price'} v={fmtEur(e.priceEur)} />
        <Spec k="Saving / year" v={fmtEur(e.annualSavingEur)} />
        <Spec k="Payback" v={Number.isFinite(yrs) ? `${yrs.toFixed(1)} yr` : '—'} />
      </dl>
      <PaybackBar years={yrs} life={life} pays={e.pays} />
      <span className={`badge mt-2 ${e.pays ? 'badge-ok' : ''}`} style={e.pays ? undefined : { color: 'var(--danger)' }}>
        {e.pays ? `Pays back within ${life} yr` : `Does not pay back within ${life} yr`}
      </span>
    </div>
  );
}

/** Per-card building picker: choose the roofs that get this module, replacing the panels there or filling the roof. */
function RoofPicker({ model, roofs, onDone }: { model: PanelModelId; roofs: BuildingProps[]; onDone: () => void }) {
  const solar = useSim((s) => s.solar);
  const panelModel = useSim((s) => s.panelModel);
  const apply = useSim((s) => s.applyPanels);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const sorted = useMemo(() => [...roofs].sort((a, b) => b.area_m2 * b.pv_fraction - a.area_m2 * a.pv_fraction), [roofs]);
  const cfgOf = (p: BuildingProps) => solar[p.osmId] ?? { on: false, fraction: 0, tilt: DEFAULT_TILT };
  const nameOf = (id: PanelModelId) => PANEL_MODELS.find((x) => x.id === id)!.name.split(' ').slice(0, 2).join(' ');
  const chosen = sorted.filter((p) => sel.has(p.osmId));
  const now = chosen.reduce((a, p) => a + installedKwp(p, cfgOf(p), panelModel), 0);
  const after = (fill: boolean) =>
    chosen.reduce((a, p) => {
      const c = cfgOf(p);
      const frac = fill ? Math.max(c.fraction, MAX_COVERAGE) : c.on && c.fraction > 0 ? c.fraction : MAX_COVERAGE;
      return a + roofKwp(p, model) * frac;
    }, 0);
  const toggle = (id: string) =>
    setSel((x) => {
      const n = new Set(x);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const go = (fill: boolean) => {
    apply([...sel], model, fill ? MAX_COVERAGE : null);
    onDone();
  };
  return (
    <div className="mt-3 rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-3">
      <div className="mb-2 flex items-center justify-between text-[12px]">
        <b>Where to install</b>
        <span className="flex gap-3">
          <button type="button" className="muted hover:text-[var(--accent)]" onClick={() => setSel(new Set(sorted.map((p) => p.osmId)))}>
            All
          </button>
          <button type="button" className="muted hover:text-[var(--accent)]" onClick={() => setSel(new Set())}>
            None
          </button>
        </span>
      </div>
      <ul className="max-h-52 overflow-y-auto pr-1 text-[12px]">
        {sorted.map((p) => {
          const c = cfgOf(p);
          const cur = c.on && c.fraction > 0 ? `${nameOf(c.model ?? panelModel)} · ${installedKwp(p, c, panelModel).toFixed(0)} kWp` : 'no panels';
          return (
            <li key={p.osmId}>
              <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-[var(--surface-3)]">
                <input type="checkbox" checked={sel.has(p.osmId)} onChange={() => toggle(p.osmId)} />
                <span className="min-w-0 flex-1 truncate">{p.short || p.name}</span>
                <span className="shrink-0 faint">{cur}</span>
              </label>
            </li>
          );
        })}
      </ul>
      <div className="tnum mt-2 text-[11.5px] muted">
        {chosen.length === 0 ? 'Tick the buildings to change.' : `${chosen.length} building${chosen.length === 1 ? '' : 's'}: ${now.toFixed(0)} kWp now → ${after(false).toFixed(0)} kWp (replace) or ${after(true).toFixed(0)} kWp (fill roof)`}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className="btn !py-1 !text-[12px]" disabled={!chosen.length} onClick={() => go(false)} title="Swap the existing panels for this module, keeping the covered area (empty roofs get a full install)">
          Replace panels
        </button>
        <button type="button" className="btn-primary !py-1 !text-[12px]" disabled={!chosen.length} onClick={() => go(true)} title="Replace and cover the whole usable roof, adding more panels">
          Replace + fill roof
        </button>
      </div>
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
