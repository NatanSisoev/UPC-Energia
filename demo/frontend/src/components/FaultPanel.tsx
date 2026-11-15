import { useState } from 'react';
import { AlertOctagon, X } from 'lucide-react';
import { useSim } from '../store/useSim';
import { FAULT_PLAYBOOK } from '../data/faultPlaybook';
import { mailto, TECH_EMAIL, TECH_PHONE, useFaultAlerts, type Incident } from '../live/faultAlertStore';
import { useLive } from '../live/useLive';

const STATUS: Record<string, string> = {
  idle: 'E-mail alert queued',
  sending: 'Sending e-mail alert to the on-call phone…',
  sent: 'E-mail alert delivered to the on-call phone',
  'dry-run': 'Alert prepared (dry run: SMTP not configured)',
  failed: 'E-mail alert failed',
};

/** Right-sidebar detail for the manually simulated faults: what happened, the default solution, and actions. */
export default function FaultPanel({ onClose, onAlarms, onConfigure, onAsk }: { onClose: () => void; onAlarms: () => void; onConfigure: () => void; onAsk: (q: string) => void }) {
  const manual = useFaultAlerts((s) => s.shown);
  const extra = useFaultAlerts((s) => s.extra);
  const focus = useFaultAlerts((s) => s.focus);
  // alarms opened from the alarm list that are not manual faults are listed too (generic playbook fallback)
  const shown = [...manual, ...extra.filter((e) => !manual.some((m) => m.key === e.key))];
  const notified = useFaultAlerts((s) => s.notified);
  const alert = useLive((s) => s.alert);
  const alertDetail = useLive((s) => s.alertDetail);
  const [choose, setChoose] = useState(false);
  const noTech = !TECH_PHONE && !TECH_EMAIL;

  const clear = (i: Incident) => {
    const st = useSim.getState();
    if (i.key.startsWith('bat-')) st.setFaults({ batteries: st.faults.batteries.filter((b) => `bat-${b}` !== i.key) });
    else if (i.key.startsWith('pv-')) st.setFaults({ roofs: st.faults.roofs.filter((r) => `pv-${r}` !== i.key) });
    else st.setFaults({ outage: null });
  };

  return (
    <aside className="flex h-full w-full flex-col border-l border-[var(--border)] bg-[var(--surface)]">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3.5">
        <div>
          <div className="eyebrow">Fault details</div>
          <div className="mt-0.5 text-[12px] muted">Simulated fault</div>
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close fault details">
          <X size={15} />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-3">
        {shown.length === 0 && <div className="rounded-lg border border-dashed border-[var(--border-strong)] p-4 text-center text-[12.5px] muted">No active simulated faults.</div>}
        {shown.map((i) => (
          <div
            key={i.key}
            ref={focus === i.key ? (el) => el?.scrollIntoView({ block: 'nearest' }) : undefined}
            className="rounded-lg border border-[var(--border)] p-3"
            style={{ borderLeft: '3px solid var(--danger)', ...(focus === i.key ? { boxShadow: '0 0 0 2px var(--danger-soft)' } : {}) }}
          >
            <div className="flex items-center gap-2 text-[13.5px] font-semibold" style={{ color: 'var(--danger)' }}>
              <AlertOctagon size={15} /> {i.title}
            </div>
            <dl className="mt-2 grid grid-cols-[84px_1fr] gap-y-1 text-[12.5px]">
              <dt className="muted">Type</dt>
              <dd>{FAULT_PLAYBOOK[i.type].label}</dd>
              <dt className="muted">Asset</dt>
              <dd>{i.asset}</dd>
              <dt className="muted">Simulated time</dt>
              <dd className="tnum">{i.at}</dd>
            </dl>
            <div className="mt-2 text-[12px] font-medium">What happened</div>
            <p className="mt-0.5 text-[12.5px]">{i.line}</p>
            {FAULT_PLAYBOOK[i.type].happened.map((l) => (
              <p key={l} className="mt-1 text-[12.5px] muted">
                {l}
              </p>
            ))}
            <div className="mt-2 text-[12px] font-medium">Default solution</div>
            <ul className="mt-0.5 list-disc pl-4 text-[12.5px]">
              {FAULT_PLAYBOOK[i.type].solution.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className="btn !px-2 !py-0.5 !text-[11.5px]"
                onClick={() => onAsk(`Explain the active fault on ${i.asset} (${FAULT_PLAYBOOK[i.type].label}, simulated time ${i.at}): what happened, the impact, what the system is doing now and the recommended actions.`)}
              >
                Ask the assistant what happened
              </button>
              {manual.some((m) => m.key === i.key) && (
                <button type="button" className="btn !px-2 !py-0.5 !text-[11.5px]" onClick={() => clear(i)}>
                  Clear this fault
                </button>
              )}
            </div>
          </div>
        ))}

        <div className="rounded-lg border border-[var(--border)] p-3 text-[12.5px]">
          <div className="font-medium">E-mail alert</div>
          <div className="mt-0.5 muted">
            {STATUS[alert]}
            {alertDetail ? ` · ${alertDetail}` : ''}
          </div>
        </div>

        <div className="rounded-lg border border-[var(--border)] p-3">
          <div className="text-[12.5px] font-medium">Technician</div>
          <button
            type="button"
            className="btn mt-2 !px-2 !py-0.5 !text-[11.5px]"
            disabled={noTech || shown.length === 0}
            title={noTech ? 'set VITE_TECH_PHONE in .env' : undefined}
            onClick={() => setChoose((c) => !c)}
          >
            Contact technician
          </button>
          {noTech && <div className="mt-1 text-[11px] faint">set VITE_TECH_PHONE in .env</div>}
          {choose && !noTech && (
            <div className="mt-2 flex items-center gap-2">
              {TECH_PHONE ? (
                <a className="btn !px-2 !py-0.5 !text-[11.5px]" href={`tel:${TECH_PHONE}`} onClick={() => useFaultAlerts.getState().set({ notified: 'Technician called' })}>
                  Call
                </a>
              ) : (
                <span className="text-[11px] faint">Call: set VITE_TECH_PHONE in .env</span>
              )}
              {TECH_EMAIL ? (
                <a className="btn !px-2 !py-0.5 !text-[11.5px]" href={mailto(shown)} onClick={() => useFaultAlerts.getState().set({ notified: 'Technician notified by e-mail' })}>
                  E-mail / notify
                </a>
              ) : (
                <span className="text-[11px] faint">E-mail: set VITE_TECH_EMAIL in .env</span>
              )}
            </div>
          )}
          {notified && <div className="mt-2 text-[12px] font-medium">{notified}</div>}
        </div>
      </div>
      <div className="flex items-center gap-3 border-t border-[var(--border)] px-5 py-3 text-[12px]">
        <button type="button" className="font-medium text-[var(--accent)] hover:underline" onClick={onAlarms}>
          Open alarms
        </button>
        <button type="button" className="font-medium text-[var(--accent)] hover:underline" onClick={onConfigure}>
          Settings → Faults &amp; alarms
        </button>
      </div>
    </aside>
  );
}
