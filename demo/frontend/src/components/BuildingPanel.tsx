import { useMemo, type ReactNode } from 'react';
import { MessageSquare, X } from 'lucide-react';
import { derived, useSim, visibleLimitH } from '../store/useSim';
import { buildLoadShares, buildingSolarKw, installedKwp, PV_ASBUILT_KWP, DEFAULT_TILT } from '../sim/engine';
import { useAlarms } from '../lib/alarms';
import { hourLabel } from '../lib/assistant';
import { fmtKw } from '../lib/format';
import { buildingSheet, gradeColor, pvSheet } from '../data/assets';
import { panelsOf } from '../scene/minimal';
import SolarTab from './SolarTab';
import { SourceLegend } from './SupplyBar';
import { shares, SOURCE, weekMix, type Source } from '../lib/supply';

const DAY = 86_400_000;
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const CATEGORY: Record<string, string> = {
  teaching: 'Teaching',
  lab: 'Laboratories',
  research: 'Research',
  data_center: 'Data centre',
  mixed: 'Innovation / mixed',
  library: 'Library',
  sports: 'Sports',
  residence: 'Residence',
  aux: 'Facilities',
};
const mwh = (kwh: number) => (kwh >= 1000 ? `${(kwh / 1000).toFixed(2)} MWh` : `${kwh.toFixed(0)} kWh`);

/**
 * Sidebar opened by clicking a building: its usage over the week (history + forecast), key figures, energy by
 * day, its typical day, how this week compares with every other recorded week, its solar array and its alarms.
 * Per-building demand is the campus meter split by each building's usage profile (sim/engine.ts buildLoadShares).
 */
