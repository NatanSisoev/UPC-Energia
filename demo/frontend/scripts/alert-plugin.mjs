/**
 * Vite middleware: POST /api/alert  { subject, text }  ->  e-mail to the team phone.
 * Runs in `vite` (dev) and `vite preview`. Credentials come ONLY from environment variables / .env.local
 * (git-ignored, see .env.example). Without them the endpoint does a dry run and says so, so the demo never breaks.
 */
let lastSent = 0;
const MIN_GAP_MS = 20_000; // never let a stuck loop spam the phone

export function alertPlugin(env) {
  const handler = (req, res, next) => {
    if (req.url !== '/api/alert' || req.method !== 'POST') return next();
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 10_000) req.destroy();
    });
    req.on('end', async () => {
      const reply = (code, body) => {
        res.statusCode = code;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(body));
      };
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return reply(400, { ok: false, error: 'bad json' });
      }
      const subject = String(msg.subject ?? 'Campus alert').slice(0, 200);
      const text = String(msg.text ?? '').slice(0, 4000);
      const { ALERT_SMTP_HOST, ALERT_SMTP_PORT, ALERT_SMTP_USER, ALERT_SMTP_PASS, ALERT_FROM, ALERT_TO } = env;
      if (!ALERT_SMTP_HOST || !ALERT_SMTP_USER || !ALERT_SMTP_PASS || !ALERT_TO) {
        console.log(`[alert] DRY RUN (no SMTP env configured): ${subject}\n${text}`);
        return reply(200, { ok: false, mode: 'dry-run', error: 'SMTP not configured' });
      }
      if (Date.now() - lastSent < MIN_GAP_MS) return reply(429, { ok: false, error: 'rate limited' });
      lastSent = Date.now();
      try {
        const nodemailer = (await import('nodemailer')).default;
        const tx = nodemailer.createTransport({
          host: ALERT_SMTP_HOST,
          port: Number(ALERT_SMTP_PORT || 587),
          secure: Number(ALERT_SMTP_PORT) === 465,
          auth: { user: ALERT_SMTP_USER, pass: ALERT_SMTP_PASS },
        });
        await tx.sendMail({ from: ALERT_FROM || ALERT_SMTP_USER, to: ALERT_TO, subject, text, priority: 'high' });
        console.log(`[alert] sent: ${subject}`);
        reply(200, { ok: true, mode: 'sent' });
      } catch (e) {
        console.error('[alert] send failed', e);
        reply(500, { ok: false, error: String(e && e.message ? e.message : e) });
      }
    });
  };
  return {
    name: 'campus-alert',
    configureServer(s) {
      s.middlewares.use(handler);
    },
    configurePreviewServer(s) {
      s.middlewares.use(handler);
    },
  };
}
