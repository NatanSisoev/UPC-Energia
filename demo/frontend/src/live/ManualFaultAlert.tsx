import { useEffect, useRef } from 'react';
import { useSim } from '../store/useSim';
import { sendFaultAlert } from './alert';
import { activeFaults, simClock, solutionOf, useFaultAlerts, type Incident } from './faultAlertStore';
import { useLive } from './useLive';

const GAP_MS = 21000; // server rate-limits to 20 s; stay just above it

/**
 * E-mails (and shows a clickable banner) when the user manually injects a fault outside the scripted live run.
 * Clicking the banner opens the fault panel in the right sidebar (components/FaultPanel).
 */
export function ManualFaultAlert({ onOpen }: { onOpen: () => void }) {
  const faults = useSim((s) => s.faults);
  const liveActive = useLive((s) => s.active);
  const shown = useFaultAlerts((s) => s.shown);
  const dismissed = useFaultAlerts((s) => s.dismissed);
  const prev = useRef<Set<string> | null>(null);
  const pending = useRef<Incident[]>([]);
  const lastSent = useRef(0);
  const timer = useRef<number | null>(null);

  const flush = () => {
    timer.current = null;
    const items = pending.current;
    pending.current = [];
    if (!items.length) return;
    lastSent.current = Date.now();
    void sendFaultAlert(
      `SIMULATED fault: ${items.map((i) => i.title).join('; ')}`,
      `${items.map((i) => `${i.line}\nSimulated time: ${i.at}\nProposed solution: ${solutionOf(i)}`).join('\n\n')}\n\nThis is a SIMULATED fault injected manually in the UPC Campus Nord energy twin, not a real incident.`,
    );
  };

  useEffect(() => {
    const now = activeFaults();
    const keys = new Set(now.keys());
    if (prev.current === null || liveActive) {
      prev.current = keys; // first render or scripted run: just track, never alert here
      return;
    }
    const clock = simClock();
    const fresh: Incident[] = [...now.values()].filter((i) => !prev.current!.has(i.key)).map((i) => ({ ...i, at: clock }));
    prev.current = keys;
    const st = useFaultAlerts.getState();
    const kept = st.shown.filter((i) => keys.has(i.key));
    st.set({ shown: [...kept, ...fresh], ...(fresh.length ? { dismissed: false, notified: '' } : {}) });
    if (!fresh.length) return;
    pending.current.push(...fresh);
    if (timer.current === null) timer.current = window.setTimeout(flush, Math.max(0, lastSent.current + GAP_MS - Date.now()));
  }, [faults, liveActive]);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  if (liveActive || dismissed || !shown.length) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-4 z-30 flex justify-center">
      <div className="card fade-in pointer-events-auto flex items-center gap-2 px-4 py-2.5" style={{ borderColor: 'var(--danger)', background: 'var(--surface)', boxShadow: '0 0 0 3px var(--danger-soft), var(--shadow)' }}>
        <button type="button" className="text-left" onClick={onOpen} aria-label="Open fault details">
          {shown.map((i) => (
            <div key={i.key} className="text-[14px] font-semibold" style={{ color: 'var(--danger)' }}>
              {i.title} <span className="faint text-[11px] font-normal">(simulated)</span>
            </div>
          ))}
          <div className="text-[11.5px] muted">Click for details and actions</div>
        </button>
        <button type="button" className="btn !px-2 !py-0.5 !text-[11.5px]" onClick={() => useFaultAlerts.getState().set({ dismissed: true })}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
