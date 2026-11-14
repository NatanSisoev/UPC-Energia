import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { panelFromPath, PANEL_PATHS } from './routes';
import MapView from './components/MapView';
import KpiBar from './components/KpiBar';
import TimeBar from './components/TimeBar';
import RightPanel from './components/RightPanel';
import Legend from './components/Legend';
import Advisor from './components/Advisor';
import Controls from './components/Controls';
import Dashboard from './components/Dashboard';
import Insights from './components/Insights';
import { PitchCaption, PitchRunner } from './pitch/PitchOverlay';
import { usePitch } from './pitch/usePitch';
import { SCENES } from './pitch/script';
import { useSim } from './store/useSim';
import { warmInsights } from './sim/insights';

type TabId = 'overview' | 'solar' | 'batteries' | 'impact';
const TABS: Array<{ id: TabId; label: string; icon: string }> = [
  { id: 'overview', label: 'Campus', icon: '🏫' },
  { id: 'solar', label: 'Solar', icon: '☀️' },
  { id: 'batteries', label: 'Battery', icon: '🔋' },
  { id: 'impact', label: 'Impact', icon: '🏆' },
];

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const panel = panelFromPath(location.pathname);
  const ready = useSim((s) => s.snap !== null);
  const pitching = usePitch((s) => s.active);
  const scene = usePitch((s) => SCENES[s.idx]);

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

  // precompute the agent sweeps in a worker shortly after load, so Insights and the pitch never wait
  useEffect(() => {
    if (!ready) return;
    const t = window.setTimeout(() => warmInsights(useSim.getState().replay ?? []), 2500);
    return () => window.clearTimeout(t);
  }, [ready]);

  const go = (id: TabId) => navigate(id === 'overview' ? '/' : PANEL_PATHS[id]);
  const dash = panel === 'dashboard';
  const insights = panel === 'insights';
  const tab: TabId = panel === 'dashboard' || panel === 'insights' ? 'overview' : panel;

  // in the pitch the HUD is curated per scene; otherwise everything is available
  const showAdvisor = !dash && !insights && (!pitching || !!scene.show?.advisor);
  const showRight = !dash && !insights && (!pitching || panel === 'impact');
  const showBottomTools = !pitching;
  const showTime = !pitching || !!scene.show?.timebar;
  /** px kept free at the bottom for the command row (or the taller pitch caption) */
  const bottom = pitching ? 222 : 150;

  return (
    <div className="relative h-full w-full overflow-hidden">
      <MapView />
      <PitchRunner />

      {ready && (
        <>
          <div className="pointer-events-none absolute inset-x-3 top-3 z-10">
            <KpiBar />
          </div>

          {/* left: the agent's voice */}
          {showAdvisor && (
            <div style={{ maxHeight: `calc(100% - ${bottom + 140}px)` }} className="pointer-events-none absolute left-3 top-[96px] z-10 overflow-y-auto xl:top-[88px]">
              <Advisor />
            </div>
          )}

          {/* right: build menu */}
          {showRight && (
            <aside style={{ bottom }} className="pointer-events-auto absolute right-3 top-[96px] z-10 flex w-[340px] flex-col gap-2.5 xl:top-[88px] xl:w-[360px]">
              {!pitching && (
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
              )}
              <div className="pop-in flex min-h-0 flex-1 flex-col" key={tab}>
                <RightPanel tab={tab} />
              </div>
            </aside>
          )}

          {/* data insights: real figures, replaces the side panels */}
          {insights && (
            <div style={{ bottom }} className="panel pop-in pointer-events-auto absolute left-3 right-3 top-[88px] z-10 !rounded-[22px] p-3">
              <Insights />
            </div>
          )}

          {/* bottom row: map key · time machine · command cluster (or the pitch caption) */}
          <div className="pointer-events-none absolute inset-x-3 bottom-3 z-10 flex items-end gap-3">
            {pitching && <PitchCaption />}
            {showBottomTools && <Legend />}
            {showTime && (
              <div className="flex min-w-0 flex-1 justify-center">
                <TimeBar />
              </div>
            )}
            {showBottomTools && <Controls />}
            {pitching && !showTime && <div className="flex-1" />}
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
