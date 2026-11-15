import { useEffect, useRef, useState } from 'react';
import { ChevronDown, FlaskConical, LocateFixed, RotateCcw } from 'lucide-react';
import { useSim, derived } from '../store/useSim';
import { modelOf, installedKwp, asBuiltCoverage, DEFAULT_TILT } from '../sim/engine';
import { PANEL_MODELS } from '../data/catalogue';
import { fmtEur } from '../lib/format';
import { paybackYearsOf, WEEKS_PER_YEAR, LIFETIME_YEARS } from '../lib/payback';
import { usePopupReq } from '../store/useUi';
import { TIME_LABEL, useViewMode, type Change } from '../lib/mode';

const KIND: Record<Change['kind'], { label: string; cls: string }> = {
  added: { label: 'new', cls: 'badge-fc' },
  changed: { label: 'changed', cls: 'badge-warn' },
  fault: { label: 'fault', cls: 'badge-crit' },
  setting: { label: 'setting', cls: 'badge-hist' },
};

const GOOD = 'var(--ok)';
const BAD = 'var(--crit, #ef4444)';

/** Consequences of the simulated changes vs the real campus over the selected week (reuses the app's own simulation). */
function useConsequences() {
  useSim((s) => s.version);
  const batteries = useSim((s) => s.batteries);
  const solar = useSim((s) => s.solar);
  const panelModel = useSim((s) => s.panelModel);
  const campus = useSim((s) => s.campus);
  const t = derived.current?.totals;
  if (!t) return null;
  // investment: catalogue prices of added batteries + extra solar kWp (indicative, from data/catalogue.ts)
  let invest = 0;
  let investBat = 0;
  for (const b of batteries.filter((x) => !x.asBuilt)) investBat += modelOf(b).priceEur;
  invest = investBat;
  if (campus) {
    const cov = asBuiltCoverage(campus.features.map((f) => f.properties));
    const eurKw = PANEL_MODELS.find((m) => m.id === panelModel)?.eurPerKw ?? 0;
    for (const f of campus.features) {
      const p = f.properties;
      const c = solar[p.osmId];
      if (!c) continue;
      const real = installedKwp(p, { on: p.pv_fraction > 0, fraction: p.pv_fraction > 0 ? cov : 0, tilt: DEFAULT_TILT }, 'mono');
      const extra = installedKwp(p, c, panelModel) - real;
      if (extra > 0) invest += extra * eurKw;
    }
  }
  const dCo2 = t.chosen.co2Kg - t.real.co2Kg;
  const dCost = t.chosen.costEur - t.real.costEur;
  return {
    dCo2,
    dCost,
    pCo2: t.real.co2Kg > 0 ? (dCo2 / t.real.co2Kg) * 100 : 0,
    pCost: t.real.costEur > 0 ? (dCost / t.real.costEur) * 100 : 0,
    invest,
    // cost-weighted service life of what was added (batteries vs panels, lifetimes from lib/payback)
    life: invest > 0 ? (investBat * LIFETIME_YEARS.battery + (invest - investBat) * LIFETIME_YEARS.solar) / invest : 0,
    payback: paybackYearsOf(invest, -dCost * WEEKS_PER_YEAR),
  };
}

const sgn = (v: number) => (Math.abs(v) < 0.05 ? '' : v < 0 ? '−' : '+');
const tone = (v: number) => (Math.abs(v) < 0.05 ? 'var(--muted)' : v < 0 ? GOOD : BAD);

/** The two headline numbers of a simulation: big, signed, coloured. */
function Hero({ c }: { c: NonNullable<ReturnType<typeof useConsequences>> }) {
  const cards = [
    { k: 'CO₂ · grid', v: c.dCo2, p: c.pCo2, text: `${Math.abs(c.dCo2) >= 1000 ? (Math.abs(c.dCo2) / 1000).toFixed(2) + ' t' : Math.abs(Math.round(c.dCo2)).toLocaleString('en') + ' kg'}` },
    { k: 'Budget · energy cost', v: c.dCost, p: c.pCost, text: fmtEur(Math.abs(c.dCost)) },
  ];
  return (
    <div className="px-1 pb-2 pt-1">
      <div className="eyebrow px-1 pb-1.5">Consequences vs the real campus · selected week</div>
      <div className="grid grid-cols-2 gap-2">
        {cards.map((x) => (
          <div key={x.k} className="rounded-lg border p-2.5" style={{ borderColor: tone(x.v), background: `color-mix(in srgb, ${tone(x.v)} 10%, transparent)` }}>
            <div className="eyebrow !text-[10px]">{x.k}</div>
            <div className="tnum mt-0.5 text-[22px] font-bold leading-tight" style={{ color: tone(x.v) }}>
              {sgn(x.v)}
              {x.text}
            </div>
            <div className="tnum text-[13px] font-semibold" style={{ color: tone(x.v) }}>
              {sgn(x.v)}
              {Math.abs(x.p).toFixed(1)}%
            </div>
          </div>
        ))}
      </div>
      {c.invest > 0 && (
        <div className="mt-1.5 px-1 text-[12.5px]">
          <div className="flex items-baseline justify-between">
            <span className="muted">Investment (catalogue prices)</span>
            <span className="tnum font-semibold">{fmtEur(c.invest)}</span>
          </div>
          <div className="flex items-baseline justify-between" title={`Typical life ~${c.life.toFixed(0)} yr (cost-weighted)`}>
            <span className="muted">Payback</span>
            <span className="tnum font-semibold" style={{ color: Number.isFinite(c.payback) && c.payback <= c.life ? GOOD : BAD }}>
              {Number.isFinite(c.payback) ? `~ ${c.payback.toFixed(1)} yr` : 'does not pay back'}
            </span>
          </div>
          <div className="text-[10.5px] faint">from the selected week's saving × 52 · typical life ~{c.life.toFixed(0)} yr</div>
        </div>
      )}
    </div>
  );
}

