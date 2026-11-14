import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { panelFromPath, PANEL_PATHS, type PanelId } from './routes';
import MapView from './components/MapView';
import KpiBar from './components/KpiBar';
import TimeBar from './components/TimeBar';
import RightPanel from './components/RightPanel';
import Legend from './components/Legend';
import Advisor from './components/Advisor';
import Controls from './components/Controls';
import Dashboard from './components/Dashboard';
import { useSim } from './store/useSim';

const TABS: Array<{ id: Exclude<PanelId, 'dashboard'>; label: string; icon: string }> = [
  { id: 'overview', label: 'Campus', icon: '🏫' },
  { id: 'solar', label: 'Solar', icon: '☀️' },
  { id: 'batteries', label: 'Battery', icon: '🔋' },
  { id: 'impact', label: 'Impact', icon: '🏆' },
];

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const tab = panelFromPath(location.pathname);
  const ready = useSim((s) => s.snap !== null);

  /* data + heartbeat (10 Hz clock; the scene has its own 30 fps render loop) */
  useEffect(() => {
    useSim.getState().load();
    let last = performance.now();
    const id = window.setInterval(() => {
      const n = performance.now();
      useSim.getState().tick(Math.min(0.5, (n - last) / 1000));
      last = n;
    }, 100);
    return () => window.clearInterval(id);
  }, []);

  const go = (id: PanelId) => navigate(id === 'overview' ? '/' : PANEL_PATHS[id as Exclude<PanelId, 'overview'>]);
  const dash = tab === 'dashboard';

  return (
    <div className="relative h-full w-full overflow-hidden">
      <MapView />

      {ready && (
        <>
          <div className="pointer-events-none absolute inset-x-3 top-3 z-10">
            <KpiBar />
          </div>

          {/* left: the agent's voice */}
          {!dash && (
            <div className="pointer-events-none absolute left-3 top-[96px] z-10 max-h-[calc(100%-290px)] overflow-y-auto xl:top-[88px]">
              <Advisor />
            </div>
          )}

          {/* right: build menu */}
          {!dash && (
            <aside className="pointer-events-auto absolute bottom-[150px] right-3 top-[96px] z-10 flex w-[340px] xl:top-[88px] xl:w-[360px] flex-col gap-2.5">
              <nav className="panel flex gap-1 !rounded-[18px] p-1.5">
                {TABS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => go(t.id)}
                    className={`btn flex-1 !rounded-xl !px-1 !py-1.5 !text-[12px] ${tab === t.id ? 'btn-on' : ''}`}
                    style={{ '--accent': '#5cc8ff' } as React.CSSProperties}
                  >
                    <span className="text-[14px]">{t.icon}</span> {t.label}
                  </button>
                ))}
              </nav>
              <div className="pop-in min-h-0 flex-1" key={tab}>
                <RightPanel tab={tab} />
              </div>
            </aside>
          )}

          {/* bottom row: map key · time machine · command cluster */}
          <div className="pointer-events-none absolute inset-x-3 bottom-3 z-10 flex items-end gap-3">
            <Legend />
            <div className="flex min-w-0 flex-1 justify-center">
              <TimeBar />
            </div>
            <Controls />
          </div>

          {dash && (
            <div className="panel pop-in pointer-events-auto absolute bottom-[150px] left-3 right-3 z-10 h-[34vh] !rounded-[22px] p-3">
              <Dashboard />
            </div>
          )}
        </>
      )}

      <div className="pointer-events-none absolute bottom-0 left-1/2 z-0 -translate-x-1/2 text-[9px] font-bold text-white/60">
        Map data © OpenStreetMap contributors · real UPC Campus Nord telemetry
      </div>
    </div>
  );
}
