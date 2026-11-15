import { useLive } from './useLive';

/** Ask the dev/preview server (scripts/alert-plugin.mjs) to e-mail the on-call phone. */
export async function sendFaultAlert(subject: string, text: string): Promise<void> {
  useLive.getState().set({ alert: 'sending', alertDetail: '' });
  try {
    const r = await fetch('/api/alert', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subject, text }) });
    const j = (await r.json()) as { ok: boolean; mode?: string; error?: string };
    if (j.ok) useLive.getState().set({ alert: 'sent' });
    else if (j.mode === 'dry-run') useLive.getState().set({ alert: 'dry-run', alertDetail: 'SMTP not configured (.env.local)' });
    else useLive.getState().set({ alert: 'failed', alertDetail: j.error ?? 'error' });
  } catch (e) {
    useLive.getState().set({ alert: 'failed', alertDetail: String(e) });
  }
}
