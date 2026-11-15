import { useEffect, useRef } from 'react';
import { ArrowLeft, Minus, Plus } from 'lucide-react';
import { derived, useSim } from '../store/useSim';
import { panelsOf, panelId, worldRef } from '../scene/minimal';
import { gradeColor, panelSheet } from '../data/assets';
import { PV_ASBUILT_KWP, tiltFactor } from '../sim/engine';
import { fmtKw } from '../lib/format';

/**
 * "Solar panels" tab of the building sidebar: every installed panel row on the roof with its live output and
 * condition. Hovering a row highlights that panel on the map (with a leader line from the row); clicking opens
 * its sheet and centres the map on it. Clicking a panel on the map opens the same view.
 */
export default function SolarTab({ id }: { id: string }) {
  const campus = useSim((s) => s.campus)!;
  const solar = useSim((s) => s.solar);
  const panelModel = useSim((s) => s.panelModel);
  const faults = useSim((s) => s.faults);
  const focus = useSim((s) => s.panelFocus);
  const hover = useSim((s) => s.panelHover);
  const tMin = useSim((s) => s.tMin);
  useSim((s) => s.version);
  const listRef = useRef<HTMLDivElement>(null);
  const d = derived.current!;
  const p = campus.features.find((f) => f.properties.osmId === id)!.properties;
  const cfg = solar[id] ?? { on: false, fraction: 0, tilt: 18 };
  const broken = faults.roofs.includes(id);
  const h = Math.min(d.week.load.length - 1, Math.floor(tMin / 60));
  const yieldNow = d.week.pv[h] / PV_ASBUILT_KWP;
  const tf = tiltFactor(cfg.tilt);

  const panels = panelsOf(id).map((x) => {
    const info = panelSheet(p, x.j, cfg, panelModel, broken);
    const nowKw = info.ratedKw * info.health * tf * yieldNow;
    let weekKwh = 0;
    for (let k = 0; k < d.week.pv.length; k++) weekKwh += info.ratedKw * info.health * tf * (d.week.pv[k] / PV_ASBUILT_KWP);
    return { x, info, nowKw, weekKwh, pid: panelId(id, x.j) };
  });

  // leave hover state clean when the tab goes away
  useEffect(() => () => useSim.getState().setPanelUi({ panelHover: null }), []);

  const setHover = (pid: string | null, el?: HTMLElement) => {
    if (!pid || !el) return useSim.getState().setPanelUi({ panelHover: null });
    const r = el.getBoundingClientRect();
    useSim.getState().setPanelUi({ panelHover: { id: pid, y: r.top + r.height / 2 } });
  };

  if (p.pv_fraction <= 0) return <div className="flex-1 px-5 py-6 text-[12.5px] muted">This roof is not suitable for PV in the model.</div>;

  /* add / remove one panel row: rows appear in a fixed order (rank k), a coverage share f shows rows with k < f/0.6,
     so the new coverage is set halfway between the last shown row's rank and the next one's */
  const M = worldRef.current;
  const ranks = M ? M.pv.filter((x) => M.ids[x.b] === id).map((x) => x.k).sort((a, b) => a - b) : [];
  const room = ranks.length;
  const setCount = (n: number) => {
    const st = useSim.getState();
    if (n <= 0) return st.setSolar(id, { on: false, fraction: 0, tilt: cfg.tilt });
    const lo = ranks[n - 1];
    const hi = ranks[n] ?? 1;
    st.setSolar(id, { on: true, fraction: Math.min(0.6, (0.6 * (lo + hi)) / 2), tilt: cfg.tilt });
  };
  const addRemove = (
    <div className="flex items-center gap-1.5">
      <button type="button" className="btn !py-1 !text-[12px]" disabled={panels.length === 0} onClick={() => setCount(panels.length - 1)} title="Remove the last panel">
        <Minus size={13} />
      </button>
      <button type="button" className="btn btn-primary !py-1 !text-[12px]" disabled={panels.length >= room} onClick={() => setCount(panels.length + 1)} title={panels.length >= room ? 'The roof is full' : 'Add one panel (simulated)'}>
        <Plus size={13} /> Add panel
      </button>
    </div>
  );

  if (!panels.length)
    return (
      <div className="flex-1 px-5 py-6 text-[12.5px] muted">
        <p className="mb-3">No panels installed on this roof (room for {room}).</p>
        {addRemove}
      </div>
    );

  const sel = focus ? panels.find((q) => q.pid === focus) : null;
  const totalKwp = panels.reduce((a, q) => a + q.info.ratedKw, 0);
  const nowTot = panels.reduce((a, q) => a + q.nowKw, 0);
  const avgHealth = panels.reduce((a, q) => a + q.info.health, 0) / panels.length;
  const issues = panels.filter((q) => q.info.sheet.specs.find((r) => r.k === 'Inspection')?.v !== 'clean').length;
  const best = Math.max(...panels.map((q) => q.nowKw), 1e-6);

  /* ------------------------------------------------------- one panel ---- */
  if (sel) {
    const s = sel.info.sheet;
    const n = d.week.pv.length;
    const series = Array.from({ length: n }, (_, k) => sel.info.ratedKw * sel.info.health * tf * (d.week.pv[k] / PV_ASBUILT_KWP));
    const max = Math.max(...series, 1e-6);
    const pts = series.map((v, k) => `${k + 0.5},${(38 - (v / max) * 34).toFixed(2)}`).join(' L');
    return (
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <button type="button" className="mb-3 flex items-center gap-1.5 text-[12px] font-medium text-[var(--accent)] hover:underline" onClick={() => useSim.getState().setPanelUi({ panelFocus: null })}>
          <ArrowLeft size={13} /> All {panels.length} panels
        </button>
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="tnum text-[16px] font-semibold">{s.title}</div>
            <div className="text-[12px] muted">{s.type}</div>
          </div>
          <span className="badge" style={{ color: gradeColor(s.condition.grade), background: 'var(--surface-2)' }}>
            {s.condition.grade}
          </span>
        </div>
        <div className="my-3 grid grid-cols-3 gap-2">
          <Kpi k="Output now" v={fmtKw(sel.nowKw)} />
          <Kpi k="This week" v={`${sel.weekKwh.toFixed(1)} kWh`} />
          <Kpi k="Vs new" v={`${(sel.info.health * 100).toFixed(0)}%`} />
        </div>
        <div className="mb-1 eyebrow">Output this week</div>
        <svg className="mb-3 h-[52px] w-full rounded-md bg-[var(--surface-2)]" viewBox={`0 0 ${n} 40`} preserveAspectRatio="none" aria-hidden>
          <path d={`M0.5,40 L${pts} L${n - 0.5},40 Z`} fill="#f5a524" opacity={0.2} />
          <path d={`M${pts}`} fill="none" stroke="#f5a524" strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
          <line x1={h + 0.5} x2={h + 0.5} y1={0} y2={40} stroke="var(--text)" strokeWidth={1} opacity={0.6} vectorEffect="non-scaling-stroke" />
        </svg>
        <div className="mb-1 flex justify-between text-[11px] muted">
          <span>Condition</span>
          <span className="tnum">{(s.condition.health * 100).toFixed(0)}%</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-3)]">
          <div className="h-full rounded-full" style={{ width: `${s.condition.health * 100}%`, background: gradeColor(s.condition.grade) }} />
        </div>
        <div className="mt-1 mb-3 text-[11.5px] muted">{s.condition.note}</div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[12px]">
          {s.specs.map((r) => (
            <div key={r.k} className="contents">
              <dt className="faint">{r.k}</dt>
              <dd className="tnum">{r.v}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-2 text-[10.5px] faint">Per-panel condition is simulated (ageing + inspection findings); no panel-level telemetry in the challenge data.</div>
      </div>
    );
  }

  /* --------------------------------------------------------- the list ---- */
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid grid-cols-4 gap-2 px-5 pt-4">
        <Kpi k="Panels" v={`${panels.length}`} />
        <Kpi k="Installed" v={`${totalKwp.toFixed(1)} kWp`} />
        <Kpi k="Output now" v={fmtKw(nowTot)} />
        <Kpi k="Avg. health" v={`${(avgHealth * 100).toFixed(0)}%`} />
      </div>
      <div className="flex items-center justify-between px-5 pt-3">
        <span className="text-[11.5px] muted">
          {panels.length} of {room} places used
        </span>
        {addRemove}
      </div>
      <div className="flex items-center justify-between px-5 pb-1 pt-3 text-[11px] muted">
        <span>{issues ? `${issues} panel${issues > 1 ? 's' : ''} with findings` : 'No inspection findings'}</span>
        <span>Hover to locate · click for details</span>
      </div>
      <div className="grid grid-cols-[1fr_64px_70px_54px] gap-2 border-b border-[var(--border)] px-5 pb-1.5 eyebrow !text-[9px]">
        <span>Panel</span>
        <span className="text-right">Now</span>
        <span>Health</span>
        <span>Note</span>
      </div>
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-1" onScroll={() => hover && useSim.getState().setPanelUi({ panelHover: null })}>
        {panels.map((q) => {
          const issue = q.info.sheet.specs.find((r) => r.k === 'Inspection')?.v ?? '';
          const on = hover?.id === q.pid;
          return (
            <button
              key={q.pid}
              type="button"
              onMouseEnter={(e) => setHover(q.pid, e.currentTarget)}
              onMouseLeave={() => setHover(null)}
              onFocus={(e) => setHover(q.pid, e.currentTarget)}
              onBlur={() => setHover(null)}
              onClick={() => useSim.getState().select(q.pid)}
              className={`grid w-full grid-cols-[1fr_64px_70px_54px] items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] ${on ? 'bg-[var(--accent-soft)]' : 'hover:bg-[var(--surface-2)]'}`}
            >
              <span className="tnum truncate font-medium">{q.info.sheet.title}</span>
              <span className="tnum text-right">{(q.nowKw * 1000).toFixed(0)} W</span>
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--surface-3)]">
                  <span className="block h-full rounded-full" style={{ width: `${q.info.health * 100}%`, background: gradeColor(q.info.sheet.condition.grade) }} />
                </span>
                <span className="tnum w-7 text-right text-[10.5px] muted">{(q.info.health * 100).toFixed(0)}</span>
              </span>
              <span className={`truncate text-[10.5px] ${issue === 'clean' ? 'faint' : ''}`} style={issue !== 'clean' ? { color: gradeColor(q.info.sheet.condition.grade) } : undefined} title={issue}>
                {issue === 'clean' ? 'ok' : issue}
              </span>
              <span className="col-span-4 -mt-0.5 h-[3px] rounded-full bg-[var(--surface-2)]">
                <span className="block h-full rounded-full" style={{ width: `${(q.nowKw / best) * 100}%`, background: '#f5a524', opacity: 0.6 }} />
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Kpi({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-md bg-[var(--surface-2)] px-2.5 py-2">
      <div className="eyebrow !text-[9px]">{k}</div>
      <div className="tnum mt-0.5 text-[13px] font-medium">{v}</div>
    </div>
  );
}