export default function BuildingPanel({ id, onClose, onAsk }: { id: string; onClose: () => void; onAsk: (q: string) => void }) {
  const campus = useSim((s) => s.campus)!;
  const replay = useSim((s) => s.replay)!;
  const weekIdx = useSim((s) => s.weekIdx);
  const tMin = useSim((s) => s.tMin);
  const solar = useSim((s) => s.solar);
  const panelModel = useSim((s) => s.panelModel);
  const faults = useSim((s) => s.faults);
  const version = useSim((s) => s.version);
  const alarms = useAlarms();
  const tab = useSim((s) => s.buildingTab);
  const panelCount = panelsOf(id).length;
  const d = derived.current!;
  const bi = campus.features.findIndex((f) => f.properties.osmId === id);
  const p = campus.features[bi]?.properties;
  const n = d.week.load.length;
  const curH = Math.min(n - 1, Math.floor(tMin / 60));
  const nowH = d.nowH ?? n;

  /* this week's series for the building (shown = history + forecast, actual = measured) */
  const series = useMemo(() => {
    const shown = new Float64Array(n);
    const actual = new Float64Array(n);
    for (let h = 0; h < n; h++) {
      shown[h] = d.shares[bi * 168 + h] * d.week.load[h];
      actual[h] = d.shares[bi * 168 + h] * d.actual.load[h];
    }
    return { shown, actual };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, bi]);

  /* energy of this building in every recorded week (measured), for the comparison strip */
  const weeks = useMemo(() => {
    const props = campus.features.map((f) => f.properties);
    return replay.map((w) => {
      const sh = buildLoadShares(props, w.ms, w.load.length);
      let e = 0;
      for (let h = 0; h < w.load.length; h++) e += sh[bi * w.load.length + h] * w.load[h];
      return { start: w.start, kwh: e };
    });
  }, [replay, campus, bi]);

  if (!p) return null;
  const s = series.shown;
  const measured = Array.from({ length: Math.min(n, nowH) }, (_, h) => h);
  const all = Array.from({ length: n }, (_, h) => h);
  const nowKw = s[curH];
  const campusNow = d.week.load[curH];
  const rank = [...campus.features].sort((a, b) => d.shares[campus.features.indexOf(b) * 168 + curH] - d.shares[campus.features.indexOf(a) * 168 + curH]).findIndex((f) => f.properties.osmId === id) + 1;
  const weekKwh = all.reduce((a, h) => a + s[h], 0);
  const peakH = all.reduce((a, h) => (s[h] > s[a] ? h : a), 0);
  const avg = weekKwh / n;
  const minKw = Math.min(...Array.from(s));
  const shareWeek = (100 * weekKwh) / Math.max(1, d.week.load.reduce((a, v) => a + v, 0));
  const intensity = (1000 * weekKwh) / Math.max(1, p.area_m2 * (p.levels ?? Math.max(1, Math.round(p.height_m / 3.6))));

  // energy by calendar day
  const days: Array<{ k: number; kwh: number; fc: boolean }> = [];
  for (let h = 0; h < n; h++) {
    const k = Math.floor(d.week.ms[h] / DAY);
    if (!days.length || days[days.length - 1].k !== k) days.push({ k, kwh: 0, fc: false });
    days[days.length - 1].kwh += s[h];
    if (h >= nowH) days[days.length - 1].fc = true;
  }
  // typical day: mean by hour of day (measured hours only)
  const hod = new Float64Array(24);
  const hodN = new Float64Array(24);
  for (const h of measured.length ? measured : all) {
    const k = new Date(d.week.ms[h]).getUTCHours();
    hod[k] += s[h];
    hodN[k] += 1;
  }
  const prof = Array.from(hod, (v, i) => (hodN[i] ? v / hodN[i] : 0));

  // solar
  const cfg = solar[id] ?? { on: false, fraction: 0, tilt: DEFAULT_TILT };
  const broken = faults.roofs.includes(id);
  const kwp = installedKwp(p, cfg, panelModel);
  const pvWeek = all.reduce((a, h) => a + (broken ? 0 : buildingSolarKw(p, cfg, panelModel, d.week.pv[h] / PV_ASBUILT_KWP)), 0);

  const mine = alarms.filter((a) => a.target === id);
  const sheet = buildingSheet(p);
  const pv = p.pv_fraction > 0 ? pvSheet(p, cfg, panelModel, broken) : null;
  const wMax = Math.max(...weeks.map((w) => w.kwh));
  const wMean = weeks.reduce((a, w) => a + w.kwh, 0) / weeks.length;
  const thisWeek = weeks[weekIdx]?.kwh ?? weekKwh;

  return (
    <aside className="fade-in flex h-full w-full flex-col border-l border-[var(--border)] bg-[var(--surface)]">
      <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-5 py-3.5">
        <div className="min-w-0">
          <div className="eyebrow">Building</div>
          <div className="mt-0.5 flex items-center gap-2">
            <h2 className="truncate text-[17px] font-semibold">{p.short}</h2>
            {broken && <span className="badge badge-crit">PV fault</span>}
          </div>
          <div className="truncate text-[12px] muted">{p.name}</div>
        </div>
        <button type="button" className="icon-btn !h-7 !w-7" onClick={onClose} aria-label="Close building">
          <X size={14} />
        </button>
      </div>

      {/* tabs */}
      <div className="flex gap-5 border-b border-[var(--border)] px-5">
        {(
          [
            ['overview', 'Overview'],
            ['solar', `Solar panels · ${panelCount}`],
          ] as const
        ).map(([k, l]) => (
          <button
            key={k}
            type="button"
            onClick={() => useSim.getState().setPanelUi({ buildingTab: k, panelFocus: null, panelHover: null })}
            className={`-mb-px border-b-2 py-2.5 text-[13px] ${tab === k ? 'border-[var(--accent)] font-medium text-[var(--accent)]' : 'border-transparent muted hover:text-[var(--text)]'}`}
          >
            {l}
          </button>
        ))}
      </div>

      {tab === 'solar' ? (
        <SolarTab id={id} />
      ) : (
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {/* facts */}
        <div className="tnum mb-4 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] muted">
          <span>{CATEGORY[p.category] ?? p.category}</span>
          <span>{Math.round(p.area_m2).toLocaleString('en')} m² footprint</span>
          <span>{p.levels ?? Math.max(1, Math.round(p.height_m / 3.6))} floors</span>
          {p.school && <span className="truncate">{p.school}</span>}
        </div>

        {/* now */}
        <div className="mb-4 grid grid-cols-3 gap-2">
          <Kpi k={d.nowH != null && curH >= d.nowH ? 'Demand · fc' : 'Demand now'} v={fmtKw(nowKw)} />
          <Kpi k="Campus share" v={`${((100 * nowKw) / Math.max(1, campusNow)).toFixed(1)}%`} />
          <Kpi k="Rank now" v={`#${rank} / ${campus.features.length}`} />
        </div>

        <Block title="Demand this week" right={<SourceLegend />}>
          <WeekChart s={series.shown} actual={series.actual} nowH={d.nowH} curH={curH} ms={d.week.ms} showActual={useSim.getState().showActual} />
          <div className="mt-1 flex justify-between text-[10px] faint">
            <Legend />
            <span className="tnum">
              week: {(() => {
                const mixes = weekMix();
                let g = 0;
                let b = 0;
                let so = 0;
                for (let h = 0; h < n; h++) {
                  const sh = shares(mixes[h]);
                  g += s[h] * sh.grid;
                  b += s[h] * sh.battery;
                  so += s[h] * sh.solar;
                }
                const t = Math.max(1e-9, g + b + so);
                return `grid ${((100 * g) / t).toFixed(0)}% · battery ${((100 * b) / t).toFixed(0)}% · solar ${((100 * so) / t).toFixed(0)}%`;
              })()}
            </span>
          </div>
        </Block>

        <div className="mb-4 grid grid-cols-3 gap-2">
          <Kpi k="Energy (week)" v={mwh(weekKwh)} />
          <Kpi k="Peak" v={fmtKw(s[peakH])} sub={hourLabel(peakH).slice(0, 10)} />
          <Kpi k="Average" v={fmtKw(avg)} />
          <Kpi k="Base load" v={fmtKw(minKw)} />
          <Kpi k="Load factor" v={`${((100 * avg) / Math.max(1, s[peakH])).toFixed(0)}%`} />
          <Kpi k="Of campus" v={`${shareWeek.toFixed(1)}%`} />
          <Kpi k="Intensity" v={`${intensity.toFixed(1)} Wh/m²`} sub="per floor area, week" />
          <Kpi k="Floor area" v={`${Math.round(p.area_m2 * (p.levels ?? Math.max(1, Math.round(p.height_m / 3.6)))).toLocaleString('en')} m²`} />
        </div>

        <Block title="Energy by day">
          <div className="flex h-24 items-end gap-1.5">
            {days.map((x) => {
              const max = Math.max(...days.map((y) => y.kwh));
              const t = new Date(x.k * DAY);
              const cur = Math.floor(d.week.ms[curH] / DAY) === x.k;
              return (
                <button key={x.k} type="button" className="flex h-full flex-1 flex-col items-center justify-end gap-1" title={`${mwh(x.kwh)}${x.fc ? ' (incl. forecast)' : ''}`} onClick={() => {
                  const h0 = d.week.ms.findIndex((m) => Math.floor(m / DAY) === x.k);
                  if (h0 >= 0) useSim.getState().setTMin(h0 * 60 + (tMin % 1440));
                }}>
                  <div className={`w-full rounded-t-[3px] ${x.fc ? 'hatch border border-dashed border-[var(--accent)]' : ''}`} style={{ height: `${(x.kwh / max) * 100}%`, background: x.fc ? undefined : cur ? 'var(--accent)' : 'var(--border-strong)' }} />
                  <span className={`tnum text-[10px] ${cur ? 'font-semibold text-[var(--accent)]' : 'faint'}`}>{DOW[t.getUTCDay()].slice(0, 2)}</span>
                </button>
              );
            })}
          </div>
        </Block>

        <Block title="Typical day (measured hours)">
          <Spark values={prof} labels={['00', '06', '12', '18', '24']} />
          <div className="tnum mt-1 text-[11px] muted">
            Busiest around {String(prof.indexOf(Math.max(...prof))).padStart(2, '0')}:00 · quietest around {String(prof.indexOf(Math.min(...prof))).padStart(2, '0')}:00
          </div>
        </Block>

        <Block title={`All ${weeks.length} recorded weeks`}>
          <div className="flex h-16 items-end gap-[2px]">
            {weeks.map((w, i) => (
              <button
                key={w.start}
                type="button"
                className="h-full flex-1"
                title={`${w.start.slice(0, 10)}: ${mwh(w.kwh)}`}
                onClick={() => useSim.getState().setWeek(i)}
                style={{ display: 'flex', alignItems: 'flex-end' }}
              >
                <div className="w-full rounded-t-[2px]" style={{ height: `${(w.kwh / wMax) * 100}%`, background: i === weekIdx ? 'var(--accent)' : 'var(--border-strong)' }} />
              </button>
            ))}
          </div>
          <div className="tnum mt-1.5 flex justify-between text-[10.5px] faint">
            <span>{label(weeks[0]?.start)}</span>
            <span>{label(weeks[weeks.length - 1]?.start)}</span>
          </div>
          <div className="mt-1 text-[11.5px] muted">
            This week {mwh(thisWeek)} — {thisWeek >= wMean ? '+' : '−'}
            {Math.abs((100 * (thisWeek - wMean)) / wMean).toFixed(0)}% vs. the average week ({mwh(wMean)}).
          </div>
        </Block>

        <Block title="Specification & condition" right={<span className="badge" style={{ color: gradeColor(sheet.condition.grade), background: 'var(--surface-2)' }}>{sheet.condition.grade}</span>}>
          <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-[var(--surface-3)]">
            <div className="h-full rounded-full" style={{ width: `${sheet.condition.health * 100}%`, background: gradeColor(sheet.condition.grade) }} />
          </div>
          <div className="mb-2 text-[11.5px] muted">{sheet.condition.note}</div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[12px]">
            {sheet.specs.map((r) => (
              <div key={r.k} className="contents">
                <dt className="faint">{r.k}</dt>
                <dd className="tnum">{r.v}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-1.5 text-[10.5px] faint">Year, class and systems are estimates (no asset register in the challenge data).</div>
        </Block>

        <Block title="Solar on this roof">
          {p.pv_fraction <= 0 ? (
            <div className="text-[12px] muted">Roof not suitable for PV in the model.</div>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              <Kpi k="Installed" v={`${kwp.toFixed(1)} kWp`} />
              <Kpi k="Week yield" v={mwh(pvWeek)} />
              <Kpi k="Covers" v={`${((100 * pvWeek) / Math.max(1, weekKwh)).toFixed(1)}%`} />
              {pv && <Kpi k="Installed in" v={`${pv.year}`} />}
              {pv && <Kpi k="Output vs new" v={`${(pv.condition.health * 100).toFixed(0)}%`} />}
              {pv && <Kpi k="Condition" v={pv.condition.grade} />}
            </div>
          )}
          {(pv || p.pv_fraction > 0) && (
            <div className="mt-3 grid grid-cols-2 gap-2">
              {pv && (
                <button type="button" className="btn justify-center !py-1.5 !text-[12px]" onClick={() => useSim.getState().setPanelUi({ buildingTab: 'solar', panelFocus: null, panelHover: null })}>
                  Solar panels →
                </button>
              )}
              {p.pv_fraction > 0 && (
                <button
                  type="button"
                  className={`btn justify-center !py-1.5 !text-[12px] ${broken ? '' : 'btn-danger'} ${pv ? '' : 'col-span-2'}`}
                  onClick={() => useSim.getState().setFaults({ roofs: broken ? faults.roofs.filter((x) => x !== id) : [...faults.roofs, id] })}
                >
                  {broken ? 'Mark repaired' : 'Simulate fault'}
                </button>
              )}
            </div>
          )}
        </Block>

        <Block title={`Alarms · ${mine.length}`}>
          {mine.length === 0 ? (
            <div className="text-[12px] muted">No alarms for this building this week.</div>
          ) : (
            mine.map((a) => (
              <div key={a.id} className="mb-1.5 rounded-md border border-[var(--border)] px-2.5 py-1.5 text-[12px]">
                <b>{a.title}</b>
                <div className="muted">{a.detail}</div>
              </div>
            ))
          )}
        </Block>
      </div>
      )}

      <div className="border-t border-[var(--border)] px-5 py-3">
        <button type="button" className="btn w-full justify-center" onClick={() => onAsk(`Tell me about ${p.short}`)}>
          <MessageSquare size={14} /> Ask the assistant about {p.short}
        </button>
      </div>
    </aside>
  );
}

const label = (start?: string) => (start ? `${+start.slice(8, 10)} ${MON[+start.slice(5, 7) - 1]} ${start.slice(2, 4)}` : '');

function Kpi({ k, v, sub }: { k: string; v: string; sub?: string }) {
  return (
    <div className="rounded-md bg-[var(--surface-2)] px-2.5 py-2">
      <div className="eyebrow !text-[9px]">{k}</div>
      <div className="tnum mt-0.5 text-[13.5px] font-medium">{v}</div>
      {sub && <div className="tnum text-[10px] faint">{sub}</div>}
    </div>
  );
}

function Block({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="mb-5">
      <div className="mb-2 flex items-center justify-between">
        <span className="eyebrow">{title}</span>
        {right}
      </div>
      {children}
    </section>
  );
}

function Legend() {
  return (
    <span className="flex items-center gap-2 text-[10px] faint">
      <span className="inline-block h-[2px] w-3 bg-[var(--accent)]" /> measured
      <span className="inline-block h-0 w-3 border-t border-dashed border-[var(--accent)]" /> forecast
    </span>
  );
}

/**
 * Week demand chart, stacked by where the energy came from (solar · battery · public grid), with the
 * history / forecast split (forecast lighter and hatched) and the playhead.
 */
function WeekChart({ s, actual, nowH, curH, ms, showActual }: { s: Float64Array; actual: Float64Array; nowH: number | null; curH: number; ms: number[]; showActual: boolean }) {
  const fcStage = useSim((x) => x.fcStage);
  const fcReveal = useSim((x) => x.fcReveal);
  const fcLim = visibleLimitH({ fcStage, fcReveal });
  const n = s.length;
  const max = Math.max(...Array.from(s), ...(showActual ? Array.from(actual) : [])) * 1.08 || 1;
  const y = (v: number) => 60 - (v / max) * 56;
  const path = (arr: Float64Array, a: number, b: number) => Array.from({ length: Math.max(0, b - a) }, (_, i) => `${i ? 'L' : 'M'}${a + i + 0.5},${y(arr[a + i]).toFixed(2)}`).join(' ');
  const split = nowH ?? n;
  const dayLines: number[] = [];
  for (let h = 1; h < n; h++) if (Math.floor(ms[h] / DAY) !== Math.floor(ms[h - 1] / DAY)) dayLines.push(h);
  // stacked bands: solar at the bottom, then battery, then grid (the building's share of the campus mix)
  const mixes = weekMix();
  const lo = new Float64Array(n);
  const bands = (['solar', 'battery', 'grid'] as Source[]).map((k) => {
    const top = new Float64Array(n);
    for (let h = 0; h < n; h++) top[h] = lo[h] + s[h] * (shares(mixes[h] ?? { grid: 1, battery: 0, solar: 0, load: 1 })[k] ?? 0);
    const area = (a: number, b: number) => {
      if (b <= a) return '';
      let p = `M${a + 0.5},${y(top[a]).toFixed(2)}`;
      for (let h = a + 1; h < b; h++) p += ` L${h + 0.5},${y(top[h]).toFixed(2)}`;
      for (let h = b - 1; h >= a; h--) p += ` L${h + 0.5},${y(lo[h]).toFixed(2)}`;
      return `${p} Z`;
    };
    const res = { k, hist: area(0, Math.min(n, split + 1)), fc: area(Math.max(0, split), n) };
    lo.set(top);
    return res;
  });
  return (
    <div className="relative h-[92px] rounded-md bg-[var(--surface-2)]">
      {nowH != null && nowH < n && <div className="hatch absolute inset-y-0 right-0 rounded-r-md" style={{ left: `${(nowH / n) * 100}%` }} />}
      {nowH != null && fcLim < n && <div className="absolute inset-y-0 right-0 z-10 flex items-center justify-center rounded-r-md bg-[var(--surface-2)] text-[10px] faint" style={{ left: `${(fcLim / n) * 100}%` }}>{fcStage === "off" ? "forecast not generated" : ""}</div>}
      <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 ${n} 62`} preserveAspectRatio="none" aria-hidden>
        {dayLines.map((h) => (
          <line key={h} x1={h} x2={h} y1={0} y2={62} stroke="var(--border)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        ))}
        {bands.map((b) => (
          <g key={b.k}>
            <path d={b.hist} fill={SOURCE[b.k].color} opacity={0.85} />
            <path d={b.fc} fill={SOURCE[b.k].color} opacity={0.35} />
          </g>
        ))}
        <path d={path(s, 0, Math.min(n, split + 1))} fill="none" stroke="var(--text)" strokeOpacity={0.5} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        {split < n && <path d={path(s, Math.max(0, split), n)} fill="none" stroke="var(--text)" strokeOpacity={0.6} strokeWidth={1.2} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />}
        {showActual && split < n && <path d={path(actual, Math.max(0, split), n)} fill="none" stroke="var(--muted)" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
        <line x1={curH + 0.5} x2={curH + 0.5} y1={0} y2={62} stroke="var(--text)" strokeWidth={1} opacity={0.6} vectorEffect="non-scaling-stroke" />
      </svg>
      <span className="tnum absolute left-1.5 top-1 text-[9.5px] faint">{fmtKw(max / 1.08)}</span>
    </div>
  );
}

function Spark({ values, labels }: { values: number[]; labels: string[] }) {
  const max = Math.max(...values) || 1;
  const pts = values.map((v, i) => `${i + 0.5},${(38 - (v / max) * 34).toFixed(2)}`).join(' L');
  return (
    <div>
      <svg className="h-[46px] w-full rounded-md bg-[var(--surface-2)]" viewBox="0 0 24 40" preserveAspectRatio="none" aria-hidden>
        <path d={`M0.5,40 L${pts} L23.5,40 Z`} fill="var(--accent)" opacity={0.14} />
        <path d={`M${pts}`} fill="none" stroke="var(--accent)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="tnum mt-0.5 flex justify-between text-[9.5px] faint">
        {labels.map((l) => (
          <span key={l}>{l}</span>
        ))}
      </div>
    </div>
  );
}
