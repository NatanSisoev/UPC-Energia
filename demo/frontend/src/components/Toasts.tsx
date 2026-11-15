import { CheckCircle2, Info, TriangleAlert, X } from 'lucide-react';
import { useToasts } from '../lib/toasts';

const ICON = { ok: CheckCircle2, error: TriangleAlert, info: Info } as const;
const COLOR = { ok: 'var(--ok)', error: 'var(--danger)', info: 'var(--accent)' } as const;

/** Notification stack, top right, above everything. */
export default function Toasts() {
  const items = useToasts((s) => s.items);
  if (!items.length) return null;
  return (
    <div className="pointer-events-none fixed right-4 top-4 z-[100] flex w-[320px] flex-col items-end gap-2" aria-live="polite">
      {items.map((t) => {
        const Icon = ICON[t.kind];
        return (
          <div key={t.id} role="status" className="card fade-in pointer-events-auto flex w-full items-start gap-2.5 p-3" style={{ borderColor: COLOR[t.kind], boxShadow: 'var(--shadow-lg)' }}>
            <Icon size={16} className="mt-0.5 shrink-0" style={{ color: COLOR[t.kind] }} />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold">{t.title}</div>
              {t.text && <div className="mt-0.5 break-words text-[12px] muted">{t.text}</div>}
            </div>
            <button type="button" className="icon-btn !h-6 !w-6" onClick={() => useToasts.getState().dismiss(t.id)} aria-label="Dismiss">
              <X size={13} />
            </button>
          </div>
        );
      })}
      {items.length > 1 && (
        <button type="button" className="btn pointer-events-auto !py-1 !text-[12px]" onClick={() => useToasts.getState().dismissAll()}>
          Dismiss all
        </button>
      )}
    </div>
  );
}
