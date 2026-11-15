import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Deck, MapView as DeckMapView, LightingEffect, AmbientLight, DirectionalLight, FlyToInterpolator, LinearInterpolator } from '@deck.gl/core';
import { Cloud, Crosshair, Layers as LayersIco, Moon, Sun } from 'lucide-react';
import { derived, useSim, workingBatteries } from '../store/useSim';

const derivedRef = () => derived.current;
import { buildMinimal, buildMinimalLayers, cableFlow, dayLevel, heatColor, heatOf, HEAT_CSS, parsePanelId, weekPeakKw, type MiniWorld } from '../scene/minimal';
import { activeAt, useAlarms } from '../lib/alarms';
import { openFaultPanel } from '../live/faultAlertStore';
import { computeMode, useViewMode } from '../lib/mode';
import EnergyFlow from './EnergyFlow';
import { toLonLat } from '../scene/geo';
import { along } from '../scene/network';
import { cableSheet, panelSheet, pvSheet, gradeColor } from '../data/assets';
import { fmtKw } from '../lib/format';
import { modelOf, PV_ASBUILT_KWP, tiltFactor } from '../sim/engine';

/**
 * The campus map: a standalone deck.gl view over OpenStreetMap footprints (scene/minimal.ts).
 * 2D by default, 3D optional. Labels are HTML, anchored to the buildings: on hover by default, or always for the
 * biggest consumers / every building (Settings). Animation (cable pulses, clouds, alarm rings) runs at ~24 fps
 * only while one of those layers is visible.
 */

export interface ViewState {
  longitude: number;
  latitude: number;
  zoom: number;
  pitch: number;
  bearing: number;
  transitionDuration?: number;
  transitionEasing?: (t: number) => number;
  transitionInterpolator?: unknown;
}

export const HOME_2D: ViewState = { longitude: 2.1131, latitude: 41.3867, zoom: 15.8, pitch: 0, bearing: 0 };
export const HOME_3D: ViewState = { longitude: 2.1146, latitude: 41.3866, zoom: 16.15, pitch: 50, bearing: -18 };
/** kept for the scripted pitch (pitch/script.ts) */
export const HOME = HOME_3D;
export const CAMERA_PRESETS: Record<string, Partial<ViewState>> = {
  home: {},
  battery: { longitude: 2.117, latitude: 41.3853, zoom: 18.2 },
  substation: { longitude: 2.11755, latitude: 41.3857, zoom: 18.2 },
  wide: { longitude: 2.1148, latitude: 41.3872, zoom: 14.9 },
};

/** Imperative camera handle (Settings > Map uses it; also the scripted pitch). */
export const camera = {
  go: (_v: Partial<ViewState>, _ms: number, _mode?: 'linear' | 'fly'): void => {},
  fly: (_k: string): void => {},
  rotate: (_deg: number): void => {},
  tilt: (_deg: number): void => {},
  /** set the heading instantly (used by the compass globe while dragging) */
  setBearing: (_deg: number): void => {},
  getBearing: (): number => 0,
};

/**
 * Camera limits: no pan restriction any more (the land plane extends far beyond the mapped data), only a zoom range
 * wide enough to see the whole surrounding area. Pitch / bearing are left untouched so the 3D tilt works at any zoom.
 */
const MIN_ZOOM = 11.5;
function fitToBbox<T extends ViewState>(vs: T, _bbox: [number, number, number, number], _width: number, _height: number): T {
  return vs.zoom < MIN_ZOOM ? { ...vs, zoom: MIN_ZOOM } : vs;
}

const controllerFor = (is3d: boolean) => ({ inertia: 250, dragRotate: is3d, touchRotate: is3d, keyboard: false });

function lights(elev: number, az: number, sunOn: boolean) {
  if (!sunOn) {
    return new LightingEffect({
      ambient: new AmbientLight({ color: [255, 255, 255], intensity: 1.0 }),
      sun: new DirectionalLight({ color: [255, 255, 255], intensity: 1.2, direction: [-0.4, -0.6, -1] }),
    });
  }
  const day = dayLevel(elev);
  const a = (az * Math.PI) / 180;
  const e = (Math.max(elev, 5) * Math.PI) / 180;
  const warm = Math.min(1, Math.max(0, 1 - elev / 30));
  return new LightingEffect({
    ambient: new AmbientLight({ color: [220, 228, 255], intensity: 0.55 + 0.5 * day }),
    sun: new DirectionalLight({
      color: elev > 0 ? [255, 240 - warm * 40, 215 - warm * 80] : [130, 150, 255],
      intensity: elev > 0 ? 0.6 + 1.3 * Math.min(1, elev / 35) : 0.45,
      direction: elev > 0 ? [-Math.sin(a) * Math.cos(e), -Math.cos(a) * Math.cos(e), -Math.sin(e)] : [0.4, -0.3, -0.85],
    }),
  });
}

