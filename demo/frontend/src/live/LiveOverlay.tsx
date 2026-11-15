import { useEffect } from 'react';
import { camera } from '../components/MapView';
import { derived, useSim } from '../store/useSim';
import { fmtKw } from '../lib/format';
import { sendFaultAlert } from './alert';
import { EVENTS, FAULT_AT, FAULT_END, LIVE_SECONDS, LIVE_SPEED, LIVE_START_MIN, LIVE_WEEK, type LiveAction } from './script';
import { useLive } from './useLive';

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const fired = new Set<number>();
/** what the user had before the run, restored at the end */
let saved: { forecastOn: boolean; speed: number } | null = null;

function endRun(): void {
  const st = useSim.getState();
  st.setFaults({ batteries: [] });
  if (saved) {
    st.setForecast({ forecastOn: saved.forecastOn });
    st.setSpeed(saved.speed);
    saved = null;
  }
  useLive.getState().stop();
}

function run(action: LiveAction): void {
  const st = useSim.getState();
  const live = useLive.getState();
  if (action === 'reset') {
    saved = { forecastOn: st.forecastOn, speed: st.speed };
    st.resetScenario();
    st.setForecast({ forecastOn: false }); // everything is "measured": a clean replay without the forecast frame
    st.setMode3d(true);
    st.setAgent('mpc');
    if (st.weekIdx !== LIVE_WEEK) st.setWeek(LIVE_WEEK);
    st.select(null);
    st.setTMin(LIVE_START_MIN);
    st.setSpeed(LIVE_SPEED);
    st.setPlaying(true);
  } else if (action === 'expand') {
    st.solarPreset('max');
    st.installBattery('fusion');
  } else if (action === 'fault') {
    // every unit of the yard trips; the sim re-plans without storage, alarms and map outlines follow from the store
    st.setFaults({ batteries: st.batteries.map((b) => b.id) });
    const d = derived.current;
    const hh = st.snap && d ? `${String(new Date(d.week.ms[st.snap.hour]).getUTCHours()).padStart(2, '0')}:00` : '';
    live.set({ incident: { title: 'Battery yard failure', detail: 'Protection tripped all units. The campus now runs on grid + solar.' } });
    void sendFaultAlert(
      'CRITICAL: Campus Nord battery yard failure',
      `Battery yard failure at ${hh} (simulated clock).\nProtection tripped all units; the campus is on grid + solar only.\nAction required: inspect the yard and reset protection.\n\n(UPC Campus Nord energy twin - live demo)`,
    );
  } else if (action === 'restore') {
    st.setFaults({ batteries: [] });
    live.set({ incident: null });
  } else if (action === 'summary') {
    const sum = derived.current?.summary.mpc;
    const snap = st.snap;
    live.set({
      caption: {
        kicker: 'Result',
        text: snap
          ? `Savings so far vs. no battery: ${Math.max(0, snap.baseCostEur - snap.costEur).toFixed(0)} EUR and ${Math.max(0, snap.baseCo2Kg - snap.co2Kg).toFixed(0)} kg CO2, even with the outage. Grid import now ${fmtKw(Math.max(0, snap.gridKw))}. Full-week score ${sum?.score.toFixed(2) ?? '-'}.`
          : '',
      },
    });
  }
}

/** Drives the scripted run: heartbeat, event firing, keyboard. */
export function LiveRunner() {
  const active = useLive((s) => s.active);
  const ready = useSim((s) => s.snap !== null);

  useEffect(() => {
    if (!active || !ready) return;
    fired.clear();
    let last = performance.now();
    const id = window.setInterval(() => {
      const n = performance.now();
      const dt = Math.min(0.5, (n - last) / 1000);
      last = n;
      const lv = useLive.getState();
      if (lv.paused) {
        useSim.getState().setPlaying(false);
        return;
      }
      useSim.getState().setPlaying(true);
      const t = lv.t + dt;
      EVENTS.forEach((e, i) => {
        if (t >= e.at && !fired.has(i)) {
          fired.add(i);
          if (e.action) run(e.action);
          if (e.cam) camera.go(e.cam, 2200, 'fly');
          if (e.text) useLive.getState().set({ caption: { kicker: e.kicker, text: e.text } });
        }
      });
      if (t >= LIVE_SECONDS) endRun();
      else useLive.getState().set({ t });
    }, 100);
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.key === 'Escape') endRun();
      if (e.key === ' ') {
        e.preventDefault();
        useLive.getState().togglePause();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('keydown', onKey);
    };
  }, [active, ready]);
  return null;
}

const ALERT_TEXT: Record<string, string> = {
  idle: '',
  sending: 'Sending e-mail alert to the on-call phone…',
  sent: 'E-mail alert delivered to the on-call phone',
  'dry-run': 'Alert prepared (dry run: SMTP not configured)',
  failed: 'E-mail alert failed',
};

/** Caption, timeline, incident banner and the alert status, in the app's own visual language. */
export function LiveHud() {
  const { active, t, caption, incident, alert, alertDetail, paused } = useLive();
  if (!active) return null;
  return (
    <>
      {incident && (
        <div className="pointer-events-none absolute inset-x-0 top-4 z-30 flex justify-center">
          <div className="card fade-in px-5 py-3 text-center" style={{ borderColor: 'var(--danger)', background: 'var(--surface)', boxShadow: '0 0 0 3px var(--danger-soft), var(--shadow)' }}>
            <div className="text-[15px] font-semibold" style={{ color: 'var(--danger)' }}>
              {incident.title}
            </div>
            <div className="text-[12px] muted">{incident.detail}</div>
            {alert !== 'idle' && (
              <div className="mt-1 text-[11.5px] font-medium">
                {ALERT_TEXT[alert]}
                {alertDetail ? <span className="faint"> · {alertDetail}</span> : null}
              </div>
            )}
          </div>
        </div>
      )}
      <div className="pointer-events-auto absolute inset-x-4 bottom-[132px] z-30 flex justify-center">
        <div className="card fade-in w-full max-w-[760px] px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <span className="eyebrow">{caption?.kicker ?? 'Live simulation'}</span>
            <div className="flex items-center gap-2 text-[11.5px] muted">
              <span className="tnum">
                {mmss(t)} / {mmss(LIVE_SECONDS)}
              </span>
              <button type="button" className="btn !px-2 !py-0.5 !text-[11.5px]" onClick={() => useLive.getState().togglePause()}>
                {paused ? 'Resume' : 'Pause'}
              </button>
              <button type="button" className="btn !px-2 !py-0.5 !text-[11.5px]" onClick={endRun}>
                Stop
              </button>
            </div>
          </div>
          {caption?.text && <p className="mt-1.5 text-[13.5px] leading-snug">{caption.text}</p>}
          <div className="relative mt-2.5 h-1.5 rounded-full bg-[var(--surface-3)]">
            <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${(t / LIVE_SECONDS) * 100}%` }} />
            <div className="absolute top-[-2px] h-[10px] rounded-full opacity-70" style={{ background: 'var(--danger)', left: `${(FAULT_AT / LIVE_SECONDS) * 100}%`, width: `${((FAULT_END - FAULT_AT) / LIVE_SECONDS) * 100}%` }} title="fault window" />
          </div>
          <div className="mt-1 text-[10px] faint">Space pauses · Esc stops · {LIVE_SPEED} simulated minutes per second</div>
        </div>
      </div>
    </>
  );
}
