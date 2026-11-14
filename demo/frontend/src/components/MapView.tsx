import { useEffect, useMemo, useRef, useState } from 'react';
import { Deck, MapView as DeckMapView, LightingEffect, AmbientLight, DirectionalLight, FlyToInterpolator } from '@deck.gl/core';
import { useSim } from '../store/useSim';
import { buildWorld, buildLayers, dayLevel, roofColor, type World } from '../scene/world';
import { fmtKw } from '../lib/format';

/**
 * The diorama: a standalone deck.gl scene (no basemap tiles) built from OpenStreetMap footprints.
 * Streets, parks, trees, detailed buildings, PV arrays, the substation, the battery yard and the underground
 * cable network are all drawn by scene/world.ts; this component owns the camera, lighting and render loop.
 */

export { roofColor as categoryColor };

interface ViewState {
  longitude: number;
  latitude: number;
  zoom: number;
  pitch: number;
  bearing: number;
  transitionDuration?: number;
  transitionInterpolator?: unknown;
}

const HOME: ViewState = { longitude: 2.1146, latitude: 41.3868, zoom: 16.05, pitch: 52, bearing: -18 };
export const CAMERA_PRESETS: Record<string, Partial<ViewState>> = {
  home: HOME,
  battery: { longitude: 2.117, latitude: 41.3853, zoom: 18.4, pitch: 58, bearing: -30 },
  substation: { longitude: 2.11755, latitude: 41.3857, zoom: 18.4, pitch: 58, bearing: 20 },
  top: { ...HOME, pitch: 0, bearing: 0, zoom: 16 },
};
export const camera = { fly: (_k: string): void => {}, rotate: (_deg: number): void => {}, tilt: (_deg: number): void => {} };

const mix3 = (a: number[], b: number[], t: number) => a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',');

/** CSS sky behind the transparent scene canvas, driven by the real sun elevation. */
function skyGradient(elev: number): string {
  const day = dayLevel(elev);
  const dusk = Math.max(0, 1 - Math.abs(elev - 2) / 9);
  const top = mix3([12, 16, 38], [96, 150, 214], day);
  const mid = mix3([22, 30, 62], [168, 202, 232], day);
  const base = [mix3([34, 40, 82], [250, 214, 176], day)].join(',').split(',').map(Number);
  const hor = mix3(base, [255, 140, 90], dusk * 0.7);
  const bot = mix3([18, 24, 46], [150, 190, 214], day);
  return `linear-gradient(180deg, rgb(${top}) 0%, rgb(${mid}) 38%, rgb(${hor}) 72%, rgb(${bot}) 100%)`;
}