export default function MapView({ dark }: { dark: boolean; onAlarms?: () => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const compassRef = useRef<HTMLDivElement>(null);
  const deckRef = useRef<Deck | null>(null);
  const renderRef = useRef<(() => void) | null>(null);
  const placeRef = useRef<(() => void) | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [legendOpen, setLegendOpen] = useState(false);
  const campus = useSim((s) => s.campus);
  const ground = useSim((s) => s.ground);
  const network = useSim((s) => s.network);
  const error = useSim((s) => s.loadError);
  const snap = useSim((s) => s.snap);
  const mode3d = useSim((s) => s.mode3d);
  const labelMode = useSim((s) => s.labelMode);
  const showLegend = useSim((s) => s.showLegend);
  const sunLock = useSim((s) => s.sunLock);
  const layers = useSim((s) => s.layers);
  const alarms = useAlarms();
  const viewMode = useViewMode();
  const ready = snap !== null;
  const darkRef = useRef(dark);
  darkRef.current = dark;
  const alarmsRef = useRef(alarms);
  alarmsRef.current = alarms;

  const world = useMemo<MiniWorld | null>(() => (campus && ground ? buildMinimal(campus, ground, network) : null), [campus, ground, network]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !world) return;
    // pan / zoom-out limit: the campus plus a 20 % margin (not the whole mapped area, which is ~3x larger and let the map drift around)
    const cb = campus?.bbox ?? world.bbox;
    const mx = (cb[2] - cb[0]) * 0.2;
    const my = (cb[3] - cb[1]) * 0.2;
    const bbox: [number, number, number, number] = [Math.max(world.bbox[0], cb[0] - mx), Math.max(world.bbox[1], cb[1] - my), Math.min(world.bbox[2], cb[2] + mx), Math.min(world.bbox[3], cb[3] + my)];
    const is3d = () => useSim.getState().mode3d;
    let view: ViewState = is3d() ? HOME_3D : HOME_2D;
    let hoverId: string | null = null;
    let lightKey = '';

    const deck: Deck = new Deck({
      parent: host,
      views: new DeckMapView({ repeat: false }),
      viewState: view as never,
      controller: controllerFor(is3d()),
      onViewStateChange: ({ viewState }: { viewState: ViewState }) => {
        let vs = { ...viewState };
        if (!is3d()) {
          vs.pitch = 0;
          vs.bearing = 0;
        } else vs.pitch = Math.min(60, vs.pitch);
        vs.zoom = Math.min(19.5, vs.zoom);
        // keep the map inside the mapped area (zoom-out and panning stop at its edge)
        vs = fitToBbox(vs, bbox, host.clientWidth, host.clientHeight);
        view = vs;
        deck.setProps({ viewState: vs } as never);
      },
      onAfterRender: () => {
        placeLabels();
        if (compassRef.current) compassRef.current.style.transform = `rotate(${-view.bearing}deg)`;
      },
      // clicking empty map (no building / equipment under the cursor) clears the selection, which also ends the X-ray wireframe
      onClick: (info: { object?: unknown }) => {
        if (!info.object) useSim.getState().select(null);
      },
      getCursor: ({ isHovering, isDragging }: { isHovering: boolean; isDragging: boolean }) => (isDragging ? 'grabbing' : isHovering ? 'pointer' : 'grab'),
      useDevicePixels: Math.min(2, window.devicePixelRatio || 1),
    } as never);
    deckRef.current = deck;

    let flyingUntil = 0;
    const go = (v: Partial<ViewState>, ms: number, mode: 'linear' | 'fly' = 'fly') => {
      flyingUntil = performance.now() + ms;
      view = {
        ...fitToBbox({ ...view, ...v }, bbox, host.clientWidth, host.clientHeight),
        transitionDuration: ms,
        transitionEasing: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
        transitionInterpolator: mode === 'fly' ? new FlyToInterpolator({ speed: 1.6 }) : new LinearInterpolator(['longitude', 'latitude', 'zoom', 'pitch', 'bearing']),
      };
      deck.setProps({ viewState: view } as never);
    };
    camera.go = go;
    // re-fit when the map area changes size (window, sidebar drag) and once at start
    const refit = () => {
      view = fitToBbox(view, bbox, host.clientWidth, host.clientHeight);
      deck.setProps({ viewState: view } as never);
    };
    refit();
    const ro = new ResizeObserver(refit);
    ro.observe(host);
    camera.fly = (k: string) => go({ ...(is3d() ? HOME_3D : HOME_2D), ...(CAMERA_PRESETS[k] ?? {}) }, 1200);
    camera.getBearing = () => view.bearing;
    camera.setBearing = (deg) => {
      if (!is3d()) return;
      view = { ...fitToBbox({ ...view, bearing: deg }, bbox, host.clientWidth, host.clientHeight), transitionDuration: 0 };
      deck.setProps({ viewState: view } as never);
    };
    camera.rotate = (deg) => is3d() && go({ bearing: view.bearing + deg }, 450);
    camera.tilt = (deg) => is3d() && go({ pitch: Math.min(66, Math.max(10, view.pitch + deg)) }, 450);

    /** anchors (lon, lat, z) of everything that can carry a label */
    const anchor = (id: string): number[] | null => {
      const e3 = is3d();
      if (id === 'substation') return [...world.substation.center, e3 ? 6 : 0];
      if (id === 'battery') return [...world.battery.center, e3 ? 4 : 0];
      if (id.startsWith('cable:')) {
        const e = world.net?.edges[+id.slice(6)];
        return e ? [...toLonLat(along(e.path, e.len, 0.5)), 0] : null;
      }
      const pp = parsePanelId(id);
      if (pp) {
        const b = world.ids.indexOf(pp.osmId);
        const x = world.pv.find((q) => q.b === b && q.j === pp.j);
        return x ? [x.center[0], x.center[1], e3 ? x.h + 0.3 : 0] : null;
      }
      if (id.startsWith('pv:')) id = id.slice(3);
      const b = world.ids.indexOf(id);
      return b < 0 ? null : [world.centers[b][0], world.centers[b][1], e3 ? world.heights[b] + 2 : 0];
    };
    /** centre + zoom that makes a building's footprint fill ~80 % of the map area */
    const buildingFit = (id: string): Partial<ViewState> | null => {
      const b = world.ids.indexOf(id.startsWith('pv:') ? id.slice(3) : id);
      if (b < 0) return null;
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const bl of world.buildings) {
        if (bl.b !== b) continue;
        for (const ring of bl.polygon) for (const [x, y] of ring) {
          x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
        }
      }
      if (!isFinite(x0)) return null;
      const lat = (y0 + y1) / 2;
      const w = Math.max(host.clientWidth, 100) * 0.8;
      const h = Math.max(host.clientHeight, 100) * 0.8;
      const zx = Math.log2((w * 360) / (512 * Math.max(x1 - x0, 1e-7)));
      const zy = Math.log2((h * 360 * Math.cos((lat * Math.PI) / 180)) / (512 * Math.max(y1 - y0, 1e-7)));
      return { longitude: (x0 + x1) / 2, latitude: lat, zoom: Math.min(19.5, Math.max(15, Math.min(zx, zy))) };
    };
    function placeLabels() {
      const vp = deck.getViewports()[0];
      const box = labelsRef.current;
      if (!vp || !box) return;
      for (const el of Array.from(box.children) as HTMLElement[]) {
        const a = anchor(el.dataset.id ?? '');
        if (!a) continue;
        const [x, y] = vp.project(a);
        el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      }
    }

    const render = (phase: number) => {
      const st = useSim.getState();
      const s = st.snap;
      if (s) {
        const lk = `${st.layers.sun}:${Math.round(s.sunElev * 2)}:${Math.round(s.sunAz / 3)}`;
        if (lk !== lightKey) {
          lightKey = lk;
          deck.setProps({ effects: [lights(s.sunElev, s.sunAz, st.layers.sun)] } as never);
        }
      }
      const active = s ? activeAt(alarmsRef.current, s.hour).filter((a) => a.target) : [];
      const m = computeMode({ ...st, hour: s?.hour ?? 0 });
      deck.setProps({
        layers: buildMinimalLayers(
          world,
          {
            snap: s,
            version: st.version,
            hoverId,
            selection: st.selection,
            orbiting: st.orbiting,
            mode3d: st.mode3d,
            dark: darkRef.current,
            layers: st.layers,
            phase,
            clock: performance.now() / 1000,
            units: st.batteries.map((u) => ({ id: u.id, kwh: u.capacity * 1000, fault: st.faults.batteries.includes(u.id), sim: m.simUnits.includes(u.id) || !u.asBuilt })),
            faultRoofs: st.faults.roofs,
            simRoofs: m.simRoofs,
            outage: !!s && !!st.faults.outage && s.hour >= st.faults.outage.startH && s.hour < st.faults.outage.startH + st.faults.outage.hours,
            alarmTargets: active.map((a) => ({ target: a.target!, critical: a.severity === 'critical' })),
            panelHi: [st.panelHover?.id].filter((x): x is string => !!x),
          },
          (id) => {
            if (id !== hoverId) {
              hoverId = id;
              setHover(id);
              render(phaseNow());
            }
          },
          (id) => {
            const cur = useSim.getState();
            cur.select(id === cur.selection ? null : id);
          },
        ) as never,
      });
    };
    const phaseNow = () => (performance.now() / 2600) % 1;
    render(phaseNow());
    renderRef.current = () => render(phaseNow());
    placeRef.current = placeLabels;

    // animation: only while something moves
    let raf = 0;
    let last = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const st = useSim.getState();
      const moving = st.layers.cables || (st.layers.weather && (st.snap?.cloud ?? 0) > 0.05) || (st.snap ? activeAt(alarmsRef.current, st.snap.hour).some((a) => a.target) : false);
      // throttle layer rebuilds harder while the camera is flying so the transition stays smooth
      if (!moving || now - last < (flyingUntil > now ? 120 : 42)) return;
      last = now;
      render(phaseNow());
    };
    raf = requestAnimationFrame(loop);

    // rebuild immediately when what the map shows changes
    let lastKey = '';
    let camRaf = 0;

    // slow orbit around the selected building (stops as soon as the user touches the map)
    let orbiting = false;
    let orbitRaf = 0;
    const ORBIT_DEG_PER_S = 7;
    const startOrbit = () => {
      orbiting = true;
      cancelAnimationFrame(orbitRaf);
      let t0 = 0;
      const tick = (now: number) => {
        if (!orbiting) return;
        orbitRaf = requestAnimationFrame(tick);
        if (now < flyingUntil + 150) {
          t0 = now; // still flying in (not centred yet: no wireframe)
          return;
        }
        if (!useSim.getState().orbiting) useSim.setState({ orbiting: true }); // centred and turning: X-ray on
        const dt = Math.min(0.05, (now - (t0 || now)) / 1000);
        t0 = now;
        camera.setBearing(camera.getBearing() + ORBIT_DEG_PER_S * dt);
      };
      orbitRaf = requestAnimationFrame(tick);
    };
    const stopOrbit = () => {
      orbiting = false;
      if (useSim.getState().orbiting) useSim.setState({ orbiting: false }); // user moved the map: wireframe off
    };
    host.addEventListener('pointerdown', stopOrbit);
    host.addEventListener('wheel', stopOrbit, { passive: true });
    const unsub = useSim.subscribe((s, prev) => {
      const key = `${s.version}:${s.snap?.hour}:${s.snap?.sunElev.toFixed(1)}:${s.selection}:${s.mode3d}:${s.orbiting}:${JSON.stringify(s.layers)}:${s.panelFocus}:${s.panelHover?.id}:${s.panelHover?.y}`;
      if (key === lastKey) return;
      lastKey = key;
      if (s.mode3d !== prev.mode3d) {
        deck.setProps({ controller: controllerFor(s.mode3d) } as never);
        go(s.mode3d ? HOME_3D : HOME_2D, 900);
      }
      // a new selection: bring it to the centre of the map
      // Rebuild the layers FIRST (it blocks the main thread), then start the camera on the next frame so the
      // transition's first frames are not swallowed by the rebuild (that was the visible jump).
      render(phaseNow());
      let target: Partial<ViewState> | null = null;
      if (s.panelFocus && s.panelFocus !== prev.panelFocus) {
        // a single panel: zoom in close enough to see it
        const a = anchor(s.panelFocus);
        if (a) target = { longitude: a[0], latitude: a[1], zoom: Math.max(view.zoom, 19) };
      } else if (s.selection && s.selection !== prev.selection) {
        const a = anchor(s.selection);
        target = buildingFit(s.selection) ?? (a ? { longitude: a[0], latitude: a[1], zoom: Math.max(view.zoom, 17.3) } : null);
      }
      if (target) {
        // in 3D look down at an angle so the x-rayed neighbours and the selected building read well
        const t = s.mode3d ? { ...target, pitch: Math.max(view.pitch, 52) } : target;
        cancelAnimationFrame(camRaf);
        camRaf = requestAnimationFrame(() => go(t, 900, 'linear'));
      }
      // a building (not a single panel) is selected in 3D: orbit around it once the camera has arrived
      const bsel = s.selection && !s.panelFocus ? s.selection : null;
      if (bsel && s.mode3d && bsel !== prev.selection) {
        if (s.orbiting) useSim.setState({ orbiting: false });
        startOrbit();
      }
      else if (!bsel || !s.mode3d) {
        orbiting = false;
        if (s.orbiting) useSim.setState({ orbiting: false });
      }
    });

    return () => {
      cancelAnimationFrame(raf);
      cancelAnimationFrame(camRaf);
      orbiting = false;
      cancelAnimationFrame(orbitRaf);
      host.removeEventListener('pointerdown', stopOrbit);
      host.removeEventListener('wheel', stopOrbit);
      unsub();
      ro.disconnect();
      deck.finalize();
      deckRef.current = null;
      renderRef.current = null;
      placeRef.current = null;
    };
  }, [world]);

  // theme switch: re-render the layers in the new palette
  useEffect(() => {
    renderRef.current?.();
  }, [dark]);

  /* ----------------------------------------------------------- labels ---- */
  const heat = world && snap ? heatOf(world, snap) : [];
  const pillIds = useMemo(() => {
    if (!world || !snap || labelMode === 'hover') return [] as string[];
    const order = world.ids.map((id, b) => [snap.perB[id]?.loadKw ?? 0, b] as const).sort((a, b) => b[0] - a[0]);
    return (labelMode === 'top' ? order.slice(0, 8) : order).map(([, b]) => world.ids[b]);
  }, [world, snap, labelMode]);

  const hoverCard = (() => {
    if (!hover || !snap || !world) return null;
    const pp = parsePanelId(hover);
    if (pp) {
      // one PV panel on a roof
      const st = useSim.getState();
      const p = campus?.features.find((x) => x.properties.osmId === pp.osmId)?.properties;
      if (!p) return null;
      const info = panelSheet(p, pp.j, st.solar[pp.osmId], st.panelModel, st.faults.roofs.includes(pp.osmId));
      const d = derivedRef();
      // output = rating x condition x the campus plant's yield this hour (kW per kWp)
      const w = d ? info.ratedKw * info.health * tiltFactor(st.solar[pp.osmId]?.tilt ?? 18) * (d.week.pv[snap.hour] / PV_ASBUILT_KWP) : 0;
      return (
        <>
          <div className="flex items-center gap-2">
            <b className="tnum text-[13px]">{info.sheet.title}</b>
            <span className="badge" style={{ color: gradeColor(info.sheet.condition.grade), background: 'var(--surface-2)' }}>
              {info.sheet.condition.grade}
            </span>
          </div>
          <div className="mt-0.5 text-[11.5px] muted">{info.sheet.type} · on {p.short}</div>
          <div className="mt-2 grid grid-cols-3 gap-3 text-[12px]">
            <Kv k="Output" v={`${(w * 1000).toFixed(0)} W`} />
            <Kv k="Rated" v={`${(info.ratedKw * 1000).toFixed(0)} Wp`} />
            <Kv k="Vs new" v={`${(info.health * 100).toFixed(0)}%`} />
          </div>
          <div className="mt-1.5 text-[11px] faint">Click for the panel sheet</div>
        </>
      );
    }
    if (hover.startsWith('cable:') || hover.startsWith('pv:')) {
      const st = useSim.getState();
      let sheet;
      if (hover.startsWith('cable:')) {
        const i = +hover.slice(6);
        const e = world.net?.edges[i];
        if (!e) return null;
        sheet = cableSheet({ i, len: e.len, down: e.down ?? 1, flowKw: cableFlow(i) });
      } else {
        const id = hover.slice(3);
        const p = campus?.features.find((x) => x.properties.osmId === id)?.properties;
        if (!p) return null;
        sheet = pvSheet(p, st.solar[id], st.panelModel, st.faults.roofs.includes(id));
      }
      return (
        <>
          <div className="flex items-center gap-2">
            <b className="text-[13px]">{sheet.title}</b>
            <span className="badge" style={{ color: gradeColor(sheet.condition.grade), background: 'var(--surface-2)' }}>
              {sheet.condition.grade}
            </span>
          </div>
          <div className="mt-0.5 text-[11.5px] muted">{sheet.type}</div>
          <div className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11.5px]">
            {sheet.specs.slice(0, 4).map((r) => (
              <Fragment key={r.k}>
                <span className="faint">{r.k}</span>
                <span className="tnum">{r.v}</span>
              </Fragment>
            ))}
          </div>
          <div className="mt-1.5 text-[11px] faint">Click for the full sheet</div>
        </>
      );
    }
    if (hover === 'battery') {
      const st = useSim.getState();
      const working = workingBatteries(st);
      const fault = st.faults.batteries.length > 0;
      const act = snap.battKw;
      return (
        <>
          <div className="flex items-center gap-2">
            <b className="text-[13px]">Battery yard</b>
            {fault && <span className="badge badge-crit">fault</span>}
            {snap.forecast && <span className="badge badge-fc">plan</span>}
          </div>
          <div className="mt-0.5 text-[11.5px] muted">{st.batteries.map((b) => modelOf(b).name).join(' · ') || 'No storage installed'}</div>
          <div className="mt-2 grid grid-cols-3 gap-3 text-[12px]">
            <Kv k="State" v={act > 5 ? 'charging' : act < -5 ? 'discharging' : 'idle'} />
            <Kv k="Power" v={fmtKw(Math.abs(act))} />
            <Kv k="Charge" v={`${(snap.soc * 100).toFixed(0)}%`} />
          </div>
          <div className="mt-1.5 text-[11px] faint">{working.length}/{st.batteries.length} units working</div>
        </>
      );
    }
    if (hover === 'substation') {
      return (
        <>
          <b className="text-[13px]">Grid substation</b>
          <div className="mt-0.5 text-[11.5px] muted">Campus connection to the distribution grid</div>
          <div className="mt-2 grid grid-cols-3 gap-3 text-[12px]">
            <Kv k={snap.gridKw >= 0 ? 'Import' : 'Export'} v={fmtKw(Math.abs(snap.gridKw))} />
            <Kv k="Price" v={`${snap.price.toFixed(3)}`} />
            <Kv k="CO₂" v={`${snap.co2.toFixed(3)}`} />
          </div>
        </>
      );
    }
    const f = campus?.features.find((x) => x.properties.osmId === hover)?.properties;
    if (!f) return null;
    const pt = snap.perB[hover];
    const b = world.ids.indexOf(hover);
    const broken = useSim.getState().faults.roofs.includes(hover);
    return (
      <>
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: `rgb(${heatColor(heat[b] ?? 0).join(',')})` }} />
          <b className="text-[13px]">{f.short}</b>
          {broken && <span className="badge badge-crit">PV fault</span>}
          {snap.forecast && <span className="badge badge-fc">forecast</span>}
        </div>
        <div className="mt-0.5 max-w-[260px] truncate text-[11.5px] muted">{f.name}</div>
        <div className="mt-2 grid grid-cols-3 gap-3 text-[12px]">
          <Kv k="Demand" v={fmtKw(pt?.loadKw ?? 0)} />
          <Kv k="Share" v={`${((100 * (pt?.loadKw ?? 0)) / Math.max(1, snap.loadKw)).toFixed(1)}%`} />
          <Kv k="Solar" v={fmtKw(pt?.solarKw ?? 0)} />
        </div>
        <div className="mt-1.5 text-[11px] faint">Click for its history</div>
      </>
    );
  })();

  // newly mounted labels need a position right away (deck only re-places them after its next frame)
  useLayoutEffect(() => {
    placeRef.current?.();
  });

  /* ----------------------------------------------------------- overlays ---- */
  const nowAlarms = snap ? activeAt(alarms, snap.hour) : [];
  const crit = nowAlarms.some((a) => a.severity === 'critical');
  const { time, scenario } = viewMode;
  // frame around the map: green = live, dashed blue = forecast, violet = simulated campus (history: none)
  const frameColor = scenario.length ? 'var(--violet)' : time === 'live' ? 'var(--ok)' : time === 'forecast' ? 'var(--accent)' : 'transparent';

  return (
    <div className="map-backdrop absolute inset-0">
      <div ref={hostRef} className="absolute inset-0" />
      {ready && <div className="pointer-events-none absolute inset-0 z-[5]" style={{ boxShadow: `inset 0 0 0 2px ${frameColor}`, outline: time === 'forecast' && !scenario.length ? `2px dashed ${frameColor}` : undefined, outlineOffset: -2 }} />}

      {/* labels (positions set imperatively after every deck render) */}
      <div ref={labelsRef} className="pointer-events-none absolute inset-0 overflow-hidden">
        {world &&
          snap &&
          pillIds
            .filter((id) => id !== hover)
            .map((id) => {
              const b = world.ids.indexOf(id);
              return (
                <div key={id} data-id={id} className="map-label">
                  <div className="pill">
                    <span className="h-2 w-2 rounded-sm" style={{ background: `rgb(${heatColor(heat[b]).join(',')})` }} />
                    <span className="font-medium">{world.names[b].replace(/^Edifici\s+/, '')}</span>
                    <span className="tnum muted">{fmtKw(snap.perB[id]?.loadKw ?? 0)}</span>
                  </div>
                </div>
              );
            })}
        {hover && hoverCard && (
          <div key={`h-${hover}`} data-id={hover} className="map-label z-10">
            <div className="tip fade-in" style={{ transform: 'translate(-50%, -100%) translateY(-10px)' }}>
              {hoverCard}
              {/* simulated changes / faults on this equipment (shown on hover only) */}
              {(() => {
                const t = hover.startsWith('pv:') ? hover.slice(3) : (parsePanelId(hover)?.osmId ?? hover);
                const items = viewMode.scenario.filter((c) => c.target === t);
                if (!items.length) return null;
                return (
                  <div className="mt-2 border-t border-[var(--border)] pt-1.5">
                    {items.map((c) => (
                      <div key={c.label} className="flex items-center gap-1.5 text-[11px]">
                        <span className="badge !px-1 !py-0" style={{ color: c.kind === 'fault' ? 'var(--danger)' : 'var(--violet)', background: 'var(--surface-2)' }}>
                          {c.kind === 'fault' ? 'fault' : 'sim'}
                        </span>
                        <span className="max-w-[240px] truncate">{c.label}</span>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          </div>
        )}
      </div>

      {!ready && !error && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-[var(--bg)]">
          <div className="spinner" />
          <div className="eyebrow">Loading Campus Nord</div>
        </div>
      )}
      {error && <div className="absolute inset-0 z-20 flex items-center justify-center bg-[var(--bg)] text-[var(--danger)]">Failed to load data — {error}</div>}

      {ready && (
        <>
          {/* top-left: view mode + recenter */}
          <div className="absolute left-4 top-4 z-10 flex items-center gap-2">
            <div className="seg" style={{ boxShadow: 'var(--shadow)' }}>
              <button type="button" className={!mode3d ? 'on' : ''} onClick={() => useSim.getState().setMode3d(false)}>2D</button>
              <button type="button" className={mode3d ? 'on' : ''} onClick={() => useSim.getState().setMode3d(true)}>3D</button>
            </div>
            <button type="button" className="icon-btn" style={{ boxShadow: 'var(--shadow)' }} title="Recenter on the campus" aria-label="Recenter" onClick={() => camera.fly('home')}>
              <Crosshair size={15} />
            </button>
          </div>

          {/* bottom-left: compass globe (3D). Drag it around to spin the map freely about the vertical axis. */}
          {mode3d && (
            <div
              className="absolute left-4 top-16 z-10 h-[68px] w-[68px] cursor-grab touch-none select-none rounded-full border active:cursor-grabbing"
              style={{ background: 'radial-gradient(circle at 35% 30%, var(--surface), var(--surface-2))', borderColor: 'var(--border)', boxShadow: 'var(--shadow)' }}
              title="Drag to rotate the map · double-click to face north"
              onDoubleClick={() => camera.go({ bearing: 0 }, 500, 'linear')}
              onPointerDown={(e) => {
                const el = e.currentTarget;
                el.setPointerCapture(e.pointerId);
                const r = el.getBoundingClientRect();
                const cx = r.left + r.width / 2;
                const cy = r.top + r.height / 2;
                const ang = (ev: { clientX: number; clientY: number }) => (Math.atan2(ev.clientX - cx, cy - ev.clientY) * 180) / Math.PI;
                let prev = ang(e);
                const move = (ev: PointerEvent) => {
                  const a = ang(ev);
                  let d = a - prev;
                  if (d > 180) d -= 360;
                  if (d < -180) d += 360;
                  prev = a;
                  camera.setBearing(camera.getBearing() - d);
                };
                const up = () => {
                  el.removeEventListener('pointermove', move);
                  el.removeEventListener('pointerup', up);
                  el.removeEventListener('pointercancel', up);
                };
                el.addEventListener('pointermove', move);
                el.addEventListener('pointerup', up);
                el.addEventListener('pointercancel', up);
              }}
            >
              <div ref={compassRef} className="pointer-events-none absolute inset-0">
                {/* meridian rings give the globe look */}
                <div className="absolute inset-[6px] rounded-full border" style={{ borderColor: 'var(--border)' }} />
                <div className="absolute bottom-[6px] left-1/2 top-[6px] w-[34%] -translate-x-1/2 rounded-full border" style={{ borderColor: 'var(--border)' }} />
                <div className="absolute left-[6px] right-[6px] top-1/2 h-px" style={{ background: 'var(--border)' }} />
                <div className="absolute left-1/2 top-[3px] -translate-x-1/2 text-[10px] font-bold" style={{ color: 'var(--danger)' }}>N</div>
                <div className="absolute left-1/2 top-[22px] h-[12px] w-[2px] -translate-x-1/2 rounded" style={{ background: 'var(--danger)' }} />
              </div>
            </div>
          )}

          {/* bottom-right: where the power comes from (campus, or the selected building) */}
          <div className="pointer-events-none absolute bottom-[112px] right-4 z-10">
            <EnergyFlow />
          </div>

          {/* top-centre: active alarms */}
          {nowAlarms.length > 0 && (
            <button
              type="button"
              onClick={() => openFaultPanel(nowAlarms.find((a) => a.severity === 'critical') ?? nowAlarms[0])}
              aria-label={`Open details: ${nowAlarms[0].title}`}
              className="fade-in absolute left-1/2 top-4 z-10 flex max-w-[460px] -translate-x-1/2 cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-[12.5px] hover:brightness-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
              style={{ background: 'var(--surface)', borderColor: crit ? 'var(--danger)' : 'var(--warn)', boxShadow: 'var(--shadow)' }}
            >
              <span className="blink h-2 w-2 rounded-full" style={{ background: crit ? 'var(--danger)' : 'var(--warn)' }} />
              <span className="truncate font-medium">{nowAlarms[0].title}</span>
              {nowAlarms.length > 1 && <span className="tnum muted">+{nowAlarms.length - 1}</span>}
            </button>
          )}

          {/* top-right: sun & weather, a small chip that expands on hover */}
          {snap && (layers.sun || layers.weather) && (
            <div className="group absolute right-4 top-4 z-10">
              <div className="card flex items-center gap-2 px-2.5 py-1.5 text-[12px]">
                {snap.sunElev <= 0 ? <Moon size={14} className="muted" /> : snap.cloud > 0.5 ? <Cloud size={14} className="muted" /> : <Sun size={14} style={{ color: '#f5a524' }} />}
                <span className="tnum">{snap.tempC.toFixed(0)}°C</span>
                {sunLock != null && <span className="badge badge-info">frozen</span>}
              </div>
              <div className="card fade-in absolute right-0 top-[calc(100%+6px)] hidden items-center gap-4 px-3 py-2 text-[12px] group-hover:flex">
              <SunDial elev={snap.sunElev} az={snap.sunAz} />
              <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 whitespace-nowrap">
                <span className="faint">Sun</span>
                <span className="tnum">{snap.sunElev > 0 ? `${snap.sunElev.toFixed(0)}° · ${snap.sunAz.toFixed(0)}°` : 'below horizon'}{sunLock != null && <span className="badge badge-info ml-1">frozen</span>}</span>
                <span className="faint">Weather</span>
                <span className="tnum">{snap.tempC.toFixed(0)}°C · {snap.sunElev > 4 ? `${Math.round(snap.cloud * 100)}% cloud` : 'night'}</span>
                <span className="faint">Irradiance</span>
                <span className="tnum">{Math.round(snap.irr)} W/m²</span>
              </div>
              </div>
            </div>
          )}

          {/* bottom-left (above the timeline): legend, collapsed to a chip */}
          <div className="absolute bottom-[112px] left-4 z-10">
            {showLegend || legendOpen ? (
              <div className="card fade-in w-[220px] p-3" onMouseLeave={() => setLegendOpen(false)}>
                <div className="mb-2 flex items-center justify-between">
                  <span className="eyebrow">Legend</span>
                  {!showLegend && (
                    <button type="button" className="text-[11px] muted hover:text-[var(--accent)]" onClick={() => setLegendOpen(false)}>
                      hide
                    </button>
                  )}
                </div>
                <div className="text-[11.5px] muted">Building demand now</div>
                <div className="mt-1 h-1.5 rounded-full" style={{ background: HEAT_CSS }} />
                <div className="tnum mt-1 flex justify-between text-[10.5px] faint">
                  <span>0</span>
                  <span>{world ? fmtKw(weekPeakKw(world)) : ''}</span>
                </div>
                <div className="mt-2.5 grid grid-cols-1 gap-1 text-[11.5px]">
                  <Key c="rgb(236,118,56)" l="Cable · grid import" line />
                  <Key c="rgb(64,176,96)" l="Cable · solar back-feed" line />
                  <Key c="rgb(16,170,170)" l="Cable · battery" line />
                  <div className="flex items-center gap-2">
                    <span className="flex w-5 justify-between">
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'rgb(236,118,56)' }} />
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'rgb(236,118,56)' }} />
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'rgb(236,118,56)' }} />
                    </span>
                    <span className="muted">More dots, faster = more kW (slow = little power)</span>
                  </div>
                  <Key c="rgb(124,92,240)" l="Simulated equipment" />
                  <Key c="rgb(28,52,108)" l="PV array" />
                  <Key c="rgb(220,38,38)" l="Fault / critical alarm" />
                </div>
              </div>
            ) : (
              <button type="button" className="btn" style={{ boxShadow: 'var(--shadow)' }} onMouseEnter={() => setLegendOpen(true)} onClick={() => setLegendOpen(true)}>
                <LayersIco size={14} /> Legend
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Kv({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div className="text-[10.5px] faint">{k}</div>
      <div className="tnum font-medium">{v}</div>
    </div>
  );
}

function Key({ c, l, line }: { c: string; l: string; line?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className={line ? 'h-[3px] w-5 rounded-full' : 'h-2.5 w-2.5 rounded-sm'} style={{ background: c }} />
      <span className="muted">{l}</span>
    </div>
  );
}

/** Tiny sky dial: the sun's azimuth around, elevation from the rim (centre = zenith). */
function SunDial({ elev, az }: { elev: number; az: number }) {
  const r = 15;
  const k = elev > 0 ? 1 - elev / 90 : 1;
  const a = ((az - 90) * Math.PI) / 180;
  const x = 18 + Math.cos(a) * r * k;
  const y = 18 + Math.sin(a) * r * k;
  return (
    <svg width={36} height={36} viewBox="0 0 36 36" aria-hidden>
      <circle cx={18} cy={18} r={r} fill="none" stroke="var(--border-strong)" strokeWidth={1} />
      <circle cx={18} cy={18} r={r * 0.5} fill="none" stroke="var(--border)" strokeWidth={1} />
      <text x={18} y={6} fontSize={6} textAnchor="middle" fill="var(--faint)">N</text>
      <circle cx={x} cy={y} r={3.2} fill={elev > 0 ? '#f5a524' : 'var(--faint)'} />
    </svg>
  );
}
