import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ArrowLeft, Mail, Plus } from 'lucide-react';
import { BATTERY_MODELS, PANEL_MODELS, SUBSTATION_POWER_LIMIT_MW } from '../data/catalogue';
import { useSim } from '../store/useSim';
import { roofKwp } from '../sim/engine';
import { useDark } from '../lib/theme';
import { Seg } from './kit';
import { campusContext, mailto } from './Catalog';
import { computeEconomics, CO2_EUR_PER_KG, LIFETIME_YEARS, type ItemEconomics, type Economics } from '../lib/payback';
import { BatteryArt, PanelArt, MiniBar, PaybackBar } from './CatalogueArt';
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
  const [tab, setTab] = useState<'battery' | 'solar'>(() => (new URLSearchParams(location.search).get('tab') === 'solar' ? 'solar' : 'battery')) // ?tab=solar deep link;
  const batteries = useSim((s) => s.batteries);
  const campus = useSim((s) => s.campus);
  const panelModel = useSim((s) => s.panelModel);
  const installBattery = useSim((s) => s.installBattery);
  const setPanelModel = useSim((s) => s.setPanelModel);
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
              const on = panelModel === m.id;
              return (
                <article key={m.id} className="flex flex-col rounded-[10px] border bg-[var(--surface)] p-4" style={{ borderColor: on ? 'var(--accent)' : 'var(--border)' }}>
                  <div className="mb-3 rounded-md bg-[var(--surface-2)] px-2 py-2">
                    <PanelArt id={m.id} accent={m.accent} />
                  </div>
                  <div className="flex items-baseline justify-between gap-2">
                    <h3 className="text-[14px] font-semibold">{m.name}</h3>
                    {on && <span className="badge badge-ok">in model</span>}
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
                  <div className="mt-4 flex gap-2">
                    <button type="button" className="btn" disabled={on} onClick={() => setPanelModel(m.id)}>
                      {on ? 'Used in model' : 'Use in model'}
                    </button>
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
                  </div>
                </article>
              );
            })}
          </div>
        )}
        <p className="mt-4 text-[11.5px] faint">
          Savings are {eco ? `estimated from ${eco.weeks} representative weeks (of ${eco.of} replayed), scaled to 52 weeks` : 'being estimated'}: grid cost avoided plus CO₂ avoided valued at {(CO2_EUR_PER_KG * 1000).toFixed(0)} €/t.
          {tab === 'battery' ? ' Each battery is simulated alone with the MPC agent.' : ' Panels are priced and simulated for the whole usable roof (60 % coverage) on top of the existing plant.'} Payback is price ÷ annual saving, without financing, degradation or tariff changes.
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

function Spec({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-[10.5px] faint">{k}</dt>
      <dd className="tnum mt-0.5 font-medium">{v}</dd>
    </div>
  );
}
