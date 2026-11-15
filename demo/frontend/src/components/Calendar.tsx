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
export default function Calendar({ up = false }: { up?: boolean }) {
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
  const [note, setNote] = useState<string | null>(null);
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

  /** closest day that has recorded data (custom dates outside the replay land here) */
  const nearest = (k: number) => {
    let best = k;
    let gap = Infinity;
    for (const d of days.keys()) if (Math.abs(d - k) < gap) { gap = Math.abs(d - k); best = d; }
    return best;
  };
  const dayLabel = (k: number) => `${new Date(k * DAY).getUTCDate()} ${MON[new Date(k * DAY).getUTCMonth()].slice(0, 3)} ${new Date(k * DAY).getUTCFullYear()}`;

  const pick = (want: number) => {
    const k = days.has(want) ? want : nearest(want);
    const t = days.get(k);
    if (!t) return;
    setNote(k === want ? null : `No recorded data for ${dayLabel(want)}; showing the closest day, ${dayLabel(k)}.`);
    const st = useSim.getState();
    const hod = Math.floor((tMin % 1440) / 60);
    if (t.w !== st.weekIdx) st.setWeek(t.w);
    const w = replay[t.w];
    let target = t.h;
    for (let h = t.h; h < w.ms.length && Math.floor(w.ms[h] / DAY) === k; h++) if (new Date(w.ms[h]).getUTCHours() <= hod) target = h;
    st.setTMin(target * 60 + (tMin % 60));
    if (k === want) setOpen(false);
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
      <button type="button" className="btn !py-1 !text-[12px]" onClick={() => setOpen(!open)} aria-expanded={open}>
        <CalendarDays size={15} />
        <span className="tnum">{short(first)} – {short(last)} {last.getUTCFullYear()}</span>
      </button>
      {open && month && (
        <div className={`card fade-in absolute right-0 z-40 w-[288px] p-3 ${up ? 'bottom-[calc(100%+6px)]' : 'left-0 top-[calc(100%+6px)]'}`} style={{ boxShadow: 'var(--shadow-lg)' }}>
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
                  title={has ? undefined : 'No recorded data: jumps to the closest recorded day'}
                  onClick={() => pick(k)}
                  className={`tnum h-8 rounded-md text-[12px] ${isCur ? 'bg-[var(--accent)] font-semibold text-[var(--on-accent)]' : inWeek ? 'bg-[var(--accent-soft)] text-[var(--accent)]' : has ? 'hover:bg-[var(--surface-3)]' : 'text-[var(--faint)] hover:bg-[var(--surface-3)]'}`}
                >
                  {new Date(k * DAY).getUTCDate()}
                </button>
              );
            })}
          </div>
          <label className="mt-3 flex items-center justify-between gap-2 text-[12px]">
            <span className="muted">Go to date</span>
            <input
              type="date"
              className="h-8 rounded-md border border-[var(--border-strong)] bg-[var(--surface)] px-2 text-[12px] outline-none focus:border-[var(--accent)]"
              value={new Date(cur * DAY).toISOString().slice(0, 10)}
              onChange={(e) => e.target.value && pick(Date.parse(e.target.value + 'T00:00:00Z') / DAY)}
            />
          </label>
          <div className="mt-2 text-[11px] faint">{note ?? 'Pick any date: days without recorded data jump to the closest one that has.'}</div>
          <div className="mt-3 grid grid-cols-2 gap-2 border-t border-[var(--border)] pt-3">
            <button type="button" className="btn justify-center !py-1.5 !text-[12px]" disabled={weekIdx === 0} onClick={() => useSim.getState().setWeek(Math.max(0, weekIdx - 1))}>
              <ChevronLeft size={14} /> Previous week
            </button>
            <button type="button" className="btn justify-center !py-1.5 !text-[12px]" disabled={weekIdx === replay.length - 1} onClick={() => useSim.getState().setWeek(Math.min(replay.length - 1, weekIdx + 1))}>
              Next week <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
