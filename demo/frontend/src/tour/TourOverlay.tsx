import { useEffect, useLayoutEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { ChevronLeft, ChevronRight, StickyNote, X } from 'lucide-react';
import Insights from '../components/Insights';
import { useSim } from '../store/useSim';
import { setNavigator } from './actions';
import { rawJsonRow, tourFacts, type TF } from './facts';
import { STEPS, type Text } from './steps';
import { useTour } from './useTour';

const txt = (t: Text, f: TF) => (typeof t === 'function' ? t(f) : t);

/** Mounted once in the router root (so it survives the /catalogue page). Keyboard, caption card, spotlight, covers. */
export default function TourOverlay() {
  const navigate = useNavigate();
  const { active, idx, sub, notesOpen, busy } = useTour();
  const [, force] = useState(0);
  const [tlH, setTlH] = useState(0);
  useSim((s) => s.version);
  useSim((s) => s.snap?.hour);

  useEffect(() => setNavigator((to) => void navigate(to)), [navigate]);

  // keyboard (capture phase so Esc exits the tour instead of closing panels underneath)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      const t = useTour.getState();
      if (!t.active) {
        if (e.key === 't' || e.key === 'T') t.start();
        return;
      }
      const stop = () => {
        e.preventDefault();
        e.stopImmediatePropagation();
      };
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') (stop(), t.next());
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') (stop(), t.prev());
      else if (e.key === 'Escape') (stop(), t.stop());
      else if (e.key === 'n' || e.key === 'N') (stop(), t.toggleNotes());
      else if (/^[1-9]$/.test(e.key) && Number(e.key) <= STEPS.length) (stop(), t.goto(Number(e.key) - 1));
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.key === ' ' && useTour.getState().active) e.preventDefault(); // do not "click" a focused button
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onUp, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onUp, true);
    };
  }, []);

  // slow heartbeat: the catalogue payback arrives asynchronously, the timeline height changes with the charts
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => force((n) => n + 1), 600);
    return () => window.clearInterval(id);
  }, [active]);
  useLayoutEffect(() => {
    if (!active) return;
    const el = document.querySelector('[data-tour="timeline"]') as HTMLElement | null;
    setTlH(el ? el.getBoundingClientRect().height : 0);
  });

  if (!active) return null;
  const step = STEPS[idx];
  const clicks = step.clicks ?? [];
  const f = tourFacts();
  const cover = step.cover?.(sub) ?? null;
  const now = sub === 0 ? step.action : clicks[sub - 1].action;
  const spot = sub === 0 ? step.spot : (clicks[sub - 1].spot ?? step.spot);
  const nextClick = clicks[sub];
  const nextLabel = nextClick ? `Next: ${nextClick.label}` : idx < STEPS.length - 1 ? `Next beat: ${STEPS[idx + 1].short}` : 'Finish';
  const lastOfBeat = sub === clicks.length;

  return (
    <>
      {cover === 'json' && <JsonCover />}
      {cover === 'insights' && (
        <div className="tour-fade fixed left-[464px] right-6 top-[70px] z-[55] overflow-hidden rounded-[14px] border border-[var(--border-strong)] p-3 text-white" style={{ bottom: tlH + 16, background: '#0b1020', boxShadow: 'var(--shadow-lg)' }}>
          <Insights />
        </div>
      )}
      {cover === 'facts' && f && <FactsCover f={f} />}
      {spot && !cover && <Spot selector={spot} key={`${idx}-${sub}`} />}

      <div className="pointer-events-none fixed left-4 z-[70] w-[min(440px,calc(100vw-32px))]" style={{ bottom: Math.max(16, tlH + 12) }}>
        <div key={`${idx}-${sub}`} className="tour-card pointer-events-auto rounded-[12px] border border-[var(--border-strong)] bg-[var(--surface)] p-3.5" style={{ boxShadow: 'var(--shadow-lg)' }} role="dialog" aria-label="Guided tour">
          {/* beat tracker */}
          <div className="mb-2.5 flex items-center gap-1" aria-label={`Beat ${idx + 1} of ${STEPS.length}`}>
            {STEPS.map((s, i) => (
              <button key={s.id} type="button" title={`${i + 1}. ${s.short}`} onClick={() => useTour.getState().goto(i)} className="h-[5px] flex-1 rounded-full" style={{ background: i < idx ? 'var(--accent)' : i === idx ? 'var(--accent)' : 'var(--surface-3)', opacity: i < idx ? 0.45 : 1 }} />
            ))}
            <span className="tnum ml-1.5 text-[10.5px] muted">
              {idx + 1} / {STEPS.length}
            </span>
            <button type="button" className="icon-btn !h-6 !w-6" onClick={() => useTour.getState().stop()} aria-label="Exit tour (Esc)" title="Exit tour (Esc)">
              <X size={13} />
            </button>
          </div>
          <div className="eyebrow !text-[10px] !text-[var(--accent)]">{step.kicker}</div>
          <div className="mt-0.5 text-[16px] font-semibold leading-snug">{f ? txt(step.title, f) : step.short}</div>
          {f && (
            <ul className="mt-1.5 space-y-1 text-[12.5px] leading-snug muted">
              {step.bullets(f).slice(0, 3).map((b) => (
                <li key={b} className="flex gap-2">
                  <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-[var(--accent)]" />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          )}
          {f && (
            <div className="mt-2 flex items-center gap-2 rounded-md bg-[var(--accent-soft)] px-2.5 py-1.5 text-[12px] font-medium text-[var(--accent)]">
              {busy && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--accent)]" />}
              <span className="min-w-0">{txt(now, f)}</span>
            </div>
          )}
          {lastOfBeat && idx < STEPS.length && (
            <div className="mt-2 inline-flex max-w-full items-center gap-1.5 rounded-full border border-[var(--border-strong)] px-2.5 py-1 text-[11.5px] italic muted">
              <ChevronRight size={12} className="shrink-0" /> <span className="truncate">{step.bridge}</span>
            </div>
          )}
          {notesOpen && (
            <p className="mt-2 border-t border-[var(--border)] pt-2 text-[11.5px] leading-snug" style={{ color: 'var(--warn)' }}>
              <b>Notes</b> · {step.notes}
            </p>
          )}
          <div className="mt-3 flex items-center gap-2">
            <button type="button" className="btn !px-2 !py-1 !text-[12px]" onClick={() => useTour.getState().prev()} disabled={idx === 0 && sub === 0} aria-label="Back">
              <ChevronLeft size={14} />
            </button>
            <button type="button" className="btn-primary !py-1 !text-[12px]" onClick={() => useTour.getState().next()}>
              {nextLabel} <ChevronRight size={14} />
            </button>
            <button type="button" className={`icon-btn ${notesOpen ? 'on' : ''}`} onClick={() => useTour.getState().toggleNotes()} title="Speaker notes (N)" aria-label="Speaker notes">
              <StickyNote size={14} />
            </button>
            <span className="ml-auto text-[10px] faint">← → space · N notes · 1-9 beat · Esc</span>
          </div>
        </div>
      </div>
    </>
  );
}

/** soft outline around the UI element being talked about (never intercepts the pointer) */
function Spot({ selector }: { selector: string }) {
  const [r, setR] = useState<DOMRect | null>(null);
  useEffect(() => {
    const find = () => {
      const el = Array.from(document.querySelectorAll(selector)).find((e) => (e as HTMLElement).offsetParent !== null || getComputedStyle(e).position === 'fixed') as HTMLElement | undefined;
      const b = el?.getBoundingClientRect() ?? null;
      setR((p) => (p && b && p.x === b.x && p.y === b.y && p.width === b.width && p.height === b.height ? p : b));
    };
    find();
    const id = window.setInterval(find, 250);
    return () => window.clearInterval(id);
  }, [selector]);
  if (!r || r.width < 4) return null;
  return <div className="tour-spot pointer-events-none fixed z-[60] rounded-[10px]" style={{ left: r.x - 4, top: r.y - 4, width: r.width + 8, height: r.height + 8 }} />;
}

function Slide({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div className="tour-fade fixed inset-0 z-[55] flex items-center justify-center p-10" style={{ background: 'var(--bg)' }} aria-label={label}>
      {children}
    </div>
  );
}

/** hook slide: one real replay row, as raw JSON */
function JsonCover() {
  const json = rawJsonRow();
  return (
    <Slide label="Raw data">
      <div className="w-[min(760px,100%)]">
        <div className="eyebrow !text-[var(--accent)]">One real hour · UPC Campus Nord</div>
        <h2 className="mt-1 text-[28px] font-semibold leading-tight">Data nobody can read is data nobody can act on</h2>
        <pre className="tnum mt-5 overflow-hidden rounded-[10px] border border-[var(--border-strong)] bg-[var(--surface)] p-5 text-[13px] leading-relaxed" style={{ boxShadow: 'var(--shadow)' }}>
          {json ?? 'loading…'}
        </pre>
        <p className="mt-3 text-[12.5px] muted">Straight from the replay data that drives this app. 168 rows like this per week, every week of the year.</p>
      </div>
    </Slide>
  );
}

/** closing slide: three headline facts computed from the live simulation */
function FactsCover({ f }: { f: TF }) {
  const hard = f.models.find((m) => m.id === 'hard' && m.available);
  const cards = [
    { k: 'Score vs the organisers’ template', v: f.meanMpc.toFixed(2), sub: `mean over ${f.weeks} real weeks, template ${f.meanTemplate.toFixed(2)}${hard?.meanScore != null ? ` · Hard Mode ${hard.meanScore.toFixed(2)}` : ''}` },
    { k: 'Infractions', v: String(f.violations), sub: `across ${f.weeks * 168} hourly decisions, every command passes the safety clamp` },
    { k: `Saved in the week of ${f.week}`, v: `${Math.round(f.co2SavedKg).toLocaleString('en')} kg CO₂`, sub: `and ${f.fmtEur(f.costSavedEur)} of electricity, versus the same campus with no battery` },
  ];
  return (
    <Slide label="Headline results">
      <div className="w-[min(980px,100%)]">
        <div className="eyebrow !text-[var(--accent)]">A Monday in the life of the campus energy manager</div>
        <h2 className="mt-1 text-[28px] font-semibold">Three numbers to remember</h2>
        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
          {cards.map((c) => (
            <div key={c.k} className="rounded-[12px] border border-[var(--border-strong)] bg-[var(--surface)] p-5" style={{ boxShadow: 'var(--shadow)' }}>
              <div className="eyebrow">{c.k}</div>
              <div className="tnum mt-2 text-[40px] font-semibold leading-none text-[var(--accent)]">{c.v}</div>
              <div className="mt-3 text-[12.5px] leading-snug muted">{c.sub}</div>
            </div>
          ))}
        </div>
      </div>
    </Slide>
  );
}
