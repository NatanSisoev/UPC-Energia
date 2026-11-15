import type { ReactNode } from 'react';
import { AlertOctagon, AlertTriangle, Check, Info, Mail, MessageSquare, Phone, UserCog, X } from 'lucide-react';
import { useSim } from '../store/useSim';
import { FAULT_PLAYBOOK } from '../data/faultPlaybook';
import { sendFaultAlert } from '../live/alert';
import { mailto, solutionOf, TECH_EMAIL, TECH_PHONE, useFaultAlerts, type Incident } from '../live/faultAlertStore';
import { useLive } from '../live/useLive';

type Tone = 'ok' | 'warn' | 'danger' | 'accent' | 'neutral';

const STATUS: Record<string, { label: string; tone: Tone }> = {
  idle: { label: 'Queued', tone: 'accent' },
  sending: { label: 'Sending…', tone: 'accent' },
  sent: { label: 'Sent', tone: 'ok' },
  'dry-run': { label: 'Dry run', tone: 'warn' },
  failed: { label: 'Failed', tone: 'danger' },
};

const TONE_VAR: Record<Tone, [string, string]> = {
  ok: ['var(--ok)', 'var(--ok-soft)'],
  warn: ['var(--warn)', 'var(--warn-soft)'],
  danger: ['var(--danger)', 'var(--danger-soft)'],
  accent: ['var(--accent)', 'var(--accent-soft)'],
  neutral: ['var(--muted)', 'var(--surface-3)'],
};

/** Small status pill; fixed min-width so the card header does not shift when the status text changes. */
function StatusChip({ tone, children }: { tone: Tone; children: ReactNode }) {
  const [fg, bg] = TONE_VAR[tone];
  return (
    <span className="inline-flex min-w-[76px] shrink-0 items-center justify-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ color: fg, background: bg }}>
      {children}
    </span>
  );
}

const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]';
const BTN = `btn !justify-center !px-3 !py-1.5 !text-[12px] ${FOCUS} disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-[var(--border-strong)] disabled:hover:text-[var(--text)]`;
const BTN_PRIMARY = `btn-primary !justify-center !px-3 !py-1.5 !text-[12px] ${FOCUS} disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-[var(--accent)]`;

/** One full-width action card: icon, title, one-line description, optional right-hand chip, and the actions. */
function ActionCard({ icon, title, desc, chip, children }: { icon: ReactNode; title: string; desc: string; chip?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-[13px] font-semibold">{title}</h3>
            {chip}
          </div>
          <p className="mt-0.5 text-[12px] muted">{desc}</p>
        </div>
      </div>
      <div className="mt-3 flex gap-2">{children}</div>
    </section>
  );
}

