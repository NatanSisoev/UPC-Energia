import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Pause, Pin, PinOff, Play, Sparkles } from 'lucide-react';
import { derived, useSim, visibleLimitH } from '../store/useSim';
import { ForecastCard } from './ForecastCard';
import { useAlarms } from '../lib/alarms';
import { fmtKw, weekMsAt } from '../lib/format';
import { Seg } from './kit';
import { DWELL_OPEN_MS, stripHover, togglePin } from '../lib/chartsHover';
import { SOURCE, weekMix, type Source } from '../lib/supply';

const DAY = 86_400_000;
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const p2 = (n: number) => String(n).padStart(2, '0');

/**
 * Timeline. Week or day zoom, drag / click / arrow keys (←→ 1 h, Shift 15 min), step buttons.
 * Left of the NOW marker is measured history, right of it the forecast (hatched, dashed curve).
 * Coloured marks under the curve are alarms.
 */
export default function TimeBar() {
  const tMin = useSim((s) => s.tMin);
  const playing = useSim((s) => s.playing);
  const speed = useSim((s) => s.speed);
  const version = useSim((s) => s.version);
  const showActual = useSim((s) => s.showActual);
  const stage = useSim((s) => s.fcStage);
  const reveal = useSim((s) => s.fcReveal);
  const pinned = useSim((s) => s.chartsPinned);
  const dwelling = useSim((s) => s.chartsDwell);
  const [cardOpen, setCardOpen] = useState(false);
  useEffect(() => {
    if (stage === 'running') setCardOpen(true);
    if (stage === 'off') setCardOpen(false);
  }, [stage]);
  const [zoom, setZoom] = useState<'week' | 'day'>('week');
  /** hour under the pointer (tooltip) */
  const [hv, setHv] = useState<{ h: number; px: number } | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const alarms = useAlarms();
  const d = derived.current;
  const n = d?.week.load.length ?? 168;
  const st = useSim.getState();
  const curH = Math.min(n - 1, Math.floor(tMin / 60));

  /* calendar days of the week (rows can start mid-day or have gaps) */
  const days = useMemo(() => {
    if (!d) return [] as Array<{ h0: number; h1: number; ms: number }>;
    const out: Array<{ h0: number; h1: number; ms: number }> = [];
    for (let h = 0; h < n; h++) {
      const k = Math.floor(d.week.ms[h] / DAY);
      if (!out.length || Math.floor(d.week.ms[out[out.length - 1].h0] / DAY) !== k) out.push({ h0: h, h1: h + 1, ms: d.week.ms[h] });
      else out[out.length - 1].h1 = h + 1;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, d?.week.start]);

  const day = days.find((x) => curH >= x.h0 && curH < x.h1) ?? days[0];
  const [r0, r1] = zoom === 'week' || !day ? [0, n] : [day.h0, day.h1];
  const span = r1 - r0;
  const x = (h: number) => ((h - r0) / span) * 100;
  const nowH = d?.nowH ?? null;
  /** hours that may be drawn: up to LIVE, plus the forecast hours generated so far */
  const lim = visibleLimitH({ fcStage: stage, fcReveal: reveal });
  const limKey = Math.floor(lim);

  const curve = useMemo(() => {
    if (!d) return null;
    const L = Math.max(1, Math.min(n, limKey));
    const hi = Math.max(...d.week.load, ...d.actual.load);
    const y = (v: number) => 36 - (v / Math.max(1, hi)) * 32;
    // demand stacked by source: solar (bottom), battery, public grid (top) — only for the visible hours
    const mixes = weekMix();
    const base = new Float64Array(n);
    const bands = (['solar', 'battery', 'grid'] as Source[]).map((k) => {
      const top = Float64Array.from(base, (v, h) => v + (mixes[h]?.[k] ?? 0));
      let p = `M0.5,${y(top[0]).toFixed(2)}`;
      for (let h = 1; h < L; h++) p += ` L${h + 0.5},${y(top[h]).toFixed(2)}`;
      for (let h = L - 1; h >= 0; h--) p += ` L${h + 0.5},${y(base[h]).toFixed(2)}`;
      base.set(top);
      return { k, d: `${p} Z` };
    });
    // uncertainty band around the forecast demand: widens with the horizon
    let band = '';
    if (nowH != null && L > nowH + 1) {
      const e = (h: number) => 0.04 + 0.0035 * (h - nowH);
      const up: string[] = [];
      const lo: string[] = [];
      for (let h = nowH; h < L; h++) {
        up.push(`${h + 0.5},${y(d.week.load[h] * (1 + e(h))).toFixed(2)}`);
        lo.unshift(`${h + 0.5},${y(d.week.load[h] * (1 - e(h))).toFixed(2)}`);
      }
      band = `M${up.join(' L')} L${lo.join(' L')} Z`;
    }
    const pts = (arr: ArrayLike<number>, a: number, b: number) => {
      const out: string[] = [];
      for (let h = a; h < b; h++) out.push(`${h + 0.5},${y(arr[h]).toFixed(2)}`);
      return out;
    };
    const split = nowH ?? n;
    const hist = pts(d.week.load, 0, Math.min(L, split + 1));
    const fc = split < L ? pts(d.week.load, Math.max(0, split - 1), L) : [];
    const act = split < L ? pts(d.actual.load, Math.max(0, split - 1), L) : [];
    return {
      band,
      bands,
      histArea: hist.length ? `M0.5,36 L${hist.join(' L')} L${Math.min(n, split + 1) - 0.5},36 Z` : '',
      histLine: hist.length ? `M${hist.join(' L')}` : '',
      fcLine: fc.length ? `M${fc.join(' L')}` : '',
      actLine: act.length ? `M${act.join(' L')}` : '',
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, d?.week.start, nowH, limKey]);

  const total = Math.max(1, Math.floor(lim) * 60); // the future is not seekable until it has been generated
  const seek = (clientX: number, fine: boolean) => {
    const el = trackRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const raw = r0 * 60 + ((clientX - r.left) / r.width) * span * 60;
    const q = zoom === 'day' || fine ? 5 : 15;
    st.setTMin(Math.min(total - 1, Math.max(0, Math.round(raw / q) * q)));
  };
  const step = (min: number) => st.setTMin(Math.min(total - 1, Math.max(0, tMin + min)));

  const nowMs = d ? weekMsAt(d.week.ms, tMin) : 0;
  const nd = new Date(nowMs);
  const isFc = nowH != null && curH >= nowH;
  const sevColor = { critical: 'var(--danger)', warning: 'var(--warn)', info: 'var(--info)' } as const;

  return (
    <div
      className="group/tb pointer-events-auto relative flex w-full items-stretch gap-4 px-4 py-3"
      onPointerEnter={stripHover.enter}
      onPointerMove={stripHover.move}
      onPointerLeave={stripHover.leave}
      onPointerDownCapture={stripHover.down}
    >
      {/* dwell hint: a thin bar filling along the top border while the pointer rests here */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[2px] overflow-hidden rounded-t-[inherit]" aria-hidden>
        <div
          className="h-full bg-[var(--accent)]"
          style={{ width: dwelling ? '100%' : '0%', opacity: dwelling ? 0.8 : 0, transition: dwelling ? `width ${DWELL_OPEN_MS}ms linear` : 'none' }}
        />
      </div>
      {/* secondary control: the panel opens on a long hover; pin keeps it open regardless of hover (Esc / click again to close) */}
      {/* transport */}
      <div className="flex shrink-0 items-center gap-1.5">
        <button type="button" onClick={() => st.setPlaying(!playing)} className={`icon-btn ${playing ? 'on' : ''}`} aria-label={playing ? 'Pause' : 'Play'} title={playing ? 'Pause' : 'Play'}>
          {playing ? <Pause size={15} /> : <Play size={15} />}
        </button>
        <button type="button" className="icon-btn !w-7" onClick={() => step(zoom === 'day' ? -15 : -60)} aria-label="Step back" title={zoom === 'day' ? '−15 min' : '−1 h'}>
          <ChevronLeft size={15} />
        </button>
        <button type="button" className="icon-btn !w-7" onClick={() => step(zoom === 'day' ? 15 : 60)} aria-label="Step forward" title={zoom === 'day' ? '+15 min' : '+1 h'}>
          <ChevronRight size={15} />
        </button>
        <select className="h-7 rounded-md border border-[var(--border-strong)] bg-[var(--surface)] px-1 text-[11.5px] outline-none focus:border-[var(--accent)]" value={speed} onChange={(e) => st.setSpeed(Number(e.target.value))} aria-label="Playback speed" title="Playback speed (simulated time per second)">
          {[[15, '¼ h/s'], [30, '½ h/s'], [60, '1 h/s'], [180, '3 h/s'], [480, '8 h/s'], [1200, '20 h/s']].map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </div>

      <div className="w-[128px] shrink-0 leading-tight">
        <div className="tnum text-[22px] font-medium">
          {p2(nd.getUTCHours())}:{p2(nd.getUTCMinutes())}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] muted">
          {DOW[nd.getUTCDay()]} {nd.getUTCDate()} {MON[nd.getUTCMonth()]}
          {nowH != null && <span className={`badge ${curH === nowH ? 'badge-ok' : isFc ? 'badge-fc' : 'badge-hist'}`}>{curH === nowH ? 'live' : isFc ? 'forecast' : 'history'}</span>}
        </div>
      </div>

      {/* track */}
      <div className="relative min-w-0 flex-1">
        {hv && d && hv.h < lim && <HourTip h={hv.h} px={hv.px} width={trackRef.current?.clientWidth ?? 0} nowH={nowH} />}
        {cardOpen && stage !== 'off' && <ForecastCard onClose={() => setCardOpen(false)} />}
        <div
          ref={trackRef}
          className="relative h-[46px] cursor-pointer touch-none select-none overflow-hidden rounded-md"
          style={{ background: 'var(--surface-2)' }}
          onPointerDown={(e) => {
            (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
            seek(e.clientX, e.shiftKey);
          }}
          onPointerMove={(e) => {
            if (e.buttons === 1) seek(e.clientX, e.shiftKey);
            const r = e.currentTarget.getBoundingClientRect();
            const px = Math.min(r.width, Math.max(0, e.clientX - r.left));
            setHv({ h: Math.min(r1 - 1, Math.max(r0, Math.floor(r0 + (px / r.width) * span))), px });
          }}
          onPointerLeave={() => setHv(null)}
          role="slider"
          aria-label="Time"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={Math.round(tMin)}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') step(e.shiftKey ? 15 : 60);
            if (e.key === 'ArrowLeft') step(e.shiftKey ? -15 : -60);
          }}
        >
          {/* generated forecast region (grows while the forecast is being generated) */}
          {nowH != null && nowH < r1 && lim > nowH + 1 && (
            <div className="hatch absolute inset-y-0" style={{ left: `${Math.max(0, x(nowH))}%`, width: `${Math.max(0, Math.min(100 - Math.max(0, x(nowH)), x(Math.min(lim, r1)) - Math.max(0, x(nowH))))}%` }}>
              <span className="eyebrow absolute right-1.5 top-1 !text-[9px] !text-[var(--accent)]">Forecast</span>
            </div>
          )}
          {/* not generated yet: the future is locked until the user asks for the forecast */}
          {nowH != null && stage !== 'ready' && lim < r1 && (
            <div className="absolute inset-y-0 z-20 flex items-center justify-center" style={{ left: `${Math.max(0, x(lim))}%`, right: 0, background: 'repeating-linear-gradient(135deg, transparent 0 6px, var(--border) 6px 7px)' }}>
              {stage === 'off' ? (
                <button
                  type="button"
                  className="btn-primary pointer-events-auto !py-1 !text-[12px]"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    st.generateForecast();
                  }}
                  title="Predict demand and solar for the rest of the week, then plan the battery over it"
                >
                  <Sparkles size={13} /> Generate forecast
                </button>
              ) : (
                <span className="eyebrow !text-[9px] !text-[var(--accent)]">computing…</span>
              )}
            </div>
          )}
          {nowH != null && nowH > r0 && <span className="eyebrow absolute left-1.5 top-1 !text-[9px]">History</span>}

          <svg className="absolute inset-0 h-full w-full" viewBox={`${r0} 0 ${span} 46`} preserveAspectRatio="none" aria-hidden>
            {/* day / hour grid */}
            {zoom === 'week'
              ? days.slice(1).map((dd) => <line key={dd.h0} x1={dd.h0} x2={dd.h0} y1={0} y2={46} stroke="var(--border-strong)" strokeWidth={1} vectorEffect="non-scaling-stroke" />)
              : Array.from({ length: span - 1 }, (_, i) => r0 + i + 1).map((h) => (
                  <line key={h} x1={h} x2={h} y1={new Date(d!.week.ms[h]).getUTCHours() % 6 === 0 ? 0 : 36} y2={46} stroke="var(--border)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                ))}
            {curve && (
              <>
                {curve.bands.map((b) => (
                  <path key={b.k} d={b.d} fill={SOURCE[b.k].color} opacity={0.55} />
                ))}
                {curve.band && <path d={curve.band} fill="var(--accent)" opacity={0.14} />}
                <path d={curve.histLine} fill="none" stroke="var(--text)" strokeOpacity={0.55} strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
                <path d={curve.fcLine} fill="none" stroke="var(--text)" strokeOpacity={0.6} strokeWidth={1.2} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
                {showActual && <path d={curve.actLine} fill="none" stroke="var(--muted)" strokeWidth={1} opacity={0.8} vectorEffect="non-scaling-stroke" />}
              </>
            )}
            {/* alarms */}
            {alarms
              .filter((a) => a.endH > r0 && a.startH < r1 && a.endH - a.startH < n)
              .map((a) => (
                <rect key={a.id} x={a.startH} y={40} width={Math.max(0.35, a.endH - a.startH)} height={4} fill={sevColor[a.severity]} opacity={0.85} />
              ))}
          </svg>

          {/* generation front: a glowing scan line at the last forecast hour revealed */}
          {stage === 'running' && nowH != null && lim >= r0 && lim <= r1 && (
            <div className="pointer-events-none absolute inset-y-0 w-0.5 animate-pulse bg-[var(--accent)]" style={{ left: `${x(lim)}%`, boxShadow: '0 0 10px 2px var(--accent)' }} />
          )}

          {/* hovered hour */}
          {hv && hv.h < lim && <div className="pointer-events-none absolute inset-y-0 bg-[var(--text)] opacity-[0.08]" style={{ left: `${x(hv.h)}%`, width: `${100 / span}%`, minWidth: 2 }} />}

          {/* now marker */}
          {nowH != null && nowH >= r0 && nowH <= r1 && (
            <div className="pointer-events-none absolute inset-y-0" style={{ left: `${x(nowH)}%` }}>
              <div className="h-full w-px bg-[var(--text)] opacity-70" />
              <span className="tnum absolute bottom-0.5 left-1 rounded bg-[var(--text)] px-1 text-[9px] font-semibold text-[var(--surface)]">NOW</span>
            </div>
          )}
          {/* playhead */}
          {curH >= r0 && curH < r1 && (
            <>
              <div className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-[var(--accent)]" style={{ left: `${x(tMin / 60)}%` }} />
              <div className="pointer-events-none absolute top-0 h-2 w-2 -translate-x-1/2 rotate-45 bg-[var(--accent)]" style={{ left: `${x(tMin / 60)}%`, marginTop: -4 }} />
            </>
          )}
        </div>

        {/* scale */}
        <div className="relative mt-1 h-4 select-none">
          {zoom === 'week'
            ? days.map((dd) => {
                const on = curH >= dd.h0 && curH < dd.h1;
                const t = new Date(dd.ms);
                return (
                  <button
                    key={dd.h0}
                    type="button"
                    className={`tnum absolute top-0 truncate text-center text-[10.5px] ${on ? 'font-semibold text-[var(--accent)]' : 'muted hover:text-[var(--text)]'}`}
                    style={{ left: `${x(dd.h0)}%`, width: `${((dd.h1 - dd.h0) / span) * 100}%` }}
                    onClick={() => {
                      const hod = nd.getUTCHours();
                      let target = dd.h0;
                      for (let h = dd.h0; h < dd.h1; h++) if (new Date(d!.week.ms[h]).getUTCHours() <= hod) target = h;
                      st.setTMin(target * 60 + (tMin % 60));
                    }}
                    onDoubleClick={() => setZoom('day')}
                    title="Click: go to this day · double-click: zoom in"
                  >
                    {dd.h1 - dd.h0 >= 8 ? `${DOW[t.getUTCDay()]} ${t.getUTCDate()}` : ''}
                  </button>
                );
              })
            : Array.from({ length: span }, (_, i) => r0 + i)
                .filter((h) => new Date(d!.week.ms[h]).getUTCHours() % 3 === 0)
                .map((h) => (
                  <span key={h} className="tnum absolute top-0 -translate-x-1/2 text-[10.5px] muted" style={{ left: `${x(h)}%` }}>
                    {p2(new Date(d!.week.ms[h]).getUTCHours())}h
                  </span>
                ))}
        </div>
      </div>

      <div className="flex shrink-0 flex-col items-end justify-center gap-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={togglePin}
            className={`icon-btn !h-[26px] !w-[26px] shrink-0 border border-[var(--border-strong)] bg-[var(--surface)] ${pinned ? 'on' : ''}`}
            aria-label={pinned ? 'Unpin charts' : 'Pin charts open'}
            aria-pressed={pinned}
            title={pinned ? 'Unpin charts (Esc)' : 'Pin charts open'}
          >
            {pinned ? <PinOff size={14} /> : <Pin size={14} />}
          </button>
          <Seg
            label="Timeline zoom"
            value={zoom}
            onChange={setZoom}
            options={[
              ['week', 'Week'],
              ['day', 'Day'],
            ]}
          />
        </div>
        {nowH != null && (
          <div className="flex items-center justify-end gap-3 whitespace-nowrap leading-none">
            {stage === 'ready' && (
              <>
                {!cardOpen && (
                  <button type="button" className="text-[11.5px] font-medium muted hover:text-[var(--text)]" onClick={() => setCardOpen(true)}>
                    Forecast details
                  </button>
                )}
                <button type="button" className="text-[11.5px] font-medium muted hover:text-[var(--text)]" onClick={() => st.clearForecast()}>
                  Hide forecast
                </button>
              </>
            )}
            <button type="button" className="text-[11.5px] font-medium text-[var(--accent)] hover:underline" onClick={() => st.goLive()}>
              Jump to now
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Tooltip for one hour of the timeline: demand and the share supplied by the grid, the battery and solar. */
function HourTip({ h, px, width, nowH }: { h: number; px: number; width: number; nowH: number | null }) {
  const d = derived.current!;
  const m = weekMix()[h];
  if (!m) return null;
  const t = new Date(d.week.ms[h]);
  const kind = nowH == null || h < nowH ? 'history' : h === nowH ? 'live' : 'forecast';
  const sp = d.chosen.sp[h];
  const tot = Math.max(1e-9, m.grid + m.battery + m.solar);
  const W = 230;
  const left = Math.min(Math.max(0, px - W / 2), Math.max(0, width - W));
  return (
    <div className="card fade-in pointer-events-none absolute bottom-[calc(100%+8px)] z-20 p-2.5 text-[12px]" style={{ left, width: W, boxShadow: 'var(--shadow-lg)' }}>
      <div className="flex items-center justify-between gap-2">
        <span className="tnum font-medium">
          {DOW[t.getUTCDay()]} {t.getUTCDate()} {MON[t.getUTCMonth()]} · {p2(t.getUTCHours())}:00–{p2((t.getUTCHours() + 1) % 24)}:00
        </span>
        <span className={`badge ${kind === 'live' ? 'badge-ok' : kind === 'forecast' ? 'badge-fc' : 'badge-hist'}`}>{kind}</span>
      </div>
      <div className="tnum mt-1 text-[11.5px] muted">
        Demand {fmtKw(m.load)} · {d.week.price[h].toFixed(3)} €/kWh
      </div>
      <div className="mt-2 flex h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-3)]">
        {(['grid', 'battery', 'solar'] as Source[]).map((k) => (
          <div key={k} style={{ width: `${(m[k] / tot) * 100}%`, background: SOURCE[k].color }} />
        ))}
      </div>
      <div className="mt-1.5 grid grid-cols-[auto_1fr_auto_auto] items-center gap-x-2 gap-y-0.5">
        {(['grid', 'battery', 'solar'] as Source[]).map((k) => (
          <Fragment key={k}>
            <span className="h-2 w-2 rounded-sm" style={{ background: SOURCE[k].color }} />
            <span className="muted">{SOURCE[k].long}</span>
            <span className="tnum text-right font-medium">{((m[k] / tot) * 100).toFixed(0)}%</span>
            <span className="tnum w-[58px] text-right faint">{fmtKw(m[k])}</span>
          </Fragment>
        ))}
      </div>
      {sp > 5 && <div className="mt-1.5 text-[11px] muted">Battery charging {fmtKw(sp)} from the grid (not counted as supply).</div>}
    </div>
  );
}
