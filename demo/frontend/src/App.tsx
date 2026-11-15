import { useEffect, useState } from 'react';
import MapView from './components/MapView';
import TimeBar from './components/TimeBar';
import Header from './components/Header';
import Assistant from './components/Assistant';
import AlarmPanel from './components/AlarmPanel';
import BuildingPanel from './components/BuildingPanel';
import AssetPanel from './components/AssetPanel';
import Settings, { type SettingsTab } from './components/Settings';
import SideFrame from './components/SideFrame';
import { useSim } from './store/useSim';
import { useDark } from './lib/theme';
import { LiveHud, LiveRunner } from './live/LiveOverlay';

export type Side = 'chat' | 'alarms' | 'building' | null;

/**
 * Layout: header · map with the timeline underneath · right sidebar (assistant chat, alarm list, or the history of
 * the clicked building; hideable so the map takes the full width). Settings open as a dialog over everything.
 */
export default function App() {
  const ready = useSim((s) => s.snap !== null);
  const selection = useSim((s) => s.selection);
  const dark = useDark();
  const [settings, setSettings] = useState<SettingsTab | null>(null);
  const [side, setSide] = useState<Side>('chat');
  const [pending, setPending] = useState<string | null>(null);
  const toggle = (k: 'chat' | 'alarms') => setSide((s) => (s === k ? null : k));

  /* data + clock (only advances while the week is playing) */
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

  // clicking a building opens its history in the sidebar
  useEffect(() => {
    if (selection) setSide('building');
    // closing a building / equipment panel closes the sidebar (the assistant stays one click away in the header)
    else setSide((s) => (s === 'building' ? null : s));
  }, [selection]);

  // Esc closes the dialog, then the building panel
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setSettings((s) => {
        if (!s) useSim.getState().select(null);
        return null;
      });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const closeBuilding = () => useSim.getState().select(null);
  const isBuilding = !!selection && !!useSim.getState().campus?.features.some((f) => f.properties.osmId === selection);

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-[var(--bg)]">
      <Header onSettings={() => setSettings('appearance')} onAlarms={() => toggle('alarms')} onChat={() => toggle('chat')} side={side} />
      <div className="flex min-h-0 flex-1">
        <main className="relative min-w-0 flex-1">
          <MapView dark={dark} onAlarms={() => setSide('alarms')} />
          <LiveRunner />
          <LiveHud />
          {ready && (
            <div className="pointer-events-none absolute inset-x-4 bottom-4 z-10">
              <TimeBar />
            </div>
          )}
          <div className="pointer-events-none absolute bottom-0.5 right-2 z-0 text-[9.5px] faint">© OpenStreetMap contributors · UPC Campus Nord data</div>
        </main>
        {ready && side && (side !== 'building' || selection) && (
          <SideFrame>
            {side === 'building' && selection && !isBuilding && <AssetPanel key={selection} id={selection} onClose={closeBuilding} />}
            {side === 'building' && selection && isBuilding && (
              <BuildingPanel
                key={selection}
                id={selection}
                onClose={closeBuilding}
                onAsk={(q) => {
                  setPending(q);
                  useSim.getState().select(null);
                  setSide('chat');
                }}
              />
            )}
            {side === 'alarms' && <AlarmPanel onClose={() => setSide(null)} onConfigure={() => setSettings('faults')} />}
            {side === 'chat' && <Assistant onOpenAlarms={() => setSide('alarms')} onClose={() => setSide(null)} pending={pending} onPendingDone={() => setPending(null)} />}
          </SideFrame>
        )}
      </div>
      {settings && <Settings initial={settings} onClose={() => setSettings(null)} />}
    </div>
  );
}
