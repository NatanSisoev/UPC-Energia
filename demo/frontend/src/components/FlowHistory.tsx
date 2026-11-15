import { useSim, derived, visibleLimitH } from '../store/useSim';
import { fmtKw } from '../lib/format';
import { hourLabel } from '../lib/assistant';

const DAY = 86_400_000;
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const kwh = (v: number) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(2)} MWh` : `${v.toFixed(0)} kWh`);

/**
 * Week history of a signed power series (a cable, the battery, the grid connection), the same way buildings and
 * solar panels show theirs: KPIs, the week chart with the history / forecast split, energy by day and a typical day.
 * Positive and negative values get their own colour (e.g. towards the buildings vs back-feed).
 */
export default function FlowHistory({
  series,
  pos,
  neg,
  ratingKw,
}: {
  series: Float64Array;
  /** label + colour of positive values */
  pos: { label: string; color: string };
  /** label + colour of negative values (omit when the series is never negative) */
  neg?: { label: string; color: string };
  /** draws a loading % against this rating */
  ratingKw?: number;
}) {
  const tMin = useSim((s) => s.tMin);
  const fcStage = useSim((s) => s.fcStage);
  const fcReveal = useSim((s) => s.fcReveal);
  useSim((s) => s.version);
  const d = derived.current;
  if (!d) return null;
  const n = series.length;
  const curH = Math.min(n - 1, Math.floor(tMin / 60));
  const nowH = d.nowH;
  const split = nowH ?? n;
  const fcLim = visibleLimitH({ fcStage, fcReveal });

  /* KPIs */
  let posE = 0;
  let negE = 0;
  let peakH = 0;
  let idle = 0;
  for (let h = 0; h < n; h++) {
    const v = series[h];
    if (v >= 0) posE += v;
    else negE -= v;
    if (Math.abs(v) > Math.abs(series[peakH])) peakH = h;
    if (Math.abs(v) <= 5) idle++;
  }
  const avg = Array.from(series).reduce((a, v) => a + Math.abs(v), 0) / n;
  const maxLoad = ratingKw ? (100 * Math.abs(series[peakH])) / ratingKw : null;

  /* week chart (zero line in the middle when there are negative values) */
  const maxAbs = Math.max(1, ...Array.from(series, Math.abs)) * 1.1;
  const hasNeg = !!neg && Array.from(series).some((v) => v < -5);
  const H = 62;
  const zero = hasNeg ? H / 2 : H - 2;
  const scale = hasNeg ? (H / 2 - 3) / maxAbs : (H - 5) / maxAbs;
  const dayLines: number[] = [];
  for (let h = 1; h < n; h++) if (Math.floor(d.week.ms[h] / DAY) !== Math.floor(d.week.ms[h - 1] / DAY)) dayLines.push(h);

  /* energy by day (throughput) and typical day (measured hours) */
  const days: Array<{ k: number; e: number; fc: boolean; h0: number }> = [];
  for (let h = 0; h < n; h++) {
    const k = Math.floor(d.week.ms[h] / DAY);
    if (!days.length || days[days.length - 1].k !== k) days.push({ k, e: 0, fc: false, h0: h });
    days[days.length - 1].e += Math.abs(series[h]);
    if (h >= split) days[days.length - 1].fc = true;
  }
  const dMax = Math.max(1, ...days.map((x) => x.e));
  const hod = new Float64Array(24);
  const hodN = new Float64Array(24);
  for (let h = 0; h < Math.max(1, Math.min(n, split)); h++) {
    const k = new Date(d.week.ms[h]).getUTCHours();
    hod[k] += series[h];
    hodN[k]++;
  }
  const prof = Array.from(hod, (v, i) => (hodN[i] ? v / hodN[i] : 0));
  const pMax = Math.max(1, ...prof.map(Math.abs));

  return (
    <div>
      <div className="mb-3 grid grid-cols-3 gap-2">
        <Kpi k="Now" v={fmtKw(Math.abs(series[curH]))} sub={Math.abs(series[curH]) <= 5 ? 'idle' : series[curH] >= 0 ? pos.label : neg?.label} />
        <Kpi k="Peak" v={fmtKw(Math.abs(series[peakH]))} sub={hourLabel(peakH).slice(0, 10)} />
        <Kpi k="Average" v={fmtKw(avg)} />
        <Kpi k={neg ? pos.label : 'Energy (week)'} v={kwh(posE)} />
        {neg ? <Kpi k={neg.label} v={kwh(negE)} /> : <Kpi k="Idle hours" v={`${idle} / ${n}`} />}
        {maxLoad != null ? <Kpi k="Max loading" v={`${maxLoad.toFixed(1)}%`} sub={`of ${(ratingKw! / 1000).toFixed(1)} MW`} /> : neg ? <Kpi k="Idle hours" v={`${idle} / ${n}`} /> : null}
      </div>

      <div className="mb-1 flex items-center justify-between">
        <span className="eyebrow">This week</span>
        <span className="flex items-center gap-2.5 text-[10px] muted">
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-sm" style={{ background: pos.color }} />
            {pos.label}
          </span>
          {neg && (
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm" style={{ background: neg.color }} />
              {neg.label}
            </span>
          )}
        </span>
      </div>
      <div className="relative mb-1 h-[92px] rounded-md bg-[var(--surface-2)]">
        {nowH != null && nowH < n && <div className="hatch absolute inset-y-0 right-0 rounded-r-md" style={{ left: `${(nowH / n) * 100}%` }} />}
        {nowH != null && fcLim < n && <div className="absolute inset-y-0 right-0 z-10 flex items-center justify-center rounded-r-md bg-[var(--surface-2)] text-[10px] faint" style={{ left: `${(fcLim / n) * 100}%` }}>{fcStage === "off" ? "forecast not generated" : ""}</div>}
        <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 ${n} ${H}`} preserveAspectRatio="none" aria-hidden>
          {dayLines.map((h) => (
            <line key={h} x1={h} x2={h} y1={0} y2={H} stroke="var(--border)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          ))}
          {hasNeg && <line x1={0} x2={n} y1={zero} y2={zero} stroke="var(--border-strong)" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
          {ratingKw && ratingKw < maxAbs && <line x1={0} x2={n} y1={zero - ratingKw * scale} y2={zero - ratingKw * scale} stroke="var(--danger)" strokeDasharray="3 3" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
          {Array.from(series).map((v, h) => {
            const hgt = Math.abs(v) * scale;
            return (
              <rect
                key={h}
                x={h + 0.08}
                width={0.84}
                y={v >= 0 ? zero - hgt : zero}
                height={Math.max(0, hgt)}
                fill={v >= 0 ? pos.color : (neg?.color ?? pos.color)}
                opacity={h >= split ? 0.4 : 0.9}
              />
            );
          })}
          <line x1={curH + 0.5} x2={curH + 0.5} y1={0} y2={H} stroke="var(--text)" strokeWidth={1} opacity={0.6} vectorEffect="non-scaling-stroke" />
        </svg>
        <span className="tnum absolute left-1.5 top-1 text-[9.5px] faint">{fmtKw(maxAbs / 1.1)}</span>
      </div>
      <div className="mb-4 flex justify-between text-[10px] faint">
        <span>solid = measured · light / hatched = forecast</span>
        {ratingKw && <span>dashed red = rating</span>}
      </div>

      <div className="mb-1 eyebrow">Energy by day</div>
      <div className="mb-4 flex h-20 items-end gap-1.5">
        {days.map((x) => {
          const t = new Date(x.k * DAY);
          const cur = Math.floor(d.week.ms[curH] / DAY) === x.k;
          return (
            <button key={x.k} type="button" className="flex h-full flex-1 flex-col items-center justify-end gap-1" title={`${kwh(x.e)}${x.fc ? ' (incl. forecast)' : ''}`} onClick={() => useSim.getState().setTMin(x.h0 * 60 + (tMin % 1440))}>
              <div className={`w-full rounded-t-[3px] ${x.fc ? 'hatch border border-dashed' : ''}`} style={{ height: `${(x.e / dMax) * 100}%`, background: x.fc ? undefined : cur ? pos.color : 'var(--border-strong)', borderColor: pos.color }} />
              <span className={`tnum text-[10px] ${cur ? 'font-semibold' : 'faint'}`}>{DOW[t.getUTCDay()].slice(0, 2)}</span>
            </button>
          );
        })}
      </div>

      <div className="mb-1 eyebrow">Typical day (measured hours)</div>
      <svg className="h-[46px] w-full rounded-md bg-[var(--surface-2)]" viewBox="0 0 24 40" preserveAspectRatio="none" aria-hidden>
        {prof.map((v, i) => {
          const hh = (Math.abs(v) / pMax) * (hasNeg ? 18 : 36);
          const z = hasNeg ? 20 : 38;
          return <rect key={i} x={i + 0.1} width={0.8} y={v >= 0 ? z - hh : z} height={hh} fill={v >= 0 ? pos.color : (neg?.color ?? pos.color)} opacity={0.85} />;
        })}
      </svg>
      <div className="tnum mt-0.5 flex justify-between text-[9.5px] faint">
        {['00', '06', '12', '18', '24'].map((l) => (
          <span key={l}>{l}</span>
        ))}
      </div>
    </div>
  );
}

function Kpi({ k, v, sub }: { k: string; v: string; sub?: string }) {
  return (
    <div className="rounded-md bg-[var(--surface-2)] px-2.5 py-2">
      <div className="eyebrow !text-[9px]">{k}</div>
      <div className="tnum mt-0.5 text-[13px] font-medium">{v}</div>
      {sub && <div className="truncate text-[10px] faint">{sub}</div>}
    </div>
  );
}
