import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Check, Loader2, Trash2, Upload, X } from 'lucide-react';
import { useSim, type ModelInfo } from '../store/useSim';
import { usePopupReq } from '../store/useUi';

/** Header "Model" selector + upload dialog + toast. Uploads go through the local dev middleware (scripts/model-plugin.mjs). */
export default function ModelMenu() {
  const models = useSim((s) => s.models);
  const modelId = useSim((s) => s.modelId);
  const loading = useSim((s) => s.modelLoading);
  const uploadsOn = useSim((s) => s.uploadsOn);
  const toast = useSim((s) => s.modelToast);
  const weekScore = useSim((s) => s.replay?.[s.weekIdx]?.mpc.score);
  const [open, setOpen] = useState(false);
  const [dlg, setDlg] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  usePopupReq('model', setOpen);
  const cur = models.find((m) => m.id === modelId);

  useEffect(() => {
    if (!open) return;
    const f = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', f);
    return () => document.removeEventListener('mousedown', f);
  }, [open]);

  // poll uploads that are still processing so the list updates by itself
  const busy = models.some((m) => m.status === 'processing');
  useEffect(() => {
    if (!busy) return;
    const t = window.setInterval(() => void useSim.getState().loadModels(), 1500);
    return () => window.clearInterval(t);
  }, [busy]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => useSim.getState().setModelToast(null), 6000);
    return () => window.clearTimeout(t);
  }, [toast]);

  if (!models.length) return null;
  return (
    <>
      <div className="relative" ref={ref} data-tour="model">
        <button type="button" className="btn !py-1 !text-[12px]" onClick={() => setOpen(!open)} title="Model that drives the battery (forecasts and charge / discharge decisions)">
          {loading ? <Loader2 size={13} className="animate-spin" /> : null}
          <span className="text-[var(--text-dim,inherit)] opacity-70">Model:</span> <span className="font-semibold">{cur?.name ?? '—'}</span>
          {weekScore != null && modelId !== 'none' && <span className="tnum opacity-70">· {weekScore.toFixed(2)}</span>}
          <ChevronDown size={13} />
        </button>
        {open && (
          <div className="absolute left-0 top-[calc(100%+6px)] z-50 w-[340px] rounded-lg border border-[var(--border)] bg-[var(--surface)] p-1.5 shadow-xl">
            {models.map((m) => (
              <Row key={m.id} m={m} on={m.id === modelId} onPick={() => { setOpen(false); void useSim.getState().setModel(m.id); }} />
            ))}
            <div className="my-1 border-t border-[var(--border)]" />
            <button
              type="button"
              disabled={!uploadsOn}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[12.5px] hover:bg-[var(--surface-2)] disabled:opacity-50"
              onClick={() => { setOpen(false); setDlg(true); }}
              title={uploadsOn ? '' : 'Uploads need the local dev server'}
            >
              <Upload size={14} /> Upload model (.zip)…
            </button>
          </div>
        )}
      </div>
      {dlg && <UploadDialog onClose={() => setDlg(false)} />}
      {toast && (
        <div
          className="fixed bottom-5 left-1/2 z-[100] flex max-w-[520px] -translate-x-1/2 items-center gap-3 rounded-lg border px-4 py-2.5 text-[12.5px] shadow-xl"
          style={{ background: 'var(--surface)', borderColor: toast.kind === 'error' ? 'var(--danger)' : 'var(--ok)' }}
          role="alert"
        >
          <span style={{ color: toast.kind === 'error' ? 'var(--danger)' : 'var(--ok)' }}>{toast.text}</span>
          <button type="button" className="icon-btn" onClick={() => useSim.getState().setModelToast(null)} aria-label="Dismiss"><X size={13} /></button>
        </div>
      )}
    </>
  );
}

