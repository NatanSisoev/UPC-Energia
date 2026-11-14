import { useMemo, useRef } from 'react';
import { Pause, Play } from 'lucide-react';
import { derived, useSim } from '../store/useSim';
import { sunAt } from '../lib/sun';
import { clockAt, dayLabelAt } from '../lib/format';
import { Chip } from './ui';

const SPEEDS: Array<[number, string]> = [
  [60, '1×'],
  [180, '3×'],
  [480, '8×'],
  [1200, '20×'],
];

/** Bottom control: play/speed + a scrubbable week ribbon showing day/night, price and what the battery does. */
export default function TimeBar() {
  const tMin = useSim((s) => s.tMin);
  const playing = useSim((s) => s.playing);
  const speed = useSim((s) => s.speed);
  const version = useSim((s) => s.version);
  const trackRef = useRef<HTMLDivElement>(null);
  const d = derived.current;
  const total = 168 * 60;

  const ribbon = useMemo(() => {
    if (!d) return null;
    const rows = [];
    let pMax = 0;
    for (let h = 0; h < 168; h++) pMax = Math.max(pMax, d.week.price[h]);
    let spMax = 1;
    for (let h = 0; h < 168; h++) spMax = Math.max(spMax, Math.abs(d.chosen.sp[h]));
    for (let h = 0; h < 168; h++) {
      const el = sunAt(d.startMs + h * 3_600_000 + 1_800_000).elev;
      rows.push({ h, day: Math.min(1, Math.max(0, (el + 6) / 18)), sp: d.chosen.sp[h] / spMax, price: d.week.price[h] / pMax });
    }
    const days = Array.from({ length: 7 }, (_, i) => dayLabelAt(d.startMs, i * 1440).split(' ')[0]);
    return { rows, days };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, d?.week.start]);

  const seek = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    useSim.getState().setTMin(Math.min(total - 1, Math.max(0, ((clientX - r.left) / r.width) * total)));
  };

  const st = useSim.getState();
  const startMs = d?.startMs ?? 0;

  return (
    <div className="panel pointer-events-auto flex w-full max-w-[860px] items-center gap-3 !rounded-[22px] px-3 py-2.5">
      <button type="button" onClick={() => st.setPlaying(!playing)} className="btn btn-on !h-12 !w-12 !rounded-2xl" style={{ '--accent': '#3ee6ff' } as React.CSSProperties} aria-label={playing ? 'Pause' : 'Play'}>
        {playing ? <Pause size={20} strokeWidth={3} /> : <Play size={20} strokeWidth={3} />}
      </button>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div
          ref={trackRef}
          className="relative h-11 cursor-ew-resize touch-none overflow-hidden rounded-xl border-2 border-[#0b1128]"
          onPointerDown={(e) => {
            (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
            seek(e.clientX);
          }}
          onPointerMove={(e) => e.buttons === 1 && seek(e.clientX)}
        >
          <svg className="absolute inset-0 h-full w-full" viewBox="0 0 168 44" preserveAspectRatio="none">
            {ribbon?.rows.map((r) => (
              <g key={r.h}>
                <rect x={r.h} y={0} width={1.02} height={44} fill={`rgb(${Math.round(26 + 190 * r.day)},${Math.round(34 + 160 * r.day)},${Math.round(76 + 90 * r.day)})`} />
                {/* price heat strip */}
                <rect x={r.h} y={40} width={1.02} height={4} fill={`hsl(${120 - 120 * r.price} 90% 55%)`} />
                {/* battery action: up = charge (violet), down = discharge (amber) */}
                {r.sp > 0.02 ? (
                  <rect x={r.h + 0.1} y={19 - r.sp * 17} width={0.82} height={r.sp * 17} fill="#7a52ff" />
                ) : r.sp < -0.02 ? (
                  <rect x={r.h + 0.1} y={19} width={0.82} height={-r.sp * 17} fill="#ffb02e" />
                ) : null}
              </g>
            ))}
            <line x1={0} x2={168} y1={19} y2={19} stroke="#ffffff55" strokeWidth={0.3} />
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <line key={i} x1={i * 24} x2={i * 24} y1={0} y2={44} stroke="#ffffff55" strokeWidth={0.25} />
            ))}
          </svg>
          {/* playhead */}
          <div className="pointer-events-none absolute inset-y-0 w-[3px] bg-white shadow-[0_0_10px_#fff]" style={{ left: `calc(${(tMin / total) * 100}% - 1.5px)` }} />
          <div className="pointer-events-none absolute top-0 -translate-x-1/2 rounded-b-md bg-white px-1 text-[9px] font-black text-slate-900" style={{ left: `${(tMin / total) * 100}%` }}>
            ▼
          </div>
        </div>
        <div className="flex justify-between px-0.5 text-[9px] font-extrabold uppercase tracking-wider text-slate-400">
          {ribbon?.days.map((x, i) => (
            <span key={i}>{x}</span>
          ))}
        </div>
      </div>

      <div className="tnum w-[92px] shrink-0 text-center leading-tight">
        <div className="font-display text-[22px] text-white">{clockAt(startMs, tMin)}</div>
        <div className="text-[10px] font-extrabold uppercase tracking-wider text-cyan-300">{dayLabelAt(startMs, tMin)}</div>
      </div>

      <div className="flex shrink-0 flex-col gap-1.5">
        <div className="flex gap-1">
          {SPEEDS.map(([s, l]) => (
            <Chip key={s} active={speed === s} onClick={() => st.setSpeed(s)}>
              {l}
            </Chip>
          ))}
        </div>
        <div className="flex gap-1">
          {(
            [
              [7, '🌅'],
              [13, '☀️'],
              [20, '🌆'],
              [3, '🌙'],
            ] as Array<[number, string]>
          ).map(([hr, em]) => (
            <button key={hr} type="button" className="btn !px-2 !py-0.5 !text-[11px]" title={`Jump to ${hr}:00`} onClick={() => st.setTMin(Math.floor(tMin / 1440) * 1440 + hr * 60)}>
              {em}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
