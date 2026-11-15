import { useState } from 'react';
import { AlertOctagon, AlertTriangle, Info, X } from 'lucide-react';
import { useSim } from '../store/useSim';
import { KIND_LABEL, useAlarms, type Alarm } from '../lib/alarms';
import { hourLabel } from '../lib/assistant';
import { Seg } from './kit';

const ICON = { critical: AlertOctagon, warning: AlertTriangle, info: Info } as const;
const COLOR = { critical: 'var(--danger)', warning: 'var(--warn)', info: 'var(--info)' } as const;

/** Alarm list relative to the timeline position: active now, upcoming (incl. predicted), past. */
export default function AlarmPanel({ onClose, onConfigure }: { onClose: () => void; onConfigure: () => void }) {
  const h = useSim((s) => s.snap?.hour ?? 0);
  const alarms = useAlarms();
  const [tab, setTab] = useState<'active' | 'upcoming' | 'past'>('active');
  const groups = {
    active: alarms.filter((a) => a.startH <= h && h < a.endH),
    upcoming: alarms.filter((a) => a.startH > h),
    past: alarms.filter((a) => a.endH <= h).reverse(),
  };
  const list = groups[tab];

  return (
    <aside className="flex h-full w-full flex-col border-l border-[var(--border)] bg-[var(--surface)]">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3.5">
        <div>
          <div className="eyebrow">Alarms</div>
          <div className="mt-0.5 text-[12px] muted">At {hourLabel(h)}</div>
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close alarms">
          <X size={15} />
        </button>
      </div>
      <div className="px-5 pt-3">
        <Seg
          label="Alarm filter"
          value={tab}
          onChange={setTab}
          options={[
            ['active', `Active · ${groups.active.length}`],
            ['upcoming', `Upcoming · ${groups.upcoming.length}`],
            ['past', `Past · ${groups.past.length}`],
          ]}
        />
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-5 py-3">
        {list.length === 0 && <div className="rounded-lg border border-dashed border-[var(--border-strong)] p-4 text-center text-[12.5px] muted">No {tab} alarms.</div>}
        {list.map((a) => (
          <AlarmRow key={a.id} a={a} />
        ))}
      </div>
      <div className="border-t border-[var(--border)] px-5 py-3 text-[12px] muted">
        Thresholds and fault simulation live in{' '}
        <button type="button" className="font-medium text-[var(--accent)] hover:underline" onClick={onConfigure}>
          Settings → Faults &amp; alarms
        </button>
        .
      </div>
    </aside>
  );
}

function AlarmRow({ a }: { a: Alarm }) {
  const Icon = ICON[a.severity];
  const whole = a.startH === 0 && a.endH >= 168;
  return (
    <button
      type="button"
      className="flex w-full gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-left hover:border-[var(--border-strong)]"
      style={{ borderLeft: `3px solid ${COLOR[a.severity]}` }}
      onClick={() => {
        if (!whole) useSim.getState().setTMin(a.startH * 60 + 30);
        if (a.target && a.target !== 'battery' && a.target !== 'substation') useSim.getState().select(a.target);
      }}
      title={whole ? undefined : 'Jump to this moment'}
    >
      <Icon size={16} style={{ color: COLOR[a.severity] }} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[13px] font-medium">{a.title}</span>
          {a.predicted && <span className="badge badge-fc">predicted</span>}
        </div>
        <div className="mt-0.5 text-[12px] leading-snug muted">{a.detail}</div>
        <div className="tnum mt-1.5 flex items-center gap-2 text-[11px] faint">
          <span>{KIND_LABEL[a.kind]}</span>
          <span>·</span>
          <span>{whole ? 'ongoing' : `${hourLabel(a.startH)} → ${hourLabel(Math.min(167, a.endH - 1)).slice(-5).replace(/:00$/, ':59')}`}</span>
        </div>
      </div>
    </button>
  );
}