/**
 * Always-visible status: is the screen showing LIVE / HISTORY / FORECAST data, and is it the real campus or a
 * SIMULATED one? The simulated pill lists every change (click it); each row flies the map to that equipment.
 */
export default function ModeIndicator() {
  const { time, scenario } = useViewMode();
  const nowH = useSim((s) => s.nowH);
  const hour = useSim((s) => s.snap?.hour ?? 0);
  const forecastOn = useSim((s) => s.forecastOn);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  usePopupReq('scenario', setOpen);
  const t = TIME_LABEL[time];
  const delta = hour - nowH;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => !boxRef.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const cons = useConsequences();
  const counts = scenario.reduce<Record<string, number>>((a, c) => ({ ...a, [c.kind]: (a[c.kind] ?? 0) + 1 }), {});

  return (
    <div className="flex items-center gap-2">
      <div
        data-tour="time-pill"
        className="flex items-center gap-2 rounded-md border px-2.5 py-1"
        style={{ borderColor: t.color, background: time === 'forecast' ? 'var(--accent-soft)' : time === 'live' ? 'var(--ok-soft)' : 'var(--surface-2)' }}
        title={t.hint}
      >
        <span className={`h-2 w-2 rounded-full ${time === 'live' ? 'blink' : ''}`} style={time === 'forecast' ? { border: `1.5px dashed ${t.color}` } : { background: t.color }} />
        <span className="eyebrow !text-[10.5px] !font-semibold" style={{ color: t.color }}>
          {t.label}
        </span>
        {forecastOn && time !== 'live' && (
          <>
            <span className="tnum text-[11px] muted">
              {delta > 0 ? '+' : '−'}
              {Math.abs(delta) >= 24 ? `${Math.floor(Math.abs(delta) / 24)}d ${Math.abs(delta) % 24}h` : `${Math.abs(delta)}h`}
            </span>
            <button type="button" className="text-[11px] font-medium text-[var(--accent)] hover:underline" onClick={() => useSim.getState().goLive()}>
              go live
            </button>
          </>
        )}
      </div>

      {scenario.length > 0 ? (
        <div className="relative" ref={boxRef} data-tour="sim-pill">
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            className="flex items-center gap-2 rounded-md border px-2.5 py-1"
            style={{ borderColor: 'var(--violet)', background: 'color-mix(in srgb, var(--violet) 12%, transparent)' }}
          >
            <FlaskConical size={13} style={{ color: 'var(--violet)' }} />
            <span className="eyebrow !text-[10.5px] !font-semibold" style={{ color: 'var(--violet)' }}>
              Simulated
            </span>
            <span className="tnum text-[11px] muted">
              {[counts.added && `${counts.added} new`, counts.changed && `${counts.changed} changed`, counts.fault && `${counts.fault} fault${counts.fault > 1 ? 's' : ''}`, counts.setting && `${counts.setting} setting${counts.setting > 1 ? 's' : ''}`]
                .filter(Boolean)
                .join(' · ')}
            </span>
            {cons && (
              <>
                <span className="tnum text-[12px] font-bold" style={{ color: tone(cons.dCo2) }} title="CO₂ vs the real campus, selected week">
                  CO₂ {sgn(cons.dCo2)}{Math.abs(cons.pCo2).toFixed(1)}%
                </span>
                <span className="tnum text-[12px] font-bold" style={{ color: tone(cons.dCost) }} title="Energy cost vs the real campus, selected week">
                  € {sgn(cons.dCost)}{Math.abs(cons.pCost).toFixed(1)}%
                </span>
              </>
            )}
            <ChevronDown size={13} className="muted" />
          </button>
          {open && (
            <div className="card fade-in absolute left-0 top-[calc(100%+6px)] z-40 w-[380px] p-2" style={{ boxShadow: 'var(--shadow-lg)' }}>
              {cons && <Hero c={cons} />}
              <div className="eyebrow px-2 pb-1.5 pt-1">Differences from the real campus · {scenario.length}</div>
              <div className="max-h-[320px] overflow-y-auto">
                {scenario.map((c, i) => (
                  <button
                    key={`${c.label}${i}`}
                    type="button"
                    disabled={!c.target}
                    onClick={() => c.target && useSim.getState().select(c.target)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] enabled:hover:bg-[var(--surface-2)]"
                    title={c.target ? 'Show on the map' : undefined}
                  >
                    <span className={`badge ${KIND[c.kind].cls} w-[58px] justify-center`}>{KIND[c.kind].label}</span>
                    <span className="min-w-0 flex-1 truncate">{c.label}</span>
                    {c.target && <LocateFixed size={13} className="shrink-0 muted" />}
                  </button>
                ))}
              </div>
              <button type="button" className="btn mt-2 w-full justify-center !py-1 !text-[12px]" onClick={() => useSim.getState().resetScenario()}>
                <RotateCcw size={13} /> Reset to the real campus
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-md border border-[var(--border)] px-2.5 py-1" title="Equipment and agent as installed on Campus Nord">
          <span className="eyebrow !text-[10.5px]">Real campus</span>
        </div>
      )}
    </div>
  );
}
