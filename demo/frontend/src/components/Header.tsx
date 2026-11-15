import { Bell, MessageSquare, Play, Settings as SettingsIco } from 'lucide-react';
import { useLive } from '../live/useLive';
import { useSim } from '../store/useSim';
import { fmtKw } from '../lib/format';
import { useAlarms } from '../lib/alarms';
import Calendar from './Calendar';
import ModeIndicator from './ModeIndicator';

/** Top bar: identity, calendar, live figures, alarms and settings. */
export default function Header({ onSettings, onAlarms, onChat, side }: { onSettings: () => void; onAlarms: () => void; onChat: () => void; side: 'chat' | 'alarms' | 'building' | null }) {
  const alarmsOpen = side === 'alarms';
  const snap = useSim((s) => s.snap);
  const alarms = useAlarms();
  const h = snap?.hour ?? 0;
  const open = alarms.filter((a) => a.endH > h && a.severity !== 'info'); // active + upcoming warnings/critical
  const crit = open.some((a) => a.severity === 'critical' && a.startH <= h);

  return (
    <header className="relative z-30 flex h-[58px] shrink-0 items-center gap-5 border-b border-[var(--border)] bg-[var(--surface)] px-4">
      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[var(--accent)] text-[11px] font-bold tracking-tight text-[var(--on-accent)]">UPC</div>
        <div className="leading-tight">
          <div className="text-[14px] font-semibold">Campus Nord · Energy</div>
          <div className="eyebrow !text-[9.5px]">Battery &amp; demand monitor</div>
        </div>
      </div>

      <Calendar />
      {snap && <ModeIndicator />}
      <div className="flex-1" />

      {snap && (
        <div className="hidden items-center gap-5 2xl:flex">
          <Stat k="Demand" v={fmtKw(snap.loadKw)} />
          <Stat k="Solar" v={fmtKw(snap.solarKw)} />
          {/* battery power right now: discharging = supplying the campus, charging = taking from grid / solar */}
          <Stat k={snap.battKw < -5 ? 'Battery out' : snap.battKw > 5 ? 'Battery in' : 'Battery idle'} v={fmtKw(Math.abs(snap.battKw))} />
          <Stat k={snap.gridKw >= 0 ? 'Grid import' : 'Grid export'} v={fmtKw(Math.abs(snap.gridKw))} />
          <Stat k="Price" v={`${snap.price.toFixed(3)} €/kWh`} />
          <Stat k="CO₂" v={`${snap.co2.toFixed(3)} kg/kWh`} />
          <Stat k="Battery charge" v={snap.capacityKwh > 0 ? `${(snap.soc * 100).toFixed(0)}%` : '—'} />
        </div>
      )}

      <div className="flex items-center gap-2">
        <button type="button" className="btn !py-1 !text-[12px]" onClick={() => useLive.getState().start()} title="4-minute live simulation with a battery-yard failure and an e-mail alert">
          <Play size={13} /> Live 4:00
        </button>
        <button type="button" className={`icon-btn ${alarmsOpen ? 'on' : ''}`} onClick={onAlarms} aria-label={`Alarms (${open.length})`} title="Alarms">
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
        <button type="button" className={`icon-btn ${side === 'chat' ? 'on' : ''}`} onClick={onChat} aria-label="Assistant" title="Assistant (toggle sidebar)">
          <MessageSquare size={16} />
        </button>
        <button type="button" className="icon-btn" onClick={onSettings} aria-label="Settings" title="Settings">
          <SettingsIco size={16} />
        </button>
      </div>
    </header>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="leading-tight">
      <div className="eyebrow !text-[9.5px]">{k}</div>
      <div className="tnum text-[13px] font-medium">{v}</div>
    </div>
  );
}
