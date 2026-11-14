import { useSim } from '../store/useSim';
import { fmtKw, weekLabel } from '../lib/format';

/** Top bar: identity, week picker, a few live figures and the catalog entry point. */
export default function Header({ onCatalog }: { onCatalog: () => void }) {
  const snap = useSim((s) => s.snap);
  const replay = useSim((s) => s.replay);
  const weekIdx = useSim((s) => s.weekIdx);

  return (
    <header className="flex h-[60px] shrink-0 items-center gap-6 border-b border-[#e3e6ea] bg-white px-5">
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-sm bg-[#007bc0] text-[13px] font-bold tracking-tight text-white">UPC</div>
        <div className="leading-tight">
          <div className="text-[15px] font-semibold text-[#1d1d1b]">Campus Nord · Energy</div>
          <div className="text-[11px] text-[#5f6368]">Universitat Politècnica de Catalunya</div>
        </div>
      </div>

      {replay && (
        <label className="flex items-center gap-2 text-[12px] text-[#5f6368]">
          Week of
          <select className="select" value={weekIdx} onChange={(e) => useSim.getState().setWeek(Number(e.target.value))} aria-label="Week">
            {replay.map((w, i) => (
              <option key={w.start} value={i}>
                {weekLabel(w.start)} {w.start.slice(0, 4)}
              </option>
            ))}
          </select>
        </label>
      )}

      {snap && (
        <div className="ml-auto hidden items-center gap-6 lg:flex">
          <Stat k="Campus demand" v={fmtKw(snap.loadKw)} />
          <Stat k="Solar" v={fmtKw(snap.solarKw)} />
          <Stat k="Grid price" v={`${snap.price.toFixed(3)} €/kWh`} />
          <Stat k="Grid CO₂" v={`${snap.co2.toFixed(3)} kg/kWh`} />
        </div>
      )}

      <button type="button" className={`btn-outline ${snap ? '' : 'ml-auto'}`} onClick={onCatalog}>
        Solar &amp; storage
      </button>
    </header>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="leading-tight">
      <div className="text-[11px] text-[#5f6368]">{k}</div>
      <div className="tnum text-[14px] font-semibold text-[#1d1d1b]">{v}</div>
    </div>
  );
}
