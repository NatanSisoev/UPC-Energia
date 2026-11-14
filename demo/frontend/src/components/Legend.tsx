import { useState } from 'react';
import { ROOF } from '../scene/world';

const CATS: Array<[string, string]> = [
  ['teaching', 'Teaching'],
  ['lab', 'Labs'],
  ['research', 'Research'],
  ['data_center', 'Data center'],
  ['mixed', 'Innovation'],
  ['library', 'Library'],
  ['sports', 'Sports'],
  ['residence', 'Residence'],
  ['aux', 'Facilities'],
];

const FLOWS: Array<[string, string]> = [
  ['Grid → campus', '#ff8450'],
  ['Solar back-feed', '#a4e85c'],
  ['Battery', '#b08cff'],
];

/** Map key: roof colour = building usage, cable colour = direction of the power. */
export default function Legend() {
  const [open, setOpen] = useState(() => window.innerWidth >= 1360);
  return (
    <div className={`panel pointer-events-auto shrink-0 !rounded-[18px] px-3 py-2 ${open ? 'w-[196px]' : 'w-[100px]'}`}>
      <button type="button" className="flex w-full items-center justify-between text-left" onClick={() => setOpen(!open)}>
        <span className="label-caps">Map key</span>
        <span className="text-[11px] text-slate-400">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <>
          <div className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1">
            {CATS.map(([k, label]) => (
              <div key={k} className="flex items-center gap-1.5 text-[10.5px] font-bold text-slate-200">
                <span className="h-3 w-3 shrink-0 rounded-[4px] border border-black/30" style={{ background: `rgb(${ROOF[k].join(',')})` }} />
                {label}
              </div>
            ))}
          </div>
          <div className="mt-2 border-t-2 border-white/5 pt-2">
            {FLOWS.map(([label, color]) => (
              <div key={label} className="flex items-center gap-2 py-0.5 text-[10.5px] font-bold text-slate-200">
                <span className="h-[5px] w-6 rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
                {label}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
