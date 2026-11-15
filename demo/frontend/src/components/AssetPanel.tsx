import { Plus, Store, X } from 'lucide-react';
import { Link } from 'react-router';
import { BATTERY_MODELS, SUBSTATION_POWER_LIMIT_MW } from '../data/catalogue';
import { derived, useSim } from '../store/useSim';
import { batterySheet, cableRatingKw, cableSheet, gradeColor, pvSheet, substationSheet, type AssetSheet } from '../data/assets';
import { cableMixAt, cableSeries } from '../lib/cables';
import SupplyBar from './SupplyBar';
import FlowHistory from './FlowHistory';
import { modelOf } from '../sim/engine';
import { cableFlow } from '../scene/minimal';
import { useAlarms } from '../lib/alarms';
import { fmtKw } from '../lib/format';

/**
 * Sidebar for non-building equipment: the battery yard (one sheet per unit), the substation, a cable segment or a
 * roof PV array. Each sheet shows type, specification, age and condition (ageing models in data/assets.ts).
 */
export default function AssetPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const st = useSim();
  const snap = st.snap;
  const alarms = useAlarms();
  const d = derived.current;
  if (!snap || !d) return null;

  let title = '';
  let subtitle = '';
  let sheets: AssetSheet[] = [];
  let live: Array<[string, string]> = [];
  let extra: React.ReactNode = null;
  /** quick-add control rendered right under the installed battery list */
  let addPanel: React.ReactNode = null;
  /** week history of the power through this equipment */
  let history: React.ReactNode = null;
  /** grid / battery / solar share of the power through a cable */
  let sources: React.ReactNode = null;
  const ORANGE = { label: 'From the grid', color: 'rgb(236,118,56)' };
  const target = id.startsWith('pv:') ? id.slice(3) : id;
  const mine = alarms.filter((a) => a.target === target);

  if (id === 'battery') {
    title = 'Battery yard';
    subtitle = `${st.batteries.length} unit${st.batteries.length === 1 ? '' : 's'} · ${st.batteries.reduce((a, b) => a + b.capacity, 0).toFixed(2)} MWh installed`;
    sheets = st.batteries.map((u) => batterySheet(u, st.faults.batteries.includes(u.id)));
    live = [
      ['State', snap.battKw > 5 ? 'charging' : snap.battKw < -5 ? 'discharging' : 'idle'],
      ['Power', fmtKw(Math.abs(snap.battKw))],
      ['Charge', snap.capacityKwh > 0 ? `${(snap.soc * 100).toFixed(0)}% of ${(snap.capacityKwh / 1000).toFixed(2)} MWh` : '—'],
    ];
    history = (
      <FlowHistory
        series={Float64Array.from(d.chosen.sp)}
        pos={{ label: 'Charging', color: ORANGE.color }}
        neg={{ label: 'Discharging', color: 'rgb(16,170,170)' }}
        ratingKw={snap.ratedKw || undefined}
      />
    );
    // add more batteries to the yard (simulated units; the dispatcher treats the fleet as one battery)
    const totalMw = st.batteries.reduce((a, b) => a + b.power, 0);
    addPanel = (
      <section className="mb-4 rounded-[10px] border border-[var(--border)] p-3">
        <div className="mb-1 flex items-baseline justify-between">
          <div className="eyebrow">Add batteries to the yard</div>
          <span className="tnum text-[11px] muted">
            {totalMw.toFixed(1)} / {SUBSTATION_POWER_LIMIT_MW.toFixed(1)} MW connection
          </span>
        </div>
        <ul className="mb-2 grid gap-1">
          {BATTERY_MODELS.map((m) => {
            const over = totalMw + m.power > SUBSTATION_POWER_LIMIT_MW + 1e-9;
            return (
              <li key={m.id}>
                <button
                  type="button"
                  disabled={over}
                  onClick={() => st.installBattery(m.id)}
                  title={over ? 'Exceeds the substation connection limit' : 'Add one unit to the simulated campus'}
                  className="flex w-full items-center gap-2 rounded-md border border-[var(--border)] px-2.5 py-1.5 text-left text-[12px] hover:bg-[var(--surface-2)] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Plus size={13} className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate font-medium">{m.name}</span>
                  <span className="tnum muted">
                    {m.capacity.toFixed(2)} MWh · {m.power.toFixed(2)} MW
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <Link to="/catalogue" className="text-[11.5px] muted underline">
          <Store size={12} className="mr-1 inline" /> See all details, prices and payback
        </Link>
      </section>
    );
  } else if (id === 'substation') {
    title = 'Campus substation';
    subtitle = 'Connection to the distribution grid';
    const outage = !!st.faults.outage && snap.hour >= st.faults.outage.startH && snap.hour < st.faults.outage.startH + st.faults.outage.hours;
    sheets = [substationSheet(Math.max(...d.week.load), outage)];
    live = [
      [snap.gridKw >= 0 ? 'Import' : 'Export', fmtKw(Math.abs(snap.gridKw))],
      ['Without battery', fmtKw(Math.max(0, snap.baseGridKw))],
      ['Price · CO₂', `${snap.price.toFixed(3)} €/kWh · ${snap.co2.toFixed(3)} kg`],
    ];
    history = (
      <FlowHistory series={Float64Array.from(d.chosen.grid)} pos={{ label: 'Import', color: ORANGE.color }} neg={{ label: 'Export', color: 'rgb(64,176,96)' }} ratingKw={4500} />
    );
  } else if (id.startsWith('cable:')) {
    const i = +id.slice(6);
    const e = st.network?.edges[i];
    if (!e) return null;
    const flow = cableFlow(i);
    const to = st.network!.nodes[e.to];
    const fed = to.kind === 'bld' ? st.campus?.features[to.b]?.properties.short : to.kind === 'batt' ? 'battery yard' : null;
    sheets = [cableSheet({ i, len: e.len, down: e.down ?? 1, flowKw: flow })];
    title = sheets[0].title;
    subtitle = fed ? `Feeds ${fed}` : `Feeds ${e.down ?? 0} building${(e.down ?? 0) === 1 ? '' : 's'} downstream`;
    live = [
      ['Flow', fmtKw(Math.abs(flow))],
      ['Direction', Math.abs(flow) < 5 ? 'idle' : flow >= 0 ? 'towards buildings' : 'back towards substation'],
      ['Length', `${e.len.toFixed(0)} m`],
    ];
    history =
      to.kind === 'batt' ? (
        <FlowHistory series={cableSeries(i)} pos={{ label: 'To the battery', color: ORANGE.color }} neg={{ label: 'From the battery', color: 'rgb(16,170,170)' }} ratingKw={cableRatingKw(e.down ?? 1)} />
      ) : (
        <FlowHistory series={cableSeries(i)} pos={{ label: 'To buildings', color: ORANGE.color }} neg={{ label: 'Back-feed', color: 'rgb(64,176,96)' }} ratingKw={cableRatingKw(e.down ?? 1)} />
      );
    // source breakdown: this hour and the week's energy
    const n = d.week.load.length;
    const hNow = Math.min(n - 1, Math.floor(st.tMin / 60));
    const week = { grid: 0, battery: 0, solar: 0, load: 0 };
    for (let h = 0; h < n; h++) {
      const m = cableMixAt(i, h);
      week.grid += m.grid;
      week.battery += m.battery;
      week.solar += m.solar;
      week.load += m.load;
    }
    sources = (
      <section className="mb-5">
        <div className="eyebrow mb-2">Where the power comes from</div>
        <div className="mb-1 flex justify-between text-[11px] muted">
          <span>Now</span>
        </div>
        <SupplyBar mix={cableMixAt(i, hNow)} />
        <div className="mb-1 mt-3 flex justify-between text-[11px] muted">
          <span>This week (energy)</span>
          <span className="tnum">{week.load >= 1000 ? `${(week.load / 1000).toFixed(1)} MWh` : `${week.load.toFixed(0)} kWh`}</span>
        </div>
        <SupplyBar mix={week} fmt={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)} MWh` : `${v.toFixed(0)} kWh`)} />
        <div className="mt-2 text-[10.5px] faint">Estimate: the cable network is shared, so a feeder carries the network's mix of each hour (grid import, battery discharge, rooftop solar pushed back by other buildings).</div>
      </section>
    );
    if (to.kind === 'bld') {
      const bid = st.campus!.features[to.b].properties.osmId;
      extra = (
        <button type="button" className="btn mt-1 !py-1 !text-[12px]" onClick={() => useSim.getState().select(bid)}>
          Open {fed}
        </button>
      );
    }
  } else if (id.startsWith('pv:')) {
    const p = st.campus?.features.find((f) => f.properties.osmId === target)?.properties;
    if (!p) return null;
    const broken = st.faults.roofs.includes(target);
    sheets = [pvSheet(p, st.solar[target], st.panelModel, broken)];
    title = sheets[0].title;
    subtitle = p.name;
    live = [
      ['Output now', fmtKw(snap.perB[target]?.solarKw ?? 0)],
      ['Building demand', fmtKw(snap.perB[target]?.loadKw ?? 0)],
    ];
    extra = (
      <div className="mt-1 flex gap-2">
        <button type="button" className={`btn !py-1 !text-[12px] ${broken ? '' : 'btn-danger'}`} onClick={() => st.setFaults({ roofs: broken ? st.faults.roofs.filter((x) => x !== target) : [...st.faults.roofs, target] })}>
          {broken ? 'Mark repaired' : 'Simulate fault'}
        </button>
        <button type="button" className="btn !py-1 !text-[12px]" onClick={() => useSim.getState().select(target)}>
          Open building
        </button>
      </div>
    );
  }

  return (
    <aside className="fade-in flex h-full w-full flex-col border-l border-[var(--border)] bg-[var(--surface)]">
      <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-5 py-3.5">
        <div className="min-w-0">
          <div className="eyebrow">Equipment</div>
          <h2 className="mt-0.5 truncate text-[17px] font-semibold">{title}</h2>
          <div className="truncate text-[12px] muted">{subtitle}</div>
        </div>
        <button type="button" className="icon-btn !h-7 !w-7" onClick={onClose} aria-label="Close">
          <X size={14} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <div className="mb-4 grid grid-cols-3 gap-2">
          {live.map(([k, v]) => (
            <div key={k} className="rounded-md bg-[var(--surface-2)] px-2.5 py-2">
              <div className="eyebrow !text-[9px]">{k}</div>
              <div className="tnum mt-0.5 text-[12.5px] font-medium">{v}</div>
            </div>
          ))}
        </div>
        {extra && <div className="mb-4">{extra}</div>}
        {sources}
        {history && (
          <section className="mb-5">
            <div className="eyebrow mb-2">History · power through it</div>
            {history}
          </section>
        )}

        {sheets.map((s, i) => {
          const unit = id === 'battery' ? st.batteries[i] : null;
          const broken = unit ? st.faults.batteries.includes(unit.id) : false;
          return (
            <section key={i} className="mb-4 rounded-[10px] border border-[var(--border)] p-3.5" style={unit && !unit.asBuilt ? { borderColor: 'var(--violet)' } : undefined}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <b className="truncate text-[14px]">{unit ? modelOf(unit).name : s.title}</b>
                    {unit && !unit.asBuilt && <span className="badge" style={{ color: 'var(--violet)', background: 'color-mix(in srgb, var(--violet) 12%, transparent)' }}>simulated</span>}
                  </div>
                  <div className="text-[11.5px] muted">{s.type}</div>
                </div>
                <span className="badge" style={{ color: gradeColor(s.condition.grade), background: 'var(--surface-2)' }}>
                  {s.condition.grade}
                </span>
              </div>
              {/* condition bar */}
              <div className="mt-2.5">
                <div className="mb-1 flex justify-between text-[11px] muted">
                  <span>Condition</span>
                  <span className="tnum">{(s.condition.health * 100).toFixed(0)}%</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-3)]">
                  <div className="h-full rounded-full" style={{ width: `${s.condition.health * 100}%`, background: gradeColor(s.condition.grade) }} />
                </div>
                <div className="mt-1 text-[11.5px] muted">{s.condition.note}</div>
              </div>
              <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[12px]">
                {s.specs.map((r) => (
                  <div key={r.k} className="contents">
                    <dt className="faint">{r.k}</dt>
                    <dd className="tnum">{r.v}</dd>
                  </div>
                ))}
              </dl>
              {unit && (
                <div className="mt-3 flex gap-2">
                  <button type="button" className={`btn !py-1 !text-[12px] ${broken ? '' : 'btn-danger'}`} onClick={() => st.setFaults({ batteries: broken ? st.faults.batteries.filter((x) => x !== unit.id) : [...st.faults.batteries, unit.id] })}>
                    {broken ? 'Mark repaired' : 'Simulate fault'}
                  </button>
                  {!unit.asBuilt && (
                    <button type="button" className="btn !py-1 !text-[12px]" onClick={() => st.removeBattery(unit.id)}>
                      Remove
                    </button>
                  )}
                </div>
              )}
              {s.estimated && <div className="mt-2 text-[10.5px] faint">Age and specifications are estimates (no asset register in the challenge data).</div>}
            </section>
          );
        })}

        {addPanel}

        {mine.length > 0 && (
          <section>
            <div className="eyebrow mb-1.5">Alarms</div>
            {mine.map((a) => (
              <div key={a.id} className="mb-1.5 rounded-md border border-[var(--border)] px-2.5 py-1.5 text-[12px]">
                <b>{a.title}</b>
                <div className="muted">{a.detail}</div>
              </div>
            ))}
          </section>
        )}
      </div>
    </aside>
  );
}
