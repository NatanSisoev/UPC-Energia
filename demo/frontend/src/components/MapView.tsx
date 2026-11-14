import { useEffect, useMemo, useRef, useState } from 'react';
import { Deck, MapView as DeckMapView, LightingEffect, AmbientLight, DirectionalLight, FlyToInterpolator, LinearInterpolator } from '@deck.gl/core';
import { useSim } from '../store/useSim';
import { buildMinimal, buildMinimalLayers, heatColor, HEAT_CSS, weekPeakKw, type MiniWorld } from '../scene/minimal';
import { fmtKw } from '../lib/format';

/**
 * The campus map: a standalone deck.gl view (no basemap tiles) over OpenStreetMap footprints, drawn by
 * scene/minimal.ts. Flat 2D by default; the 2D / 3D switch extrudes the buildings and allows rotating.
 * Layers are only rebuilt when something they show changes (clock hour, hover, selection, mode).
 */

export interface ViewState {
  longitude: number;
  latitude: number;
  zoom: number;
  pitch: number;
  bearing: number;
  transitionDuration?: number;
  transitionInterpolator?: unknown;
}

export const HOME_2D: ViewState = { longitude: 2.1131, latitude: 41.3867, zoom: 15.8, pitch: 0, bearing: 0 };
export const HOME_3D: ViewState = { longitude: 2.1146, latitude: 41.3866, zoom: 16.15, pitch: 50, bearing: -18 };
/** kept for the scripted pitch (pitch/script.ts) */
export const HOME = HOME_3D;

/** Imperative camera handle (kept for scripted demos / the pitch). */
export const camera = {
  go: (_v: Partial<ViewState>, _ms: number, _mode?: 'linear' | 'fly'): void => {},
  fly: (_k: string): void => {},
  rotate: (_deg: number): void => {},
  tilt: (_deg: number): void => {},
};

const LIGHTS = new LightingEffect({
  ambient: new AmbientLight({ color: [255, 255, 255], intensity: 1.0 }),
  sun: new DirectionalLight({ color: [255, 255, 255], intensity: 1.2, direction: [-0.4, -0.6, -1] }),
});

const controllerFor = (is3d: boolean) => ({ inertia: 250, dragRotate: is3d, touchRotate: is3d, keyboard: false });

