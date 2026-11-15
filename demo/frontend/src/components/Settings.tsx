import { useState, type ReactNode } from 'react';
import { BatteryCharging, Bell, Clock, Gauge, Map as MapIco, Palette, ShoppingBag, Sun, TrendingUp, Trash2, Wrench, X } from 'lucide-react';
import { derived, useSim, type AlarmKind } from '../store/useSim';
import { BATTERY_MODELS, PANEL_MODELS, SUBSTATION_POWER_LIMIT_MW } from '../data/catalogue';
import { asBuiltCoverage, installedKwp, modelOf, PV_ASBUILT_KWP } from '../sim/engine';
import { hourLabel } from '../lib/assistant';
import { KIND_LABEL } from '../lib/alarms';
import { fmtEur, fmtKw } from '../lib/format';
import { camera } from './MapView';
import Catalog from './Catalog';
import { Range, Row, Section, Seg, Switch } from './kit';
import type { LayerId } from '../types';

export type SettingsTab = 'appearance' | 'map' | 'time' | 'forecast' | 'energy' | 'faults' | 'impact' | 'catalog';

const TABS: Array<[SettingsTab, string, ReactNode]> = [
  ['appearance', 'Appearance', <Palette size={15} key="a" />],
  ['map', 'Map & layers', <MapIco size={15} key="m" />],
  ['time', 'Time & sun', <Clock size={15} key="t" />],
  ['forecast', 'Forecast', <TrendingUp size={15} key="f" />],
  ['energy', 'Energy system', <BatteryCharging size={15} key="e" />],
  ['faults', 'Faults & alarms', <Bell size={15} key="x" />],
  ['impact', 'Impact report', <Gauge size={15} key="i" />],
  ['catalog', 'Equipment & budget', <ShoppingBag size={15} key="c" />],
];

