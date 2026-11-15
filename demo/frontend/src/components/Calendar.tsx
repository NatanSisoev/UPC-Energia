import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { derived, useSim } from '../store/useSim';
import { usePopupReq } from '../store/useUi';

const DAY = 86_400_000;
const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * Date picker over the recorded data: any day that belongs to a replayed week can be opened.
 * Picking a day loads its week and moves the timeline to that day (same time of day).
 */
export default function Calendar() {
  const replay = useSim((s) => s.replay);
  const weekIdx = useSim((s) => s.weekIdx);
  const tMin = useSim((s) => s.tMin);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  usePopupReq('calendar', setOpen);

  /** day key (UTC days since epoch, local clock stored as UTC) -> {week, first hour} */
  const days = useMemo(() => {
    const m = new Map<number, { w: number; h: number }>();
    replay?.forEach((w, wi) =>
      w.ms.forEach((ms, h) => {
        const k = Math.floor(ms / DAY);
        if (!m.has(k)) m.set(k, { w: wi, h });
      }),
    );
    return m;
  }, [replay]);

  const cur = derived.current ? Math.floor(derived.current.week.ms[Math.min(167, Math.floor(tMin / 60))] / DAY) : 0;
  const [month, setMonth] = useState<{ y: number; m: number } | null>(null);
  useEffect(() => {
    if (open && cur) {
      const d = new Date(cur * DAY);
      setMonth({ y: d.getUTCFullYear(), m: d.getUTCMonth() });
    }
  }, [open, cur]);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => !boxRef.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  if (!replay) return null;
  const weekDays = new Set(replay[weekIdx].ms.map((ms) => Math.floor(ms / DAY)));
  const first = new Date(replay[weekIdx].ms[0]);
  const last = new Date(replay[weekIdx].ms[replay[weekIdx].ms.length - 1]);
  const short = (d: Date) => `${d.getUTCDate()} ${MON[d.getUTCMonth()].slice(0, 3)}`;

  const pick = (k: number) => {
    const t = days.get(k);
    if (!t) return;
    const st = useSim.getState();
    const hod = Math.floor((tMin % 1440) / 60);
    if (t.w !== st.weekIdx) st.setWeek(t.w);
    const w = replay[t.w];
    let target = t.h;
    for (let h = t.h; h < w.ms.length && Math.floor(w.ms[h] / DAY) === k; h++) if (new Date(w.ms[h]).getUTCHours() <= hod) target = h;
    st.setTMin(target * 60 + (tMin % 60));
    setOpen(false);
  };

  let grid: Array<number | null> = [];
  if (month) {
    const start = Date.UTC(month.y, month.m, 1) / DAY;
    const len = new Date(Date.UTC(month.y, month.m + 1, 0)).getUTCDate();
    const lead = (new Date(start * DAY).getUTCDay() + 6) % 7; // Monday first
    grid = [...Array(lead).fill(null), ...Array.from({ length: len }, (_, i) => start + i)];
  }
  const shift = (k: number) => month && setMonth({ y: month.y + Math.floor((month.m + k) / 12), m: (((month.m + k) % 12) + 12) % 12 });

  return (
    <div className="relative" ref={boxRef} data-tour="calendar">
      <button type="button" className="btn" onClick={() => setOpen(!open)} aria-expanded={open}>
        <CalendarDays size={15} />
        <span className="tnum">{short(first)} – {short(last)} {last.getUTCFullYear()}</span>
      </button>
      {open && month && (
        <div className="card fade-in absolute left-0 top-[calc(100%+6px)] z-40 w-[288px] p-3" style={{ boxShadow: 'var(--shadow-lg)' }}>
          <div className="mb-2 flex items-center justify-between">
            <button type="button" className="icon-btn !h-7 !w-7" onClick={() => shift(-1)} aria-label="Previous month">
              <ChevronLeft size={14} />
            </button>
            <div className="text-[13px] font-semibold">
              {MON[month.m]} {month.y}
            </div>
            <button type="button" className="icon-btn !h-7 !w-7" onClick={() => shift(1)} aria-label="Next month">
              <ChevronRight size={14} />
            </button>
          </div>
          <div className="grid grid-cols-7 gap-0.5 text-center">
            {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((l, i) => (
              <div key={i} className="eyebrow py-1 !text-[9.5px]">{l}</div>
            ))}
            {grid.map((k, i) => {
              if (k == null) return <div key={`e${i}`} />;
              const has = days.has(k);
              const inWeek = weekDays.has(k);
              const isCur = k === cur;
              return (
                <button
                  key={k}
                  type="button"
                  disabled={!has}
                  onClick={() => pick(k)}
                  className={`tnum h-8 rounded-md text-[12px] ${isCur ? 'bg-[var(--accent)] font-semibold text-[var(--on-accent)]' : inWeek ? 'bg-[var(--accent-soft)] text-[var(--accent)]' : has ? 'hover:bg-[var(--surface-3)]' : 'cursor-default text-[var(--faint)] opacity-40'}`}
                >
                  {new Date(k * DAY).getUTCDate()}
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] muted">
            <span>Days with recorded data are selectable.</span>
          </div>
          <div className="mt-2 flex gap-1.5">
            <button type="button" className="btn !px-2 !py-1 !text-[12px]" disabled={weekIdx === 0} onClick={() => useSim.getState().setWeek(Math.max(0, weekIdx - 1))}>
              ← Prev. week
            </button>
            <button type="button" className="btn !px-2 !py-1 !text-[12px]" disabled={weekIdx === replay.length - 1} onClick={() => useSim.getState().setWeek(Math.min(replay.length - 1, weekIdx + 1))}>
              Next week →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