export default function MapView() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ id: string; x: number; y: number } | null>(null);
  const campus = useSim((s) => s.campus);
  const ground = useSim((s) => s.ground);
  const error = useSim((s) => s.loadError);
  const ready = useSim((s) => s.snap !== null);
  const snap = useSim((s) => s.snap);
  const mode3d = useSim((s) => s.mode3d);

  const world = useMemo<MiniWorld | null>(() => (campus && ground ? buildMinimal(campus, ground) : null), [campus, ground]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !world || !campus) return;
    const bbox = campus.bbox;
    const is3d = () => useSim.getState().mode3d;
    let view: ViewState = is3d() ? HOME_3D : HOME_2D;
    let hoverId: string | null = null;

    const deck: Deck = new Deck({
      parent: host,
      views: new DeckMapView({ repeat: false }),
      viewState: view as never,
      controller: controllerFor(is3d()),
      effects: [LIGHTS],
      onViewStateChange: ({ viewState }: { viewState: ViewState }) => {
        const vs = { ...viewState };
        // keep the campus in view
        const insetX = (bbox[2] - bbox[0]) * 0.15;
        const insetY = (bbox[3] - bbox[1]) * 0.15;
        vs.longitude = Math.min(bbox[2] - insetX, Math.max(bbox[0] + insetX, vs.longitude));
        vs.latitude = Math.min(bbox[3] - insetY, Math.max(bbox[1] + insetY, vs.latitude));
        if (!is3d()) {
          vs.pitch = 0;
          vs.bearing = 0;
        } else vs.pitch = Math.min(66, vs.pitch);
        vs.zoom = Math.min(19.5, Math.max(15.3, vs.zoom));
        view = vs;
        deck.setProps({ viewState: vs } as never);
      },
      getCursor: ({ isHovering, isDragging }: { isHovering: boolean; isDragging: boolean }) => (isDragging ? 'grabbing' : isHovering ? 'pointer' : 'grab'),
      useDevicePixels: Math.min(2, window.devicePixelRatio || 1),
    } as never);

    const go = (v: Partial<ViewState>, ms: number, mode: 'linear' | 'fly' = 'fly') => {
      view = {
        ...view,
        ...v,
        transitionDuration: ms,
        transitionInterpolator: mode === 'fly' ? new FlyToInterpolator({ speed: 1.6 }) : new LinearInterpolator(['longitude', 'latitude', 'zoom', 'pitch', 'bearing']),
      };
      deck.setProps({ viewState: view } as never);
    };
    camera.go = go;
    camera.fly = () => go(is3d() ? HOME_3D : HOME_2D, 1200);
    camera.rotate = (deg) => go({ bearing: view.bearing + deg }, 450);
    camera.tilt = (deg) => go({ pitch: Math.min(66, Math.max(0, view.pitch + deg)) }, 450);

    const render = () => {
      const st = useSim.getState();
      deck.setProps({
        layers: buildMinimalLayers(
          world,
          { snap: st.snap, hoverId, selection: st.selection, mode3d: st.mode3d, maxTags: 16 },
          (id, x, y) => {
            if (id !== hoverId) {
              hoverId = id;
              render();
            }
            setTip(id ? { id, x, y } : null);
          },
          (id) => {
            const s = useSim.getState();
            s.select(id === s.selection ? null : id);
          },
        ) as never,
      });
    };
    render();

    // rebuild layers only when what the map shows changes
    let lastKey = '';
    const unsub = useSim.subscribe((s, prev) => {
      const key = `${s.version}:${s.snap?.hour}:${s.selection}:${s.mode3d}`;
      if (key === lastKey) return;
      lastKey = key;
      if (s.mode3d !== prev.mode3d) {
        deck.setProps({ controller: controllerFor(s.mode3d) } as never);
        go(s.mode3d ? HOME_3D : HOME_2D, 900);
      }
      render();
    });

    return () => {
      unsub();
      deck.finalize();
    };
  }, [world, campus]);

  const tipProps = tip && campus?.features.find((f) => f.properties.osmId === tip.id)?.properties;
  const pt = tip ? snap?.perB[tip.id] : undefined;
  const share = pt && snap ? (100 * pt.loadKw) / Math.max(1, snap.loadKw) : 0;

  return (
    <div className="absolute inset-0 bg-[#f4f5f7]">
      <div ref={hostRef} className="absolute inset-0" />
      {!ready && !error && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-[#f4f5f7]">
          <div className="spinner" />
          <div className="text-[13px] text-[#5f6368]">Loading Campus Nord…</div>
        </div>
      )}
      {error && <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#f4f5f7] text-[#b3261e]">Failed to load data — {error}</div>}

      {ready && (
        <div className="absolute left-4 top-4 z-10 flex flex-col items-start gap-2">
          {/* 2D / 3D */}
          <div className="seg">
            <button type="button" className={!mode3d ? 'on' : ''} onClick={() => useSim.getState().setMode3d(false)}>2D</button>
            <button type="button" className={mode3d ? 'on' : ''} onClick={() => useSim.getState().setMode3d(true)}>3D</button>
          </div>
          {/* heat key */}
          <div className="card w-[180px] px-3 py-2.5">
            <div className="eyebrow mb-1.5">Building demand</div>
            <div className="h-2 rounded-sm" style={{ background: HEAT_CSS }} />
            <div className="mt-1 flex justify-between text-[11px] text-[#5f6368]">
              <span>~0 kW</span>
              <span>{world ? fmtKw(weekPeakKw(world)) : ''}</span>
            </div>
          </div>
        </div>
      )}

      {tip && tipProps && (
        <div className="tip pointer-events-none absolute z-10" style={{ left: tip.x + 14, top: tip.y + 10 }}>
          <b className="text-[13px]">{tipProps.short}</b>
          <div className="mt-0.5 text-[11px] text-[#5f6368]">{tipProps.name}</div>
          <div className="mt-1.5 flex items-center gap-3 text-[12px]">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: `rgb(${heatColor(0.7).join(',')})` }} />
              <b className="tnum">{fmtKw(pt?.loadKw ?? 0)}</b>
            </span>
            <span className="text-[#5f6368]">{share.toFixed(1)}% of campus</span>
          </div>
          <div className="mt-1 text-[10px] text-[#80868b]">Click to ask the assistant</div>
        </div>
      )}
    </div>
  );
}