function Row({ m, on, onPick }: { m: ModelInfo; on: boolean; onPick: () => void }) {
  const disabled = !m.available;
  let chip = '';
  if (m.status === 'processing') chip = `${m.stage ?? '…'}${m.progress ? ` ${Math.round(m.progress * 100)}%` : ''}`;
  else if (m.status === 'failed') chip = 'rejected';
  else if (!m.available) chip = 'not generated yet';
  else if (m.id !== 'none') chip = `score ${m.meanScore?.toFixed(2) ?? '—'} · ${m.violations ?? 0} viol${m.msPerStep != null ? ` · ${m.msPerStep.toFixed(1)} ms` : ''}`;
  return (
    <div className={`group flex items-center gap-1 rounded-md ${on ? 'bg-[var(--accent-soft)]' : 'hover:bg-[var(--surface-2)]'}`}>
      <button type="button" disabled={disabled} className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-2 text-left disabled:opacity-50" onClick={onPick} title={m.error ?? m.desc}>
        <span className="w-4 shrink-0">{on ? <Check size={14} /> : m.status === 'processing' ? <Loader2 size={13} className="animate-spin" /> : null}</span>
        <span className="min-w-0">
          <span className="block truncate text-[12.5px] font-medium">{m.name}</span>
          <span className="tnum block truncate text-[10.5px] opacity-65" style={m.status === 'failed' ? { color: 'var(--danger)' } : undefined}>{m.status === 'failed' ? (m.error ?? chip) : chip}</span>
        </span>
      </button>
      {!m.builtin && m.status !== 'processing' && (
        <button type="button" className="icon-btn mr-1 opacity-60 hover:opacity-100" aria-label={`Delete ${m.name}`} onClick={() => void useSim.getState().deleteModel(m.id)}>
          <Trash2 size={13} />
        </button>
      )}
    </div>
  );
}

function UploadDialog({ onClose }: { onClose: () => void }) {
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ error: string; problems?: string[] } | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const job = useSim((s) => s.models.find((m) => m.id === jobId));
  const input = useRef<HTMLInputElement>(null);

  // follow the job: ready -> select it, failed -> show why
  useEffect(() => {
    if (!job) return;
    if (job.status === 'ready') {
      void useSim.getState().setModel(job.id);
      useSim.getState().setModelToast({ kind: 'ok', text: `${job.name}: validated, ${job.violations ?? 0} infractions, score ${job.meanScore?.toFixed(2)}` });
      onClose();
    } else if (job.status === 'failed') {
      setBusy(false);
      setJobId(null);
      setErr({ error: job.error ?? 'rejected', problems: job.problems });
    }
  }, [job, onClose]);

  const send = async (f: File | undefined) => {
    if (!f) return;
    setErr(null);
    if (!/\.zip$/i.test(f.name)) return setErr({ error: 'Choose a .zip file' });
    if (f.size > 25 * 1024 * 1024) return setErr({ error: 'ZIP is larger than 25 MB' });
    setBusy(true);
    try {
      const r = await fetch(`/api/models?name=${encodeURIComponent(f.name)}`, { method: 'POST', headers: { 'Content-Type': 'application/zip' }, body: f });
      const j = (await r.json()) as { id?: string; error?: string };
      if (!r.ok || !j.id) throw new Error(j.error ?? `HTTP ${r.status}`);
      setJobId(j.id);
      await useSim.getState().loadModels();
    } catch (e) {
      setBusy(false);
      setErr({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="w-[440px] rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-2xl">
        <div className="mb-1 flex items-center justify-between">
          <div className="text-[14px] font-semibold">Upload model</div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X size={14} /></button>
        </div>
        <p className="mb-3 text-[12px] opacity-70">Challenge-format ZIP: <code>agent.py</code> at the root plus optional model files (max 25 MB). It is checked (forbidden imports, clamp, timing) and replayed on the campus weeks.</p>
        <div
          className={`flex h-32 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-[12.5px] ${drag ? 'bg-[var(--accent-soft)]' : 'bg-[var(--surface-2)]'}`}
          style={{ borderColor: drag ? 'var(--accent)' : 'var(--border-strong)' }}
          onClick={() => !busy && input.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); if (!busy) void send(e.dataTransfer.files[0]); }}
        >
          {busy ? (
            <>
              <Loader2 className="animate-spin" size={20} />
              <span className="tnum">{job ? `${job.stage ?? 'working'}${job.progress ? ` · ${Math.round(job.progress * 100)}%` : ''}` : 'Uploading…'}</span>
            </>
          ) : (
            <>
              <Upload size={20} />
              <span>Drop a .zip here or click to browse</span>
            </>
          )}
          <input ref={input} type="file" accept=".zip,application/zip" hidden onChange={(e) => { void send(e.target.files?.[0]); e.target.value = ''; }} />
        </div>
        {err && (
          <div className="mt-3 rounded-md p-2.5 text-[12px]" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>
            <div className="font-medium">{err.error}</div>
            {err.problems?.slice(0, 6).map((p) => <div key={p} className="tnum text-[11px]">{p}</div>)}
          </div>
        )}
      </div>
    </div>
  );
}
