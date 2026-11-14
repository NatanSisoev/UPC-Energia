import { useMemo, useRef } from 'react';
import { Pause, Play } from 'lucide-react';
import { derived, useSim } from '../store/useSim';
import { clockAt, dayLabelAt, weekMsAt } from '../lib/format';

const DAY = 86_400_000;

/**
 * A clean week timeline: drag (or click) anywhere to move through the replayed week, click a day to jump to it.
 * The faint area behind the track is the campus demand, so busy hours are visible at a glance.
 */
export default function TimeBar() {
  const tMin = useSim((s) => s.tMin);
  const playing = useSim((s) => s.playing);
  const version = useSim((s) => s.version);
  const trackRef = useRef<HTMLDivElement>(null);
  const d = derived.current;
  const n = d?.week.load.length ?? 168;
  const total = n * 60;

  const shape = useMemo(() => {
    if (!d) return null;
    const max = Math.max(...d.week.load);
    const min = Math.min(...d.week.load);
    const pts = d.week.load.map((v, h) => `${h + 0.5},${(30 - ((v - min) / Math.max(1, max - min)) * 26).toFixed(2)}`);
    // day boundaries from the real per-row timestamps (weeks may start mid-day or have gaps)
    const days: Array<{ h0: number; h1: number; label: string }> = [];
    for (let h = 0; h < n; h++) {
      const k = Math.floor(d.week.ms[h] / DAY);
      if (!days.length || Math.floor(d.week.ms[days[days.length - 1].h0] / DAY) !== k) days.push({ h0: h, h1: h + 1, label: dayLabelAt(d.week.ms[h], 0) });
      else days[days.length - 1].h1 = h + 1;
    }
    return { area: `M0,30 L${pts.join(' L')} L${n},30 Z`, days };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, d?.week.start]);

  const seek = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    useSim.getState().setTMin(Math.min(total - 1, Math.max(0, ((clientX - r.left) / r.width) * total)));
  };
  const st = useSim.getState();
  const nowMs = d ? weekMsAt(d.week.ms, tMin) : 0;
  const frac = tMin / total;
  const curH = Math.floor(tMin / 60);

  return (
    <div className="card pointer-events-auto flex w-full items-center gap-4 px-4 py-3">
      <button type="button" onClick={() => st.setPlaying(!playing)} className="icon-btn" aria-label={playing ? 'Pause' : 'Play'} title={playing ? 'Pause' : 'Play the week'}>
        {playing ? <Pause size={16} /> : <Play size={16} />}
      </button>

      <div className="w-[118px] shrink-0 leading-tight">
        <div className="tnum text-[20px] font-semibold text-[#1d1d1b]">{clockAt(nowMs, 0)}</div>
        <div className="text-[12px] text-[#5f6368]">{dayLabelAt(nowMs, 0)}</div>
      </div>

      <div className="min-w-0 flex-1">
        <div
          ref={trackRef}
          className="relative h-9 cursor-pointer touch-none select-none"
          onPointerDown={(e) => {
            (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
            seek(e.clientX);
          }}
          onPointerMove={(e) => e.buttons === 1 && seek(e.clientX)}
          role="slider"
          aria-label="Time in the week"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={Math.round(tMin)}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') st.setTMin(Math.min(total - 1, tMin + 60));
            if (e.key === 'ArrowLeft') st.setTMin(Math.max(0, tMin - 60));
          }}
        >
          {/* demand silhouette */}
          <svg className="absolute inset-x-0 top-0 h-[30px] w-full" viewBox={`0 0 ${n} 30`} preserveAspectRatio="none" aria-hidden>
            {shape && <path d={shape.area} fill="#007bc0" opacity={0.1} />}
            {shape?.days.slice(1).map((dd) => <line key={dd.h0} x1={dd.h0} x2={dd.h0} y1={0} y2={30} stroke="#d0d4da" strokeWidth={0.25} vectorEffect="non-scaling-stroke" />)}
          </svg>
          {/* track */}
          <div className="absolute inset-x-0 bottom-[3px] h-[3px] rounded-full bg-[#e3e6ea]" />
          <div className="absolute bottom-[3px] left-0 h-[3px] rounded-full bg-[#007bc0]" style={{ width: `${frac * 100}%` }} />
          {/* playhead */}
          <div className="pointer-events-none absolute inset-y-0 w-px bg-[#007bc0]" style={{ left: `${frac * 100}%` }} />
          <div className="pointer-events-none absolute bottom-0 h-[9px] w-[9px] -translate-x-1/2 rounded-full border-2 border-white bg-[#007bc0] shadow" style={{ left: `${frac * 100}%` }} />
        </div>
        {/* days */}
        <div className="relative mt-1 h-4">
          {shape?.days.map((dd) => {
            const on = curH >= dd.h0 && curH < dd.h1;
            return (
              <button
                key={dd.h0}
                type="button"
                className={`absolute top-0 truncate text-center text-[11px] ${on ? 'font-semibold text-[#007bc0]' : 'text-[#5f6368] hover:text-[#1d1d1b]'}`}
                style={{ left: `${(dd.h0 / n) * 100}%`, width: `${((dd.h1 - dd.h0) / n) * 100}%` }}
                onClick={() => {
                  // same time of day on the chosen day (or the closest hour that exists)
                  const hod = new Date(nowMs).getUTCHours();
                  let target = dd.h0;
                  for (let h = dd.h0; h < dd.h1; h++) if (new Date(d!.week.ms[h]).getUTCHours() <= hod) target = h;
                  st.setTMin(target * 60 + (tMin % 60));
                }}
              >
                {dd.h1 - dd.h0 >= 8 ? dd.label.split(' ').slice(0, 2).join(' ') : ''}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
