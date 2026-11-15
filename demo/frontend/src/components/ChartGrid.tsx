import { useId, useMemo } from 'react';
import { Area, Bar, CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { derived, useSim, visibleLimitH } from '../store/useSim';
import { SOURCE } from '../lib/supply';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const p2 = (n: number) => String(n).padStart(2, '0');

type Row = Record<string, number | null> & { h: number };
interface Ser {
  key: string;
  name: string;
  color: string;
  kind: 'area' | 'line' | 'bar';
  axis?: 'l' | 'r';
}
interface ChartDef {
  title: string;
  unit: string;
  dec: number;
  series: Ser[];
  /** y domain of the right axis, when there is one */
  rDomain?: [number, number];
}

/**
 * Pinned timeline: a grid of charts sharing the week's time axis, the playhead and one synchronised hover tooltip.
 * Same conventions as the timeline strip: measured to the left of NOW, dashed forecast + hatched area to its right,
 * nothing drawn beyond the hours the forecast has generated so far. Click a chart to move the playhead.
 */
export default function ChartGrid() {
  const version = useSim((s) => s.version);
  const tMin = useSim((s) => s.tMin);
  const stage = useSim((s) => s.fcStage);
  const reveal = useSim((s) => s.fcReveal);
  const d = derived.current;
  const uid = useId().replace(/:/g, '');
  const lim = Math.floor(visibleLimitH({ fcStage: stage, fcReveal: reveal }));
  const nowH = d?.nowH ?? null;

  const rows = useMemo<Row[]>(() => {
    if (!d) return [];
    const n = d.week.load.length;
    const cap = Math.max(1, d.chosen.socEnd.reduce((a, b) => Math.max(a, b), 1));
    const out: Row[] = [];
    for (let h = 0; h < n; h++) {
      const vals: Record<string, number> = {
        irr: d.week.irr[h],
        pv: d.pvTot[h] / 1000,
        load: d.week.load[h] / 1000,
        base: d.chosen.baseGrid[h] / 1000,
        grid: d.chosen.grid[h] / 1000,
        soc: (d.chosen.socEnd[h] / cap) * 100,
        batt: d.chosen.sp[h] / 1000,
        price: d.week.price[h],
        co2: d.week.co2[h],
        cCo2: d.chosen.cumBaseCo2[h + 1] - d.chosen.cumCo2[h + 1],
        cEur: d.chosen.cumBaseCost[h + 1] - d.chosen.cumCost[h + 1],
      };
      const shown = h < lim;
      const row: Row = { h };
      for (const [k, v] of Object.entries(vals)) {
        // measured part: up to NOW; forecast overlay (key + 'F') starts one hour early so the pieces join
        row[k] = shown && (nowH == null || h <= nowH) ? v : null;
        row[k + 'F'] = shown && nowH != null && h >= nowH - 1 ? v : null;
      }
      out.push(row);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, d?.week.start, nowH, lim]);

  if (!d) return null;
  const n = rows.length;

  const charts: ChartDef[] = [
    { title: 'Solar irradiance', unit: 'W/m²', dec: 0, series: [{ key: 'irr', name: 'Irradiance', color: SOURCE.solar.color, kind: 'area' }] },
    { title: 'PV production', unit: 'MW', dec: 2, series: [{ key: 'pv', name: 'PV', color: SOURCE.solar.color, kind: 'area' }] },
    { title: 'Campus load', unit: 'MW', dec: 2, series: [{ key: 'load', name: 'Load', color: 'var(--text)', kind: 'area' }] },
    {
      title: 'Grid import',
      unit: 'MW',
      dec: 2,
      series: [
        { key: 'base', name: 'No battery', color: 'var(--muted)', kind: 'line' },
        { key: 'grid', name: 'With battery', color: SOURCE.grid.color, kind: 'line' },
      ],
    },
    {
      title: 'Battery power & SOC',
      unit: 'MW / %',
      dec: 2,
      rDomain: [0, 100],
      series: [
        { key: 'batt', name: 'Power (+ charging)', color: 'var(--warn)', kind: 'bar', axis: 'l' },
        { key: 'soc', name: 'SOC %', color: SOURCE.battery.color, kind: 'line', axis: 'r' },
      ],
    },
    { title: 'Electricity price', unit: '€/kWh', dec: 3, series: [{ key: 'price', name: 'Price', color: 'var(--accent)', kind: 'line' }] },
    { title: 'Grid CO₂ intensity', unit: 'kg/kWh', dec: 3, series: [{ key: 'co2', name: 'CO₂', color: 'var(--ok)', kind: 'line' }] },
    {
      title: 'Saved vs no battery',
      unit: 'kg / €',
      dec: 1,
      series: [
        { key: 'cCo2', name: 'CO₂ saved kg', color: 'var(--ok)', kind: 'line', axis: 'l' },
        { key: 'cEur', name: 'Cost saved €', color: 'var(--accent)', kind: 'line', axis: 'r' },
      ],
    },
  ];

  const cursor = tMin / 60;
  const tick = { fill: 'var(--muted)', fontSize: 10 };
  const msAt = (h: number) => d.week.ms[Math.min(n - 1, Math.max(0, Math.round(h)))];
  const dayTick = (h: number) => {
    const t = new Date(msAt(h));
    return t.getUTCHours() === 0 ? DOW[t.getUTCDay()] : '';
  };
  const label = (h: number) => {
    const t = new Date(msAt(h));
    return `${DOW[t.getUTCDay()]} ${t.getUTCDate()} · ${p2(t.getUTCHours())}:00${nowH != null && h > nowH ? ' (forecast)' : ''}`;
  };
  const seek = (h: unknown) => {
    const hh = Number(h);
    if (h != null && Number.isFinite(hh)) useSim.getState().setTMin(Math.min(Math.max(1, lim * 60) - 1, Math.max(0, hh * 60)));
  };
  const yFmt = (v: number) => (Math.abs(v) >= 100 ? String(Math.round(v)) : String(Number(v.toPrecision(2))));
  const ticks = Array.from({ length: Math.ceil(n / 24) }, (_, i) => i * 24);

  return (
    <div className="grid h-full min-h-0 grid-cols-2 grid-rows-4 gap-2 overflow-hidden lg:grid-cols-4 lg:grid-rows-2">
      {charts.map((c, ci) => {
        const hatch = `hatch-${uid}-${ci}`;
        const hasR = c.series.some((s) => s.axis === 'r');
        return (
          <div key={c.title} className="flex min-h-0 min-w-0 flex-col rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 pb-1 pt-1.5">
            <div className="mb-0.5 flex items-baseline justify-between gap-2 text-[11.5px]">
              <span className="truncate font-medium">{c.title}</span>
              <span className="faint shrink-0 text-[10px]">{c.unit}</span>
            </div>
            <div className="min-h-0 flex-1">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={rows} syncId="timeline" margin={{ top: 2, right: hasR ? 2 : 6, left: -6, bottom: 0 }} onClick={(e) => seek(e?.activeLabel)}>
                  <defs>
                    <pattern id={hatch} width={8} height={8} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                      <line x1={0} y1={0} x2={0} y2={8} stroke="var(--accent)" strokeWidth={2} opacity={0.18} />
                    </pattern>
                  </defs>
                  <CartesianGrid stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="h" type="number" domain={[0, n - 1]} ticks={ticks} tickFormatter={dayTick} tick={tick} axisLine={false} tickLine={false} interval={0} />
                  <YAxis yAxisId="l" tickFormatter={yFmt} tick={tick} axisLine={false} tickLine={false} width={40} tickCount={4} />
                  {hasR && <YAxis yAxisId="r" tickFormatter={yFmt} orientation="right" tick={tick} axisLine={false} tickLine={false} width={34} tickCount={4} domain={c.rDomain ?? ['auto', 'auto']} />}
                  <Tooltip
                    labelFormatter={(h) => label(Number(h))}
                    formatter={(v) => (v == null ? '–' : Number(v).toFixed(c.dec))}
                    contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: 8, fontSize: 11.5, padding: '6px 8px', boxShadow: 'var(--shadow-lg)' }}
                    labelStyle={{ color: 'var(--text)', fontWeight: 500 }}
                    itemStyle={{ padding: 0 }}
                    cursor={{ stroke: 'var(--muted)', strokeDasharray: '3 3' }}
                  />
                  {nowH != null && lim > nowH + 1 && <ReferenceArea yAxisId="l" x1={nowH} x2={Math.min(n - 1, lim - 1)} fill={`url(#${hatch})`} strokeOpacity={0} />}
                  {nowH != null && <ReferenceLine yAxisId="l" x={nowH} stroke="var(--text)" strokeOpacity={0.5} />}
                  {c.series.flatMap((s) =>
                    [false, true].map((fc) => {
                      const dataKey = fc ? s.key + 'F' : s.key;
                      if (fc && nowH == null) return null;
                      const common = { yAxisId: s.axis === 'r' ? 'r' : 'l', isAnimationActive: false } as const;
                      const name = fc ? `${s.name} (fc)` : s.name;
                      if (s.kind === 'bar') return <Bar key={dataKey} {...common} dataKey={dataKey} name={name} fill={s.color} fillOpacity={fc ? 0.35 : 0.8} />;
                      if (s.kind === 'area')
                        return <Area key={dataKey} {...common} type="monotone" dataKey={dataKey} name={name} stroke={s.color} fill={s.color} fillOpacity={fc ? 0.08 : 0.25} strokeWidth={1.5} strokeDasharray={fc ? '4 3' : undefined} dot={false} activeDot={fc ? false : { r: 3 }} />;
                      return <Line key={dataKey} {...common} type="monotone" dataKey={dataKey} name={name} stroke={s.color} strokeWidth={1.6} strokeDasharray={fc ? '4 3' : undefined} dot={false} activeDot={fc ? false : { r: 3 }} />;
                    }),
                  )}
                  <ReferenceLine yAxisId="l" x={cursor} stroke="var(--accent)" strokeWidth={2} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        );
      })}
    </div>
  );
}
