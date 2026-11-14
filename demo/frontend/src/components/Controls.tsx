import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router';
import { BarChart3, Layers, Sun, X, Eye } from 'lucide-react';
import { useSim } from '../store/useSim';
import { camera } from './MapView';
import { Slider, Toggle } from './ui';
import type { LayerId } from '../types';

const LAYERS: Array<[LayerId, string, string, string]> = [
  ['heat', '🔥', 'Power-usage heatmap', 'Buildings glow green → red by how hard they draw right now'],
  ['people', '🧑‍🎓', 'People concentration', 'Estimated occupants (students, staff, residents) from the usage profile'],
  ['weather', '⛅', 'Weather', 'Clouds from the campus station irradiance, plus temperature'],
  ['solar', '☀️', 'Solar roofs', 'PV arrays on the roofs, glowing with real output'],
  ['cables', '🔌', 'Cable network', 'Underground ducts with live power pulses'],
  ['shadows', '🌓', 'Shadows', 'Cast by the real sun position'],
  ['trees', '🌳', 'Trees', 'Parks and gardens from OpenStreetMap'],
  ['labels', '🏷️', 'Labels', 'Building and facility names'],
];

/** Bottom-right command cluster: camera presets, X-ray, layers, sun, dashboard. */
export default function Controls() {
  const [menu, setMenu] = useState<'layers' | 'sun' | null>(null);
  const layers = useSim((s) => s.layers);
  const underground = useSim((s) => s.underground);
  const sunLock = useSim((s) => s.sunLock);
  const snap = useSim((s) => s.snap);
  const navigate = useNavigate();
  const loc = useLocation();
  const dash = loc.pathname === '/dashboard';
  const st = useSim.getState();

  const hourNow = snap ? new Date((snap.tMin % 1440) * 60_000).getUTCHours() + new Date((snap.tMin % 1440) * 60_000).getUTCMinutes() / 60 : 12;

  return (
    <div className="pointer-events-auto relative flex flex-col items-end gap-2.5">
      {menu === 'layers' && (
        <div className="panel pop-in absolute bottom-full right-0 mb-3 w-[300px] !rounded-[20px] p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="panel-title text-white">🗺️ Map layers</span>
            <button type="button" onClick={() => setMenu(null)} className="text-slate-400 hover:text-white"><X size={16} /></button>
          </div>
          <div className="flex flex-col gap-1.5">
            {LAYERS.map(([id, ico, label, hint]) => (
              <div key={id} className="panel-flat flex items-center gap-2.5 px-2.5 py-2">
                <span className="text-xl">{ico}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] font-extrabold text-white">{label}</div>
                  <div className="text-[10px] font-semibold leading-tight text-slate-400">{hint}</div>
                </div>
                <Toggle checked={layers[id]} onChange={() => st.toggleLayer(id)} accent="#a6e05a" label={label} />
              </div>
            ))}
          </div>
        </div>
      )}
      {menu === 'sun' && (
        <div className="panel pop-in absolute bottom-full right-0 mb-3 w-[280px] !rounded-[20px] p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="panel-title text-white">☀️ Sun control</span>
            <button type="button" onClick={() => setMenu(null)} className="text-slate-400 hover:text-white"><X size={16} /></button>
          </div>
          <div className="panel-flat flex items-center gap-3 px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="text-[12px] font-extrabold text-white">Freeze the sun</div>
              <div className="text-[10px] font-semibold text-slate-400">The simulation keeps running; only the light stays put.</div>
            </div>
            <Toggle checked={sunLock != null} accent="#ffb627" label="Freeze sun" onChange={(v) => st.setSunLock(v ? Math.round(hourNow * 2) / 2 : null)} />
          </div>
          <div className={`mt-3 transition ${sunLock == null ? 'opacity-40' : ''}`}>
            <div className="mb-1 flex justify-between text-[11px] font-extrabold text-slate-300">
              <span>Time of day</span>
              <span className="tnum text-amber-300">{`${String(Math.floor(sunLock ?? hourNow)).padStart(2, '0')}:${String(Math.round(((sunLock ?? hourNow) % 1) * 60)).padStart(2, '0')}`}</span>
            </div>
            <Slider min={0} max={24} step={0.25} value={sunLock ?? hourNow} accent="#ffb627" onChange={(v) => st.setSunLock(v)} />
            <div className="mt-2 flex gap-1.5">
              {(
                [
                  ['🌅', 7],
                  ['☀️', 13],
                  ['🌆', 19.5],
                  ['🌙', 1],
                ] as Array<[string, number]>
              ).map(([e, h]) => (
                <button key={h} type="button" className="btn flex-1 !py-1" onClick={() => st.setSunLock(h)}>{e}</button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2.5">
        <div className="panel flex gap-1.5 !rounded-[18px] p-1.5">
          {(
            [
              ['home', '🏙️', 'Campus'],
              ['battery', '🔋', 'Battery yard'],
              ['substation', '🏭', 'Substation'],
              ['top', '🗺️', 'Top view'],
            ] as Array<[string, string, string]>
          ).map(([k, e, t]) => (
            <button key={k} type="button" className="btn !px-2.5 !py-1.5 !text-[15px]" title={t} onClick={() => camera.fly(k)}>{e}</button>
          ))}
        </div>
        <div className="panel flex gap-1.5 !rounded-[18px] p-1.5">
          <button type="button" className="btn !px-2.5 !py-1.5 !text-[15px]" title="Rotate left (Q) · or right-drag the map" onClick={() => camera.rotate(-30)}>⟲</button>
          <button type="button" className="btn !px-2.5 !py-1.5 !text-[15px]" title="Rotate right (E) · or right-drag the map" onClick={() => camera.rotate(30)}>⟳</button>
          <button type="button" className="btn !px-2.5 !py-1.5 !text-[13px]" title="Tilt down" onClick={() => camera.tilt(-10)}>⤓</button>
          <button type="button" className="btn !px-2.5 !py-1.5 !text-[13px]" title="Tilt up" onClick={() => camera.tilt(10)}>⤒</button>
        </div>
        <button type="button" className={`btn !rounded-[16px] !py-2.5 ${underground ? 'btn-on' : ''}`} style={{ '--accent': '#5cc8ff' } as React.CSSProperties} onClick={() => st.setUnderground(!underground)} title="Show the buried cable network">
          <Eye size={16} /> X-ray
        </button>
      </div>
      <div className="flex items-center gap-2.5">
        <button type="button" className={`btn !rounded-[16px] !py-2.5 ${sunLock != null || menu === 'sun' ? 'btn-on' : ''}`} style={{ '--accent': '#ffb627' } as React.CSSProperties} onClick={() => setMenu(menu === 'sun' ? null : 'sun')}>
          <Sun size={16} /> {sunLock != null ? 'Sun frozen' : 'Sun'}
        </button>
        <button type="button" className={`btn !rounded-[16px] !py-2.5 ${menu === 'layers' ? 'btn-on' : ''}`} style={{ '--accent': '#a6e05a' } as React.CSSProperties} onClick={() => setMenu(menu === 'layers' ? null : 'layers')}>
          <Layers size={16} /> Layers
        </button>
        <button type="button" className={`btn !rounded-[16px] !py-2.5 ${dash ? 'btn-on' : ''}`} style={{ '--accent': '#ff9f5c' } as React.CSSProperties} onClick={() => navigate(dash ? '/' : '/dashboard')}>
          {dash ? <X size={16} /> : <BarChart3 size={16} />} {dash ? 'Close charts' : 'Charts'}
        </button>
      </div>
    </div>
  );
}
