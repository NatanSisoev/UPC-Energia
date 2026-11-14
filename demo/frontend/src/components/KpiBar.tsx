import { useNavigate } from 'react-router';
import { Activity, Leaf, Plug, Sun, Tag } from 'lucide-react';
import { derived, useSim } from '../store/useSim';
import { fmtEur, fmtMw, weekLabel } from '../lib/format';
import { Resource, Stars } from './ui';

/** Top HUD: brand + week picker, live resources, and the challenge score coin. */
export default function KpiBar() {
  const snap = useSim((s) => s.snap);
  const replay = useSim((s) => s.replay);
  const weekIdx = useSim((s) => s.weekIdx);
  const version = useSim((s) => s.version);
  const agent = useSim((s) => s.agent);
  const navigate = useNavigate();
  void version;
  if (!snap || !replay) return <div className="h-16" />;

  const d = derived.current!;
  const sum = d.summary[agent === 'mpc' ? 'mpc' : agent === 'template' ? 'template' : 'none'];
  const stars = sum.score >= 6 ? 3 : sum.score >= 3 ? 2 : sum.score > 0.4 ? 1 : 0;
  const importing = snap.gridKw >= 0;
  const savedEur = snap.baseCostEur - snap.costEur;
  const savedCo2 = snap.baseCo2Kg - snap.co2Kg;

  return (
    <div className="pointer-events-auto flex flex-wrap items-start gap-3">
      {/* brand */}
      <div className="panel flex items-center gap-3 !rounded-[22px] py-2 pl-2 pr-4">
        <div className="floaty flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-b from-cyan-300 to-sky-500 text-2xl shadow-[inset_0_-4px_0_rgba(0,0,0,.2),0_0_20px_#3ee6ff77]">⚡</div>
        <div className="leading-tight">
          <div className="font-display text-[15px] text-white">Campus Nord</div>
          <div className="flex items-center gap-1.5">
            <select className="sel !py-0.5 !text-[11px]" value={weekIdx} onChange={(e) => useSim.getState().setWeek(Number(e.target.value))} aria-label="Week">
              {replay.map((w, i) => (
                <option key={w.start} value={i}>
                  Week of {weekLabel(w.start)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* resources */}
      <div className="hidden flex-wrap gap-2.5 lg:flex">
        <Resource icon={<Activity size={16} strokeWidth={3} />} color="#ff6b8a" label="Campus load" value={fmtMw(snap.loadKw)} unit="MW" />
        <Resource icon={<Sun size={16} strokeWidth={3} />} color="#ffc83d" label="Solar" value={fmtMw(snap.solarKw)} unit="MW" />
        <Resource
          icon={<Plug size={16} strokeWidth={3} />}
          color={importing ? '#ff8a50' : '#a6ff5c'}
          label={importing ? 'Grid import' : 'Exporting'}
          value={fmtMw(Math.abs(snap.gridKw))}
          unit="MW"
          sub={`no battery ${fmtMw(Math.max(0, snap.baseGridKw))} MW`}
        />
        <Resource icon={<Tag size={16} strokeWidth={3} />} color="#6fd3ff" label="Price" value={snap.price.toFixed(3)} unit="€/kWh" />
        <div className="hidden 2xl:block"><Resource icon={<Leaf size={16} strokeWidth={3} />} color="#7dffb0" label="Grid CO₂" value={snap.co2.toFixed(3)} unit="kg/kWh" /></div>
        <Resource icon={<span>{snap.cloud > 0.6 ? '☁️' : snap.cloud > 0.25 ? '⛅' : snap.sunElev < 0 ? '🌙' : '☀️'}</span>} color="#9bd0ff" label="Weather" value={snap.tempC.toFixed(0)} unit="°C" sub={`${Math.round(snap.cloud * 100)}% cloud · ${Math.round(snap.irr)} W/m²`} />
      </div>

      {/* score coin */}
      <button type="button" onClick={() => navigate('/impact')} className="panel ml-auto flex items-center gap-3 !rounded-[22px] py-2 pl-2 pr-4 text-left transition hover:brightness-110" title="Open the impact report">
        <div
          className="relative flex h-14 w-14 items-center justify-center rounded-full"
          style={{ background: `conic-gradient(#ffc83d ${Math.min(1, sum.score / 10) * 360}deg, #131b3a 0)`, boxShadow: '0 0 20px -2px #ffc83daa' }}
        >
          <div className="absolute inset-[5px] rounded-full bg-[#141d40]" />
          <span className="tnum font-display relative text-[16px] text-amber-300">{sum.score.toFixed(2)}</span>
        </div>
        <div className="leading-tight">
          <div className="label-caps !text-amber-200/80">Week score</div>
          <Stars n={stars} size={16} />
          <div className="tnum mt-0.5 text-[10px] font-bold text-slate-300">
            <span className="text-lime-300">+{fmtEur(Math.max(0, savedEur))}</span> · <span className="text-emerald-300">{Math.max(0, savedCo2).toFixed(0)} kg CO₂</span>
          </div>
        </div>
      </button>
    </div>
  );
}