/** Settings: every option the old toolbars had, grouped, plus theme, forecast, faults and alarm thresholds. */
export default function Settings({ onClose, initial = 'appearance' }: { onClose: () => void; initial?: SettingsTab }) {
  const [tab, setTab] = useState<SettingsTab>(initial);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6" style={{ background: 'var(--scrim)' }} onClick={onClose}>
      <div
        className="fade-in flex h-[min(760px,100%)] w-[min(1040px,100%)] overflow-hidden rounded-[14px] border border-[var(--border)] bg-[var(--bg)]"
        style={{ boxShadow: 'var(--shadow-lg)' }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Settings"
      >
        <nav className="flex w-[220px] shrink-0 flex-col gap-0.5 border-r border-[var(--border)] bg-[var(--surface)] p-3">
          <div className="px-2 pb-3 pt-1">
            <div className="eyebrow">Settings</div>
          </div>
          {TABS.map(([id, label, icon]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] ${tab === id ? 'bg-[var(--accent-soft)] font-medium text-[var(--accent)]' : 'text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]'}`}
            >
              {icon}
              {label}
            </button>
          ))}
        </nav>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-6 py-3.5">
            <h2 className="text-[16px] font-semibold">{TABS.find((t) => t[0] === tab)![1]}</h2>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close settings">
              <X size={15} />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            {tab === 'appearance' && <Appearance />}
            {tab === 'map' && <MapLayers />}
            {tab === 'time' && <TimeSun />}
            {tab === 'forecast' && <Forecast />}
            {tab === 'energy' && <Energy />}
            {tab === 'faults' && <FaultsAlarms />}
            {tab === 'impact' && <Impact />}
            {tab === 'catalog' && <Catalog />}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------- appearance ---- */
function Appearance() {
  const theme = useSim((s) => s.theme);
  const labelMode = useSim((s) => s.labelMode);
  const showLegend = useSim((s) => s.showLegend);
  const st = useSim.getState();
  return (
    <>
      <Section title="Theme">
        <Row title="Colour theme" hint="System follows your operating system setting.">
          <Seg value={theme} onChange={(v) => st.setPrefs({ theme: v })} options={[['light', 'Light'], ['dark', 'Dark'], ['system', 'System']]} />
        </Row>
      </Section>
      <Section title="Map annotations">
        <Row title="Building labels" hint="Hover only keeps the map clean; the others pin small tags with the live demand.">
          <Seg value={labelMode} onChange={(v) => st.setPrefs({ labelMode: v })} options={[['hover', 'On hover'], ['top', 'Top 8'], ['all', 'All']]} />
        </Row>
        <Row title="Pin the legend" hint="Otherwise it stays folded into the Legend button at the bottom left.">
          <Switch on={showLegend} onChange={(v) => st.setPrefs({ showLegend: v })} label="Pin legend" />
        </Row>
      </Section>
    </>
  );
}

/* --------------------------------------------------------------- map ---- */
const LAYERS: Array<[LayerId, string, string]> = [
  ['heat', 'Demand heat colours', 'Buildings coloured by how much power they draw right now.'],
  ['glow', 'Heat glow', 'Soft halo around the hungriest buildings.'],
  ['sun', 'Sun & daylight', 'Lighting and day/night tint from the real sun position at Campus Nord.'],
  ['shadows', 'Shadows', 'Shadows cast by the real sun position (needs Sun & daylight).'],
  ['weather', 'Weather', 'Clouds and their shadows, from the campus irradiance station.'],
  ['cables', 'Power cables', 'Underground network; colour and pulses follow the real power flow.'],
  ['assets', 'Battery yard & substation', 'Containers coloured by charging / discharging / fault.'],
  ['solar', 'Solar arrays', 'PV panels on the roofs that have them.'],
  ['trees', 'Trees', 'Parks and gardens from OpenStreetMap.'],
  ['people', 'People', 'Estimated occupancy around each building.'],
];
function MapLayers() {
  const layers = useSim((s) => s.layers);
  const mode3d = useSim((s) => s.mode3d);
  const st = useSim.getState();
  return (
    <>
      <Section title="View">
        <Row title="Map mode" hint="3D extrudes the campus buildings; drag with the right button (or Ctrl) to rotate.">
          <Seg value={mode3d ? '3d' : '2d'} onChange={(v) => st.setMode3d(v === '3d')} options={[['2d', '2D'], ['3d', '3D']]} />
        </Row>
        <Row title="Camera" hint="Fly to a point of interest.">
          {(
            [
              ['home', 'Campus'],
              ['battery', 'Battery yard'],
              ['substation', 'Substation'],
              ['wide', 'Neighbourhood'],
            ] as const
          ).map(([k, l]) => (
            <button key={k} type="button" className="btn !px-2.5 !py-1 !text-[12px]" onClick={() => camera.fly(k)}>
              {l}
            </button>
          ))}
        </Row>
        <Row title="Rotate & tilt" hint={mode3d ? 'Step the 3D camera.' : 'Available in 3D.'}>
          <div className={`flex gap-1.5 ${mode3d ? '' : 'pointer-events-none opacity-40'}`}>
            <button type="button" className="btn !px-2.5 !py-1" onClick={() => camera.rotate(-30)} aria-label="Rotate left">⟲</button>
            <button type="button" className="btn !px-2.5 !py-1" onClick={() => camera.rotate(30)} aria-label="Rotate right">⟳</button>
            <button type="button" className="btn !px-2.5 !py-1" onClick={() => camera.tilt(-10)} aria-label="Tilt down">⤓</button>
            <button type="button" className="btn !px-2.5 !py-1" onClick={() => camera.tilt(10)} aria-label="Tilt up">⤒</button>
          </div>
        </Row>
      </Section>
      <Section title="Layers">
        {LAYERS.map(([id, title, hint]) => (
          <Row key={id} title={title} hint={hint}>
            <Switch on={layers[id]} onChange={() => st.toggleLayer(id)} label={title} />
          </Row>
        ))}
      </Section>
    </>
  );
}

/* ---------------------------------------------------------- time & sun ---- */
function TimeSun() {
  const speed = useSim((s) => s.speed);
  const sunLock = useSim((s) => s.sunLock);
  const tMin = useSim((s) => s.tMin);
  const st = useSim.getState();
  const hod = (tMin % 1440) / 60;
  const fmt = (h: number) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
  return (
    <>
      <Section title="Playback">
        <Row title="Speed" hint="Simulated time per real second when the timeline plays.">
          <Seg value={speed} onChange={(v) => st.setSpeed(v)} options={[[15, '¼ h/s'], [30, '½ h/s'], [60, '1 h/s'], [180, '3 h/s'], [480, '8 h/s'], [1200, '20 h/s']]} />
        </Row>
        <Row title="Jump to" hint="Same day, different moment.">
          {(
            [
              [7, 'Dawn'],
              [13, 'Noon'],
              [20, 'Dusk'],
              [3, 'Night'],
            ] as const
          ).map(([h, l]) => (
            <button key={h} type="button" className="btn !px-2.5 !py-1 !text-[12px]" onClick={() => st.setTMin(Math.floor(tMin / 1440) * 1440 + h * 60)}>
              {l}
            </button>
          ))}
        </Row>
      </Section>
      <Section title="Sun">
        <Row title="Freeze the sun" hint="The simulation keeps running; only the light and shadows stay put.">
          <Switch on={sunLock != null} onChange={(v) => st.setSunLock(v ? Math.round(hod * 2) / 2 : null)} label="Freeze sun" />
        </Row>
        <Row title="Sun time of day" hint={sunLock == null ? 'Turn on "Freeze the sun" to set it.' : undefined}>
          <div className={`flex w-[260px] items-center gap-3 ${sunLock == null ? 'pointer-events-none opacity-40' : ''}`}>
            <Range value={sunLock ?? hod} min={0} max={24} step={0.25} onChange={(v) => st.setSunLock(v)} label="Sun hour" />
            <span className="tnum w-12 text-right text-[12px]">{fmt(sunLock ?? hod)}</span>
          </div>
        </Row>
      </Section>
    </>
  );
}

/* ------------------------------------------------------------ forecast ---- */
function Forecast() {
  const forecastOn = useSim((s) => s.forecastOn);
  const nowMode = useSim((s) => s.nowMode);
  const nowH = useSim((s) => s.nowH);
  const showActual = useSim((s) => s.showActual);
  const tMin = useSim((s) => s.tMin);
  useSim((s) => s.version);
  const st = useSim.getState();
  const d = derived.current;
  // forecast error on the forecast part (only meaningful because we can peek at what really happened)
  let mape = null as number | null;
  if (d && d.nowH != null && d.nowH < d.week.load.length) {
    let e = 0;
    let c = 0;
    for (let h = d.nowH; h < d.week.load.length; h++) {
      e += Math.abs(d.week.load[h] - d.actual.load[h]) / Math.max(1, d.actual.load[h]);
      c++;
    }
    mape = (100 * e) / c;
  }
  return (
    <>
      <Section title="History / forecast split">
        <Row title="Split the week at “now”" hint="Before now: measured data. After now: forecast demand and solar, day-ahead prices; the agent plans on that.">
          <Switch on={forecastOn} onChange={(v) => st.setForecast({ forecastOn: v })} label="Forecast split" />
        </Row>
        <Row title="Where is “now”" hint={`Real clock = same weekday and hour as today. Currently ${hourLabel(nowH)}.`}>
          <div className={`flex gap-2 ${forecastOn ? '' : 'pointer-events-none opacity-40'}`}>
            <Seg value={nowMode} onChange={(v) => st.setForecast({ nowMode: v })} options={[['clock', 'Real clock'], ['manual', 'Fixed']]} />
            <button type="button" className="btn !py-1 !text-[12px]" onClick={() => st.setForecast({ nowMode: 'manual', nowH: Math.floor(tMin / 60) })}>
              Set to timeline
            </button>
          </div>
        </Row>
        <Row title="Show what really happened" hint="Draws the measured demand over the forecast part of the timeline.">
          <Switch on={showActual} onChange={(v) => st.setPrefs({ showActual: v })} label="Show actuals" />
        </Row>
      </Section>
      <Section title="Method">
        <div className="py-3 text-[12.5px] leading-relaxed muted">
          <p>
            <b className="text-[var(--text)]">Demand</b>: average of the same weekday and hour over the previous four recorded weeks, scaled by how the last 24 measured hours compared with that profile (the correction fades over two days).
          </p>
          <p className="mt-2">
            <b className="text-[var(--text)]">Solar</b>: mean of the same hour over the last three measured days. <b className="text-[var(--text)]">Prices &amp; CO₂</b>: the next 24 h are published day-ahead; later hours repeat the last published day.
          </p>
          {mape != null && (
            <p className="mt-2">
              Demand forecast error this week (MAPE vs measured): <b className="tnum text-[var(--text)]">{mape.toFixed(1)}%</b>
            </p>
          )}
        </div>
      </Section>
    </>
  );
}

/* -------------------------------------------------------- energy system ---- */
function Energy() {
  const agent = useSim((s) => s.agent);
  const ageing = useSim((s) => s.ageing);
  const batteries = useSim((s) => s.batteries);
  const faults = useSim((s) => s.faults);
  const solar = useSim((s) => s.solar);
  const panelModel = useSim((s) => s.panelModel);
  const campus = useSim((s) => s.campus)!;
  const st = useSim.getState();
  const roofs = campus.features.filter((f) => f.properties.pv_fraction > 0);
  const kwp = roofs.reduce((a, f) => a + installedKwp(f.properties, solar[f.properties.osmId] ?? { on: false, fraction: 0, tilt: 18 }, panelModel), 0);
  const cov0 = asBuiltCoverage(campus.features.map((f) => f.properties));
  const totalPower = batteries.reduce((a, b) => a + b.power, 0);
  return (
    <>
      <Section title="Battery agent">
        <Row title="Who drives the battery" hint="24 h MPC is our challenge agent; the template is the organisers' rule-based baseline.">
          <Seg value={agent} onChange={(v) => st.setAgent(v)} options={[['mpc', '24 h MPC'], ['template', 'Template'], ['none', 'No battery']]} />
        </Row>
        <Row title="Apply equipment ageing" hint="Battery capacity at its state of health (−2 %/year) and PV output with module degradation (−0.5 %/year). Off = the challenge's nominal specs.">
          <Switch on={ageing} onChange={(v) => st.setAgeing(v)} label="Apply ageing" />
        </Row>
      </Section>
      <Section title={`Batteries · ${totalPower.toFixed(2)} / ${SUBSTATION_POWER_LIMIT_MW.toFixed(1)} MW`} right={<span className="text-[11.5px] muted">Add more from Equipment &amp; budget</span>}>
        {batteries.length === 0 && <div className="py-4 text-center text-[12.5px] muted">No storage installed — the score is 0.</div>}
        {batteries.map((u) => {
          const m = modelOf(u);
          const broken = faults.batteries.includes(u.id);
          return (
            <div key={u.id} className="border-b border-[var(--border)] py-3 last:border-b-0">
              <div className="flex items-center gap-2">
                <span className="text-[13.5px] font-medium">{m.name}</span>
                <span className="text-[12px] muted">{m.vendor}</span>
                {broken && <span className="badge badge-crit">broken</span>}
                <div className="flex-1" />
                <button type="button" className="icon-btn !h-7 !w-7" onClick={() => st.removeBattery(u.id)} aria-label="Remove battery">
                  <Trash2 size={13} />
                </button>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-6">
                <label className="text-[11.5px] muted">
                  <span className="tnum">Energy {u.capacity.toFixed(2)} MWh</span>
                  <Range value={u.capacity} min={m.capacity * 0.2} max={m.capacity} step={m.capacity / 40} onChange={(v) => st.updateBattery(u.id, { capacity: v })} label="Energy" />
                </label>
                <label className="text-[11.5px] muted">
                  <span className="tnum">Power {u.power.toFixed(2)} MW</span>
                  <Range value={u.power} min={m.power * 0.2} max={m.power} step={m.power / 40} onChange={(v) => st.updateBattery(u.id, { power: v })} label="Power" />
                </label>
              </div>
            </div>
          );
        })}
        <div className="flex flex-wrap gap-1.5 py-3">
          {BATTERY_MODELS.slice(0, 4).map((m) => (
            <button key={m.id} type="button" className="chip" onClick={() => st.installBattery(m.id)}>
              + {m.name}
            </button>
          ))}
        </div>
      </Section>
      <Section
        title={`Solar · ${kwp.toFixed(0)} kWp installed (real plant ${PV_ASBUILT_KWP} kWp)`}
        right={
          <div className="flex gap-1.5">
            {(['off', 'asbuilt', 'max'] as const).map((p) => (
              <button key={p} type="button" className="chip !py-0.5" onClick={() => st.solarPreset(p)}>
                {p === 'asbuilt' ? 'real' : p}
              </button>
            ))}
          </div>
        }
      >
        <Row title="Panel technology">
          <Seg value={panelModel} onChange={(v) => st.setPanelModel(v)} options={PANEL_MODELS.map((p) => [p.id, p.name.split(' ').slice(0, 2).join(' ')] as [typeof p.id, string])} />
        </Row>
        {roofs.map((f) => {
          const p = f.properties;
          const cfg = solar[p.osmId] ?? { on: false, fraction: 0, tilt: 18 };
          return (
            <div key={p.osmId} className="flex items-center gap-3 border-b border-[var(--border)] py-2 last:border-b-0">
              <Switch on={cfg.on} onChange={(v) => st.setSolar(p.osmId, { on: v })} label={`Solar ${p.short}`} />
              <span className="w-28 truncate text-[12.5px]">{p.short}</span>
              <span className="tnum w-20 text-[11.5px] muted">roof {(cfg.fraction * 100).toFixed(cfg.fraction < 0.1 ? 1 : 0)}%</span>
              <div className="relative flex-1">
                <Range value={cfg.fraction} min={0} max={0.6} step={0.005} onChange={(v) => st.setSolar(p.osmId, { fraction: v, on: v > 0 })} label={`Coverage ${p.short}`} />
                <span className="pointer-events-none absolute top-[2px] h-[14px] w-px bg-[var(--text)] opacity-50" style={{ left: `${(cov0 / 0.6) * 100}%` }} title="real plant" />
              </div>
              <span className="tnum w-16 text-right text-[11.5px] muted">tilt {cfg.tilt}°</span>
              <div className="w-20">
                <Range value={cfg.tilt} min={5} max={35} onChange={(v) => st.setSolar(p.osmId, { tilt: v })} label={`Tilt ${p.short}`} />
              </div>
            </div>
          );
        })}
      </Section>
    </>
  );
}

/* ------------------------------------------------------ faults & alarms ---- */
function FaultsAlarms() {
  const batteries = useSim((s) => s.batteries);
  const faults = useSim((s) => s.faults);
  const cfg = useSim((s) => s.alarmCfg);
  const campus = useSim((s) => s.campus)!;
  const solar = useSim((s) => s.solar);
  const tMin = useSim((s) => s.tMin);
  const st = useSim.getState();
  const toggle = (arr: string[], id: string) => (arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]);
  const roofs = campus.features.filter((f) => solar[f.properties.osmId]?.on || faults.roofs.includes(f.properties.osmId));
  const o = faults.outage;
  return (
    <>
      <Section title="Simulate equipment faults">
        {batteries.map((u) => (
          <Row key={u.id} icon={<BatteryCharging size={15} />} title={`Battery · ${modelOf(u).name}`} hint="A broken unit is taken out of the fleet; the agent re-plans with what is left.">
            <Switch on={faults.batteries.includes(u.id)} onChange={() => st.setFaults({ batteries: toggle(faults.batteries, u.id) })} label="Battery broken" />
          </Row>
        ))}
        {roofs.length === 0 && <Row icon={<Sun size={15} />} title="No solar arrays installed" hint="Add some in Energy system." />}
        {roofs.length > 0 && (
          <Row icon={<Sun size={15} />} title="Broken solar arrays" hint="Tap a roof to toggle a fault; its production drops to zero.">
            <div className="flex max-w-[460px] flex-wrap justify-end gap-1.5">
              {roofs.map((f) => {
                const on = faults.roofs.includes(f.properties.osmId);
                return (
                  <button key={f.properties.osmId} type="button" className={`chip !py-0.5 ${on ? '!border-[var(--danger)] !text-[var(--danger)]' : ''}`} onClick={() => st.setFaults({ roofs: toggle(faults.roofs, f.properties.osmId) })}>
                    {f.properties.short.replace(/^Edifici\s+/, '')}
                  </button>
                );
              })}
            </div>
          </Row>
        )}
        <Row icon={<Wrench size={15} />} title="Grid outage" hint={o ? `From ${hourLabel(o.startH)} for ${o.hours} h. The alarm reports how much demand battery + solar cannot cover.` : 'Simulate a loss of the grid connection starting at the timeline position.'}>
          {o && (
            <div className="flex w-[180px] items-center gap-2">
              <Range value={o.hours} min={1} max={24} onChange={(v) => st.setFaults({ outage: { ...o, hours: v } })} label="Outage hours" />
              <span className="tnum w-8 text-[12px]">{o.hours} h</span>
            </div>
          )}
          <Switch on={!!o} onChange={(v) => st.setFaults({ outage: v ? { startH: Math.floor(tMin / 60), hours: 4 } : null })} label="Grid outage" />
        </Row>
      </Section>
      <Section title="Alarm thresholds">
        <Row title="Demand limit" hint="Over-demand alarm above this campus demand.">
          <div className="flex w-[240px] items-center gap-2">
            <Range value={cfg.maxDemandKw} min={800} max={2500} step={50} onChange={(v) => st.setAlarmCfg({ maxDemandKw: v })} label="Demand limit" />
            <span className="tnum w-16 text-right text-[12px]">{fmtKw(cfg.maxDemandKw)}</span>
          </div>
        </Row>
        <Row title="Price spike" hint="Grid price above (€/kWh).">
          <div className="flex w-[240px] items-center gap-2">
            <Range value={cfg.priceHigh} min={0.1} max={0.5} step={0.01} onChange={(v) => st.setAlarmCfg({ priceHigh: v })} label="Price threshold" />
            <span className="tnum w-16 text-right text-[12px]">{cfg.priceHigh.toFixed(2)}</span>
          </div>
        </Row>
        <Row title="High CO₂" hint="Grid intensity above (kg/kWh).">
          <div className="flex w-[240px] items-center gap-2">
            <Range value={cfg.co2High} min={0.05} max={0.4} step={0.005} onChange={(v) => st.setAlarmCfg({ co2High: v })} label="CO2 threshold" />
            <span className="tnum w-16 text-right text-[12px]">{cfg.co2High.toFixed(3)}</span>
          </div>
        </Row>
        <Row title="Battery low" hint="State of charge below.">
          <div className="flex w-[240px] items-center gap-2">
            <Range value={cfg.socLow} min={0} max={0.5} step={0.01} onChange={(v) => st.setAlarmCfg({ socLow: v })} label="SOC threshold" />
            <span className="tnum w-16 text-right text-[12px]">{(cfg.socLow * 100).toFixed(0)}%</span>
          </div>
        </Row>
      </Section>
      <Section title="Alarm types">
        {(Object.keys(KIND_LABEL) as AlarmKind[]).map((k) => (
          <Row key={k} title={KIND_LABEL[k]}>
            <Switch on={cfg.on[k]} onChange={(v) => st.setAlarmCfg({ on: { ...cfg.on, [k]: v } })} label={KIND_LABEL[k]} />
          </Row>
        ))}
      </Section>
    </>
  );
}

/* --------------------------------------------------------------- impact ---- */
function Impact() {
  useSim((s) => s.version);
  const replay = useSim((s) => s.replay)!;
  const weekIdx = useSim((s) => s.weekIdx);
  const d = derived.current;
  if (!d) return null;
  const cards = [
    { k: 'none' as const, name: 'No battery', color: 'var(--faint)' },
    { k: 'template' as const, name: 'Template rules', color: 'var(--warn)' },
    { k: 'mpc' as const, name: '24 h MPC (ours)', color: 'var(--accent)' },
  ];
  const best = Math.max(0.01, ...cards.map((c) => d.summary[c.k].score));
  const m = d.summary.mpc;
  const maxWeek = Math.max(...replay.map((w) => w.mpc.score));
  return (
    <>
      <Section title={`This week${d.nowH != null && d.nowH < 168 ? ' · includes forecast hours' : ''}`}>
        {cards.map((c) => {
          const s = d.summary[c.k];
          return (
            <div key={c.k} className="border-b border-[var(--border)] py-3 last:border-b-0">
              <div className="flex items-baseline justify-between">
                <span className="text-[13.5px] font-medium">{c.name}</span>
                <span className="tnum text-[18px] font-semibold" style={{ color: c.color }}>{s.score.toFixed(2)}</span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--surface-3)]">
                <div className="h-full rounded-full" style={{ width: `${(s.score / best) * 100}%`, background: c.color }} />
              </div>
              <div className="tnum mt-1.5 flex justify-between text-[11.5px] muted">
                <span>ΔCO₂ {s.dCo2Pct.toFixed(2)}%</span>
                <span>ΔCost {s.dCostPct.toFixed(2)}%</span>
                <span>saved {fmtEur(s.costSavedEur)} · {s.co2SavedKg.toFixed(0)} kg CO₂</span>
              </div>
            </div>
          );
        })}
      </Section>
      <Section title="How the score is computed">
        <div className="py-3 text-[12.5px] leading-relaxed muted">
          <div className="tnum text-[13px] text-[var(--text)]">score = 0.7·ΔCO₂% + 0.3·ΔCost% − penalty·infractions</div>
          <p className="mt-1.5">
            Each Δ is the saving vs. the same campus with no battery, counting grid imports only. This week: 0.7 × {m.dCo2Pct.toFixed(2)} + 0.3 × {m.dCostPct.toFixed(2)} − {m.violations} infractions = <b className="text-[var(--text)]">{m.score.toFixed(2)}</b>.
          </p>
        </div>
      </Section>
      <Section title={`All ${replay.length} recorded weeks · MPC vs template`}>
        <div className="py-3">
          <div className="flex h-24 items-end gap-[2px]">
            {replay.map((w, i) => (
              <button key={w.start} type="button" onClick={() => useSim.getState().setWeek(i)} title={`${w.start.slice(0, 10)}: ${w.mpc.score.toFixed(2)} vs ${w.template.score.toFixed(2)}`} className="relative flex h-full flex-1 flex-col justify-end">
                <div className="rounded-t-[2px]" style={{ height: `${(w.mpc.score / maxWeek) * 100}%`, background: 'var(--accent)', outline: i === weekIdx ? '2px solid var(--text)' : 'none' }} />
                <div className="absolute inset-x-0 bottom-0 rounded-t-[2px]" style={{ height: `${(w.template.score / maxWeek) * 100}%`, background: 'var(--warn)' }} />
              </button>
            ))}
          </div>
          <p className="tnum mt-2 text-[11.5px] muted">
            Mean {(replay.reduce((a, w) => a + w.mpc.score, 0) / replay.length).toFixed(2)} (MPC) vs {(replay.reduce((a, w) => a + w.template.score, 0) / replay.length).toFixed(2)} (template). Click a bar to open that week.
          </p>
        </div>
      </Section>
    </>
  );
}
