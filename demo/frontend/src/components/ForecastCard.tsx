import { useEffect, useState } from 'react';

/** How long the "Forecast ready" notice stays before it fades out, and the fade duration. */
const READY_DISMISS_MS = 4000;
const READY_FADE_MS = 400;
import { Check, ChevronDown, Loader2, Sparkles, X } from 'lucide-react';
import { derived, useSim } from '../store/useSim';
import { fmtKw } from '../lib/format';

/** The stages of `sim/forecast.ts` + the 24 h MPC, with the share of the run during which each one is active. */
const STEPS: Array<{ title: string; detail: string; to: number }> = [
  { title: 'Reading measured history', detail: 'Everything up to LIVE is real telemetry', to: 0.12 },
  { title: 'Demand model', detail: 'Weekday × hour profile of earlier weeks, corrected by the last 24 h', to: 0.34 },
  { title: 'Solar model', detail: 'Same hour averaged over the last 3 measured days', to: 0.52 },
  { title: 'Prices and grid CO₂', detail: 'Next 24 h from the day-ahead market, then the last day repeated', to: 0.7 },
  { title: 'Planning the battery', detail: 'Exact 24 h look-ahead over the whole horizon', to: 0.9 },
  { title: 'Backtesting', detail: 'Comparing the forecast with what really happened', to: 1 },
];

/** Error of the generated forecast against the measured week (the replay knows what really happened). */
function backtest() {
  const d = derived.current;
  if (!d || d.nowH == null) return null;
  let eLoad = 0;
  let sLoad = 0;
  let ePv = 0;
  let sPv = 0;
  for (let h = d.nowH + 1; h < d.week.load.length; h++) {
    eLoad += Math.abs(d.week.load[h] - d.actual.load[h]);
    sLoad += d.actual.load[h];
    ePv += Math.abs(d.week.pv[h] - d.actual.pv[h]);
    sPv += d.actual.pv[h];
  }
  return { load: sLoad > 0 ? (100 * eLoad) / sLoad : 0, pv: sPv > 0 ? (100 * ePv) / sPv : 0, hours: d.week.load.length - d.nowH - 1 };
}

/** Floating status card above the timeline while the forecast is generated, and its summary afterwards. */
export function ForecastCard({ onClose }: { onClose: () => void }) {
  const stage = useSim((s) => s.fcStage);
  const [unfold, setUnfold] = useState(false);
  const [fading, setFading] = useState(false);
  // the "ready" notice dismisses itself; timers are cleared on unmount / new generation
  useEffect(() => {
    setFading(false);
    if (stage !== 'ready') return;
    const t1 = window.setTimeout(() => setFading(true), READY_DISMISS_MS);
    const t2 = window.setTimeout(onClose, READY_DISMISS_MS + READY_FADE_MS);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);
  const reveal = useSim((s) => s.fcReveal);
  useSim((s) => s.version);
  const d = derived.current;
  if (!d || d.nowH == null || stage === 'off') return null;
  const total = Math.max(1, d.week.load.length - d.nowH - 1);
  const p = stage === 'ready' ? 1 : Math.min(1, reveal / total);
  const active = STEPS.findIndex((s) => p < s.to);
  // collapsed: only the latest step (the running one, or the last once ready)
  const shown = stage === 'ready' ? STEPS.length - 1 : Math.max(0, active);
  const bt = stage === 'ready' ? backtest() : null;
  const maxPv = Math.max(...Array.from(d.week.pv).slice(d.nowH + 1), 0);

  return (
    <div
      className="card fade-in absolute bottom-[calc(100%+10px)] right-0 z-20 w-[360px] p-3.5"
      style={{ boxShadow: 'var(--shadow-lg)', opacity: fading ? 0 : 1, animation: fading ? 'none' : undefined, transition: `opacity ${READY_FADE_MS}ms ease` }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-[var(--accent)]" />
          <span className="text-[13px] font-semibold">{stage === 'ready' ? 'Forecast ready' : 'Generating forecast…'}</span>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" className="icon-btn !h-6 !w-6" onClick={() => setUnfold(!unfold)} aria-expanded={unfold} aria-label={unfold ? 'Show only the latest step' : 'Show all steps'} title={unfold ? 'Collapse' : 'Show all steps'}>
            <ChevronDown size={12} style={{ transform: unfold ? 'rotate(180deg)' : undefined }} />
          </button>
          <button type="button" className="icon-btn !h-6 !w-6" onClick={onClose} aria-label="Close">
            <X size={12} />
          </button>
        </div>
      </div>

      <ol className="mt-2.5 flex flex-col gap-1.5">
        {STEPS.map((s, i) => {
          if (!unfold && i !== shown) return null;
          const done = stage === 'ready' || i < active;
          const now = stage === 'running' && i === active;
          return (
            <li key={s.title} className={`flex items-start gap-2 text-[12px] ${done || now ? '' : 'opacity-40'}`}>
              <span className="mt-[1px] flex h-4 w-4 shrink-0 items-center justify-center">
                {done ? <Check size={13} className="text-[var(--accent)]" /> : now ? <Loader2 size={13} className="animate-spin text-[var(--accent)]" /> : <span className="h-1.5 w-1.5 rounded-full bg-[var(--faint)]" />}
              </span>
              <span className="min-w-0 leading-tight">
                <span className="font-medium">{s.title}</span>
                {(done || now) && <span className="block text-[11px] muted">{s.detail}</span>}
              </span>
            </li>
          );
        })}
      </ol>

      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--surface-3)]">
        <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${p * 100}%`, transition: 'width .1s linear' }} />
      </div>
      <div className="tnum mt-1.5 flex justify-between text-[11px] muted">
        <span>
          {Math.min(total, Math.floor(reveal))} / {total} hours generated
        </span>
        <span>{Math.round(p * 100)}%</span>
      </div>

      {bt && (
        <div className="fade-in mt-3 grid grid-cols-3 gap-2 border-t border-[var(--border)] pt-3 text-center">
          <div>
            <div className="eyebrow !text-[9px]">Horizon</div>
            <div className="tnum mt-0.5 text-[13px] font-medium">{bt.hours} h</div>
          </div>
          <div>
            <div className="eyebrow !text-[9px]">Demand error</div>
            <div className="tnum mt-0.5 text-[13px] font-medium">{bt.load.toFixed(1)}%</div>
          </div>
          <div>
            <div className="eyebrow !text-[9px]">Solar error</div>
            <div className="tnum mt-0.5 text-[13px] font-medium">{bt.pv.toFixed(0)}%</div>
          </div>
          <div className="col-span-3 text-[10.5px] faint">
            Backtest against the measured week (error = Σ|forecast − measured| / Σ measured). Peak solar in the forecast: {fmtKw(maxPv)}.
          </div>
        </div>
      )}
    </div>
  );
}
