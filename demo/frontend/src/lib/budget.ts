import { useToasts } from './toasts';

/** Technician / team address shown in the confirmation (the server sends to ALERT_TO from .env; same person). */
const TO = (import.meta.env.VITE_TECH_EMAIL as string | undefined)?.trim() ?? '';

/**
 * "Ask budget": e-mails the request straight from the dev/preview server (scripts/alert-plugin.mjs, recipient and SMTP
 * from .env) and confirms with a top-right notification.
 */
export async function sendBudgetRequest(subject: string, lines: string[]): Promise<void> {
  const toasts = useToasts.getState();
  const to = TO || 'the team';
  try {
    const r = await fetch('/api/alert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject, text: [...lines, '', '— Sent from UPC Energia.'].join('\n') }),
    });
    const j = (await r.json().catch(() => ({}))) as { ok?: boolean; mode?: string; error?: string };
    if (j.ok) toasts.push({ kind: 'ok', title: 'Email sent', text: `Budget request sent to ${to}.` });
    else if (j.mode === 'dry-run') toasts.push({ kind: 'error', title: 'Email not sent', text: 'SMTP is not configured (.env).' });
    else if (r.status === 429) toasts.push({ kind: 'error', title: 'Email not sent', text: 'Another email just went out: wait 20 seconds and try again.' });
    else toasts.push({ kind: 'error', title: 'Email not sent', text: j.error ?? 'The server could not send it.' });
  } catch (e) {
    toasts.push({ kind: 'error', title: 'Email not sent', text: String(e) });
  }
}