/** Right-sidebar detail for simulated faults / alarms: what happened, the default solution, and three actions. */
export default function FaultPanel({ onClose, onAlarms, onConfigure, onAsk }: { onClose: () => void; onAlarms: () => void; onConfigure: () => void; onAsk: (q: string) => void }) {
  const manual = useFaultAlerts((s) => s.shown);
  const extra = useFaultAlerts((s) => s.extra);
  const focus = useFaultAlerts((s) => s.focus);
  // alarms opened from the alarm list that are not manual faults are listed too
  const shown = [...manual, ...extra.filter((e) => !manual.some((m) => m.key === e.key))];
  const notified = useFaultAlerts((s) => s.notified);
  const alert = useLive((s) => s.alert);
  const alertDetail = useLive((s) => s.alertDetail);
  const none = shown.length === 0;
  const main = shown.find((i) => i.key === focus) ?? shown[0];
  const noPhone = !TECH_PHONE;
  const noMail = !TECH_EMAIL;
  const st = STATUS[alert] ?? STATUS.idle;

  const clear = (i: Incident) => {
    const s = useSim.getState();
    if (i.key.startsWith('bat-')) s.setFaults({ batteries: s.faults.batteries.filter((b) => `bat-${b}` !== i.key) });
    else if (i.key.startsWith('pv-')) s.setFaults({ roofs: s.faults.roofs.filter((r) => `pv-${r}` !== i.key) });
    else if (i.key.startsWith('cab-')) s.setFaults({ cables: s.faults.cables.filter((c) => `cab-${c}` !== i.key) });
    else s.setFaults({ outage: null });
  };

  const sendEmail = () =>
    void sendFaultAlert(
      `SIMULATED fault: ${shown.map((i) => i.title).join('; ')}`,
      `${shown.map((i) => `${i.line}\nSimulated time: ${i.at}\nProposed solution: ${solutionOf(i)}`).join('\n\n')}\n\nThis is a SIMULATED fault in UPC Energia, not a real incident.`,
    );

  return (
    <aside className="flex h-full w-full flex-col border-l border-[var(--border)] bg-[var(--surface)]">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3.5">
        <div className="eyebrow">Fault details</div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close fault details">
          <X size={15} />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
        {none && <div className="rounded-lg border border-dashed border-[var(--border-strong)] p-4 text-center text-[12.5px] muted">No active simulated faults.</div>}

        {shown.map((i) => {
          const pb = FAULT_PLAYBOOK[i.type];
          const isFocus = focus === i.key;
          const info = i.type === 'price' || i.type === 'co2' || i.type === 'data';
          const accent = info ? 'var(--accent)' : i.type === 'soc' || i.type === 'demand' || i.type === 'pv' ? 'var(--warn)' : 'var(--danger)';
          const Icon = info ? Info : accent === 'var(--warn)' ? AlertTriangle : AlertOctagon;
          return (
            <article
              key={i.key}
              ref={isFocus ? (el) => el?.scrollIntoView({ block: 'nearest' }) : undefined}
              className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"
              style={{ borderLeft: `3px solid ${accent}`, ...(isFocus && shown.length > 1 ? { boxShadow: '0 0 0 2px var(--surface-3)' } : {}) }}
            >
              <header>
                <h2 className="flex items-start gap-2 text-[14.5px] font-semibold leading-snug">
                  <Icon size={16} className="mt-0.5 shrink-0" style={{ color: accent }} aria-hidden />
                  {i.title}
                </h2>
                <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] muted">
                  <span className="rounded-full border border-[var(--border)] px-2 py-0.5 font-medium text-[var(--text)]">{pb.label}</span>
                  <span>{i.asset}</span>
                  <span aria-hidden>·</span>
                  <span className="tnum" style={{ fontFamily: 'var(--font-mono)' }}>
                    {i.at}
                  </span>
                </div>
              </header>

              <h4 className="eyebrow mt-4">What happened</h4>
              <p className="mt-1 text-[12.5px] leading-relaxed">{i.line}</p>
              {pb.happened.map((l) => (
                <p key={l} className="mt-1 text-[12.5px] leading-relaxed muted">
                  {l}
                </p>
              ))}

              <h4 className="eyebrow mt-4">Default solution</h4>
              <ol className="mt-1.5 space-y-1.5">
                {pb.solution.map((l, n) => (
                  <li key={l} className="flex items-start gap-2 text-[12.5px] leading-relaxed">
                    <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold" style={{ background: 'var(--accent-soft)', color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>
                      {n + 1}
                    </span>
                    {l}
                  </li>
                ))}
              </ol>

              {manual.some((m) => m.key === i.key) && (
                <button type="button" className={`${BTN} mt-3`} onClick={() => clear(i)}>
                  <Check size={13} /> Clear this fault
                </button>
              )}
            </article>
          );
        })}

        <h4 className="eyebrow -mb-1">Actions</h4>

        <ActionCard icon={<MessageSquare size={16} />} title="Ask the assistant" desc="Get the impact and recommended actions for this fault.">
          <button
            type="button"
            className={`${BTN_PRIMARY} flex-1`}
            disabled={!main}
            onClick={() => main && onAsk(`Explain the active fault on ${main.asset} (${FAULT_PLAYBOOK[main.type].label}, simulated time ${main.at}): what happened, the impact, what the system is doing now and the recommended actions.`)}
          >
            <MessageSquare size={14} /> Ask the assistant
          </button>
        </ActionCard>

        <ActionCard
          icon={<Mail size={16} />}
          title="Send e-mail alert"
          desc={alertDetail ? `Alert to the on-call phone · ${alertDetail}` : 'Alert to the on-call phone, sent automatically on new faults.'}
          chip={<StatusChip tone={st.tone}>{st.label}</StatusChip>}
        >
          <button type="button" className={`${BTN_PRIMARY} flex-1`} disabled={none || alert === 'sending'} onClick={sendEmail}>
            <Mail size={14} /> {alert === 'sent' || alert === 'dry-run' || alert === 'failed' ? 'Send again' : 'Send e-mail alert'}
          </button>
        </ActionCard>

        <ActionCard
          icon={<UserCog size={16} />}
          title="Contact technician"
          desc={noPhone && noMail ? 'Add the on-call contact to enable these actions.' : 'Reach the on-call technician directly.'}
          chip={noPhone && noMail ? <StatusChip tone="neutral">Not configured</StatusChip> : notified ? <StatusChip tone="ok">Notified</StatusChip> : undefined}
        >
          {noPhone || none ? (
            <button type="button" className={`${BTN_PRIMARY} flex-1`} disabled title={noPhone ? 'Set VITE_TECH_PHONE in .env' : undefined}>
              <Phone size={14} /> Call
            </button>
          ) : (
            <a className={`${BTN_PRIMARY} flex-1`} href={`tel:${TECH_PHONE}`} onClick={() => useFaultAlerts.getState().set({ notified: 'Technician called' })}>
              <Phone size={14} /> Call
            </a>
          )}
          {noMail || none ? (
            <button type="button" className={`${BTN} flex-1`} disabled title={noMail ? 'Set VITE_TECH_EMAIL in .env' : undefined}>
              <Mail size={14} /> E-mail
            </button>
          ) : (
            <a className={`${BTN} flex-1`} href={mailto(shown)} onClick={() => useFaultAlerts.getState().set({ notified: 'Technician notified by e-mail' })}>
              <Mail size={14} /> E-mail
            </a>
          )}
        </ActionCard>
        {(noPhone || noMail) && <p className="-mt-2 text-[11px] faint">{[noPhone && 'VITE_TECH_PHONE', noMail && 'VITE_TECH_EMAIL'].filter(Boolean).join(' and ')} not set in .env.</p>}
        {notified && <p className="-mt-2 text-[11.5px] muted">{notified}</p>}
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
