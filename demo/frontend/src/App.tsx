import { useEffect, useState } from 'react';
import MapView from './components/MapView';
import TimeBar from './components/TimeBar';
import Header from './components/Header';
import Assistant from './components/Assistant';
import Catalog from './components/Catalog';
import { useSim } from './store/useSim';

/**
 * Layout: header on top, the campus map with a week timeline underneath, and the assistant on the right.
 * The solar & storage catalog opens as a drawer over everything.
 */
export default function App() {
  const ready = useSim((s) => s.snap !== null);
  const [catalog, setCatalog] = useState(false);

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

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-[#f4f5f7]">
      <Header onCatalog={() => setCatalog(true)} />
      <div className="flex min-h-0 flex-1">
        <main className="relative min-w-0 flex-1">
          <MapView />
          {ready && (
            <div className="pointer-events-none absolute inset-x-4 bottom-4 z-10">
              <TimeBar />
            </div>
          )}
          <div className="pointer-events-none absolute bottom-0 right-2 z-0 text-[10px] text-[#80868b]">© OpenStreetMap contributors · UPC Campus Nord data</div>
        </main>
        {ready && <Assistant />}
      </div>
      {catalog && <Catalog onClose={() => setCatalog(false)} />}
    </div>
  );
}