export default function MapView() {
  const hostRef = useRef<HTMLDivElement>(null);
  const hoverRef = useRef<string | null>(null);
  const viewRef = useRef<ViewState>(HOME);
  const [tip, setTip] = useState<{ id: string; x: number; y: number } | null>(null);
  const campus = useSim((s) => s.campus);
  const ground = useSim((s) => s.ground);
  const error = useSim((s) => s.loadError);
  const ready = useSim((s) => s.snap !== null);
  const snap = useSim((s) => s.snap);

  const world = useMemo<World | null>(() => (campus && ground ? buildWorld(campus, ground) : null), [campus, ground]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !world || !campus) return;
    const bbox = campus.bbox;
    const deck: Deck = new Deck({
      parent: host,
      views: new DeckMapView({ repeat: false }),
      viewState: viewRef.current as never,
      controller: { inertia: 250, dragRotate: true, touchRotate: true, keyboard: false },
      onViewStateChange: ({ viewState }: { viewState: ViewState }) => {
        const vs = { ...viewState };
        // keep the camera target well inside the map so the void / underside of the diorama is never in view
        const insetX = (bbox[2] - bbox[0]) * 0.22;
        const insetY = (bbox[3] - bbox[1]) * 0.22;
        vs.longitude = Math.min(bbox[2] - insetX, Math.max(bbox[0] + insetX, vs.longitude));
        vs.latitude = Math.min(bbox[3] - insetY, Math.max(bbox[1] + insetY, vs.latitude));
        vs.pitch = Math.min(66, Math.max(8, vs.pitch));
        vs.zoom = Math.min(20, Math.max(15.7, vs.zoom));
        viewRef.current = vs;
        deck.setProps({ viewState: vs } as never);
      },
      getCursor: ({ isHovering }: { isHovering: boolean }) => (isHovering ? 'pointer' : 'grab'),
      useDevicePixels: Math.min(2, window.devicePixelRatio || 1),
    } as never);

    camera.fly = (k: string) => {
      const target = CAMERA_PRESETS[k] ?? HOME;
      viewRef.current = { ...viewRef.current, ...target, transitionDuration: 1600, transitionInterpolator: new FlyToInterpolator({ speed: 1.4 }) };
      deck.setProps({ viewState: viewRef.current } as never);
    };

    const nudge = (patch: (v: ViewState) => Partial<ViewState>) => {
      viewRef.current = { ...viewRef.current, ...patch(viewRef.current), transitionDuration: 450, transitionInterpolator: new FlyToInterpolator({ speed: 3 }) };
      deck.setProps({ viewState: viewRef.current } as never);
    };
    camera.rotate = (deg) => nudge((v) => ({ bearing: v.bearing + deg }));
    camera.tilt = (deg) => nudge((v) => ({ pitch: Math.min(66, Math.max(8, v.pitch + deg)) }));
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'SELECT') return;
      if (e.key === 'q' || e.key === 'Q') camera.rotate(-30);
      if (e.key === 'e' || e.key === 'E') camera.rotate(30);
    };
    window.addEventListener('keydown', onKey);

    const onHover = (id: string | null, x: number, y: number) => {
      hoverRef.current = id;
      setTip((p) => (id ? { id, x, y } : p ? null : p));
    };
    const onClick = (id: string | null) => {
      const st = useSim.getState();
      st.select(id === st.selection ? null : id);
    };

    let raf = 0;
    let last = 0;
    let lightKey = '';
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (now - last < 33) return;
      last = now;
      const st = useSim.getState();
      const s = st.snap;
      if (!s) return;
      const el = s.sunElev;
      const lk = `${Math.round(el * 2)}:${Math.round(s.sunAz / 3)}`;
      if (lk !== lightKey) {
        lightKey = lk;
        const day = dayLevel(el);
        const az = (s.sunAz * Math.PI) / 180;
        const e = (Math.max(el, 4) * Math.PI) / 180;
        const warm = Math.min(1, Math.max(0, 1 - el / 30));
        const dir: [number, number, number] =
          el > 0 ? [-Math.sin(az) * Math.cos(e), -Math.cos(az) * Math.cos(e), -Math.sin(e)] : [0.4, -0.3, -0.85];
        deck.setProps({
          effects: [
            new LightingEffect({
              ambient: new AmbientLight({ color: [210, 222, 255], intensity: 0.5 + 0.5 * day }),
              sun: new DirectionalLight({
                color: el > 0 ? [255, 236 - warm * 50, 205 - warm * 95] : [120, 150, 255],
                intensity: el > 0 ? 0.7 + 1.7 * Math.min(1, el / 35) : 0.55,
                direction: dir,
              }),
            }),
          ],
        } as never);
        host.style.background = skyGradient(el);
      }
      deck.setProps({
        layers: buildLayers(
          world,
          {
            snap: s,
            phase: (now / 3200) % 1,
            version: st.version,
            solar: st.solar,
            panel: st.panelModel,
            selection: st.selection,
            underground: st.underground,
            hoverId: hoverRef.current,
            fleetKwh: s.capacityKwh,
            layers: st.layers,
          },
          onHover,
          onClick,
        ) as never,
      });
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey);
      deck.finalize();
    };
  }, [world, campus]);

  const tipProps = tip && campus?.features.find((f) => f.properties.osmId === tip.id)?.properties;
  const pt = tip ? snap?.perB[tip.id] : undefined;

  return (
    <div className="absolute inset-0">
      <div ref={hostRef} className="absolute inset-0" style={{ background: skyGradient(30) }} />
      {!ready && !error && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-[#16203a]">
          <div className="loader-bolt">⚡</div>
          <div className="font-display text-sm tracking-[0.35em] text-cyan-200/90">BUILDING CAMPUS NORD…</div>
        </div>
      )}
      {error && <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#16203a] text-rose-300">failed to load data — {error}</div>}
      {tip && tipProps && (
        <div className="tooltip-card pointer-events-none absolute z-10" style={{ left: tip.x + 16, top: tip.y - 12 }}>
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded" style={{ background: `rgb(${roofColor(tipProps.category).join(',')})` }} />
            <b className="font-display text-[13px]">{tipProps.short}</b>
          </div>
          <div className="mt-0.5 text-[10px] text-slate-400">
            {tipProps.name} · {tipProps.school}
          </div>
          <div className="mt-1.5 flex gap-3 text-[12px] font-bold">
            <span className="text-rose-300">⚡ {fmtKw(pt?.loadKw ?? 0)}</span>
            {pt && pt.solarKw > 0.5 ? <span className="text-amber-300">☀ {fmtKw(pt.solarKw)}</span> : null}
          </div>
          <div className="mt-1 text-[9px] uppercase tracking-wider text-slate-500">click to inspect</div>
        </div>
      )}
    </div>
  );
}
