import { Link } from 'react-router';
import { Bell, MessageSquare, Presentation, Store, Settings as SettingsIco } from 'lucide-react';
import { useTour } from '../tour/useTour';
import { useSim } from '../store/useSim';
import { fmtKw } from '../lib/format';
import { activeAt, useAlarms } from '../lib/alarms';
import ModeIndicator from './ModeIndicator';
import ModelMenu from './ModelMenu';

/** Top bar: identity, calendar, live figures, alarms and settings. */
export default function Header({ onSettings, onAlarms, onChat, side }: { onSettings: () => void; onAlarms: () => void; onChat: () => void; side: 'chat' | 'alarms' | 'building' | 'fault' | null }) {
  const alarmsOpen = side === 'alarms';
  const snap = useSim((s) => s.snap);
  const tourOn = useTour((s) => s.active);
  const alarms = useAlarms();
  const h = snap?.hour ?? 0;
  const open = activeAt(alarms, h); // only what is active right now, same as the "Active" tab of the alarm panel
  const crit = open.some((a) => a.severity === 'critical');

  return (
    <header className="relative z-30 flex h-[58px] shrink-0 items-center gap-5 border-b border-[var(--border)] bg-[var(--surface)] px-4">
      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[var(--accent)] text-[11px] font-bold tracking-tight text-[var(--on-accent)]">UPC</div>
        <div className="leading-tight">
          <div className="text-[14px] font-semibold">UPC Energia</div>
          <div className="eyebrow !text-[9.5px]">Campus Nord · battery &amp; demand monitor</div>
        </div>
      </div>

      <ModelMenu />
      {snap && <ModeIndicator />}
      <div className="flex-1" />

      {snap && (
        <div className="hidden items-center gap-5 2xl:flex">
          <Stat k="Demand" v={fmtKw(snap.loadKw)} tip="Electricity the whole campus is using right now, before any solar or battery." />
          <Stat k="Solar" v={fmtKw(snap.solarKw)} tip="Power the rooftop panels produce at this hour; it depends on the sun and clouds." />
          {/* battery power right now: discharging = supplying the campus, charging = taking from grid / solar */}
          <Stat k={snap.battKw < -5 ? 'Battery out' : snap.battKw > 5 ? 'Battery in' : 'Battery idle'} v={fmtKw(Math.abs(snap.battKw))} tip="Battery power right now. Out = it discharges to supply the campus, in = it charges from the grid or surplus solar, idle = it does nothing." />
          <Stat k={snap.gridKw >= 0 ? 'Grid import' : 'Grid export'} v={fmtKw(Math.abs(snap.gridKw))} tip="Power bought from the grid (import) or pushed back to it (export). Import is what costs money and emits CO₂." />
          <Stat k="Price" v={`${snap.price.toFixed(3)} €/kWh`} tip="Price of grid electricity at this hour. The battery charges when it is low and discharges when it is high." />
          <Stat k="CO₂" v={`${snap.co2.toFixed(3)} kg/kWh`} tip="Carbon emitted per kWh of grid electricity at this hour. Lower when the grid mix is cleaner." />
          <Stat k="Battery charge" v={snap.capacityKwh > 0 ? `${(snap.soc * 100).toFixed(0)}%` : '—'} tip="State of charge: how full the battery is. 0 % is empty, 100 % is full." />
        </div>
      )}

      <div className="flex items-center gap-2">
        <button type="button" data-tour="tour" className={`icon-btn ${tourOn ? 'on' : ''}`} onClick={() => useTour.getState().toggle()} aria-pressed={tourOn} aria-label="Guided tour" title="Guided tour of the control room (key T); click again to close it">
          <Presentation size={16} />
        </button>
        <Link to="/catalogue" className="icon-btn" aria-label="Equipment catalogue" title="Catalogue: batteries and solar panels">
          <Store size={16} />
        </Link>
        <button type="button" data-tour="alarms" className={`icon-btn ${alarmsOpen ? 'on' : ''}`} onClick={onAlarms} aria-label={`Alarms (${open.length})`} title="Alarms">
          <Bell size={16} />
          {open.length > 0 && (
            <span
              className="tnum absolute -right-1.5 -top-1.5 min-w-[18px] rounded-full px-1 text-center text-[10px] font-semibold leading-[18px] text-white"
              style={{ background: crit ? 'var(--danger)' : 'var(--warn)' }}
            >
              {open.length}
            </span>
          )}
        </button>
        <button type="button" data-tour="chat" className={`icon-btn ${side === 'chat' ? 'on' : ''}`} onClick={onChat} aria-label="Assistant" title="Assistant (toggle sidebar)">
          <MessageSquare size={16} />
        </button>
        <button type="button" className="icon-btn" onClick={onSettings} aria-label="Settings" title="Settings">
          <SettingsIco size={16} />
        </button>
      </div>
    </header>
  );
}

function Stat({ k, v, tip }: { k: string; v: string; tip: string }) {
  return (
    <div className="group relative cursor-help leading-tight" tabIndex={0}>
      <div className="eyebrow !text-[9.5px]">{k}</div>
      <div className="tnum text-[13px] font-medium">{v}</div>
      <div role="tooltip" className="card pointer-events-none invisible absolute left-1/2 top-[calc(100%+10px)] z-50 w-[230px] -translate-x-1/2 p-2.5 text-[12px] font-normal leading-snug opacity-0 transition-opacity delay-150 group-hover:visible group-hover:opacity-100 group-focus:visible group-focus:opacity-100" style={{ boxShadow: 'var(--shadow-lg)' }}>
        <div className="mb-0.5 text-[12px] font-semibold">{k}</div>
        <div className="muted">{tip}</div>
      </div>
    </div>
  );
}
