import { useEffect, useRef, useState } from 'react';
import { ChevronDown, FlaskConical, LocateFixed, RotateCcw } from 'lucide-react';
import { useSim } from '../store/useSim';
import { TIME_LABEL, useViewMode, type Change } from '../lib/mode';

const KIND: Record<Change['kind'], { label: string; cls: string }> = {
  added: { label: 'new', cls: 'badge-fc' },
  changed: { label: 'changed', cls: 'badge-warn' },
  fault: { label: 'fault', cls: 'badge-crit' },
  setting: { label: 'setting', cls: 'badge-hist' },
};

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
  const t = TIME_LABEL[time];
  const delta = hour - nowH;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => !boxRef.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const counts = scenario.reduce<Record<string, number>>((a, c) => ({ ...a, [c.kind]: (a[c.kind] ?? 0) + 1 }), {});

  return (
    <div className="flex items-center gap-2">
      <div
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
        <div className="relative" ref={boxRef}>
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
            <ChevronDown size={13} className="muted" />
          </button>
          {open && (
            <div className="card fade-in absolute left-0 top-[calc(100%+6px)] z-40 w-[360px] p-2" style={{ boxShadow: 'var(--shadow-lg)' }}>
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
