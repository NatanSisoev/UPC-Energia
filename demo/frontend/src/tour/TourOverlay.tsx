import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { ChevronLeft, ChevronRight } from 'lucide-react';
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
  const { active, idx, sub } = useTour();
  const [, force] = useState(0);
  const [tlH, setTlH] = useState(0);
  // the pill can be dragged anywhere; the offset from its default corner survives beat changes and is clamped to the window
  const [off, setOff] = useState({ x: 0, y: 0 });
  const drag = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null);
  const pill = useRef<HTMLDivElement>(null);
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
      if (e.key === 't' || e.key === 'T') {
        e.preventDefault();
        t.toggle();
        return;
      }
      if (!t.active) return;
      const stop = () => {
        e.preventDefault();
        e.stopImmediatePropagation();
      };
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') (stop(), t.next());
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') (stop(), t.prev());
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
  const spot = sub === 0 ? step.spot : (clicks[sub - 1].spot ?? step.spot);
  const nextClick = clicks[sub];
  const atEnd = !nextClick && idx === STEPS.length - 1;

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

      <div ref={pill} className="pointer-events-none fixed left-4 z-[70] w-[min(420px,calc(100vw-32px))]" style={{ bottom: Math.max(16, tlH + 12), transform: `translate(${off.x}px, ${off.y}px)` }}>
        <div key={`${idx}-${sub}`} className="tour-card pointer-events-auto flex cursor-grab touch-none select-none items-center gap-2 rounded-full border border-[var(--border-strong)] bg-[var(--surface)] py-1.5 pl-3.5 pr-1.5 active:cursor-grabbing" onPointerDown={(e) => { if ((e.target as HTMLElement).closest('button')) return; drag.current = { px: e.clientX, py: e.clientY, ox: off.x, oy: off.y }; e.currentTarget.setPointerCapture(e.pointerId); }} onPointerMove={(e) => { const d = drag.current; const r = pill.current?.getBoundingClientRect(); if (!d || !r) return; const nx = d.ox + e.clientX - d.px; const ny = d.oy + e.clientY - d.py; const dx = nx - off.x; const dy = ny - off.y; const x = Math.min(window.innerWidth - 40, Math.max(40 - r.width, r.left + dx)) - (r.left - off.x); const y = Math.min(window.innerHeight - 20, Math.max(0, r.top + dy)) - (r.top - off.y); setOff({ x, y }); }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} style={{ boxShadow: 'var(--shadow-lg)' }} role="dialog" aria-label="Guided tour">
          <span className="tnum shrink-0 text-[11px] font-semibold text-[var(--accent)]" aria-label={`Beat ${idx + 1} of ${STEPS.length}`}>
            {idx + 1}/{STEPS.length}
          </span>
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold" title={f ? txt(step.title, f) : step.short}>
            {f ? txt(step.title, f) : step.short}
          </span>
          <button type="button" className="icon-btn !h-7 !w-7 shrink-0" onClick={() => useTour.getState().prev()} disabled={idx === 0 && sub === 0} aria-label="Back">
            <ChevronLeft size={15} />
          </button>
          <button type="button" className="btn-primary !h-7 !w-7 shrink-0 !p-0" onClick={() => useTour.getState().next()} disabled={atEnd} aria-label="Next">
            <ChevronRight size={15} />
          </button>
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
    <div className="tour-fade fixed inset-x-0 bottom-0 top-[58px] z-[55] flex items-center justify-center p-10" style={{ background: 'var(--bg)' }} aria-label={label}>
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
