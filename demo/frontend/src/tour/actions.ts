/**
 * Imperative helpers the tour steps use to drive the real app. Everything here is ABSOLUTE (sets a state, never
 * toggles), so a step produces the same screen whether it is reached by Next, Back or a jump.
 */
import { derived, useSim } from '../store/useSim';
import { useUi, type Popup, type Side } from '../store/useUi';
import { camera, HOME_2D, HOME_3D, type ViewState } from '../components/MapView';
import { closeCharts } from '../lib/chartsHover';
import { panelsOf, worldRef } from '../scene/minimal';
import { useInsightsUi } from '../components/Insights';
import type { LayerId } from '../types';

export const TOUR_WEEK = 17;
export const PAST_WEEK = 8;

export const reducedMotion = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** the navigate function of the router, registered by TourOverlay (this module must not import the router) */
let navigate: (to: string) => void = () => {};
export const setNavigator = (fn: (to: string) => void) => {
  navigate = fn;
};
export const go = (to: string) => {
  if (window.location.pathname !== to) navigate(to);
};

export const BASE_LAYERS: Record<LayerId, boolean> = {
  heat: true,
  glow: false,
  sun: true,
  shadows: true,
  weather: true,
  cables: true,
  assets: true,
  solar: true,
  trees: true,
  people: false,
  labels: true,
};

/** what the user had before the tour started (restored on exit) */
export interface Saved {
  theme: ReturnType<typeof useSim.getState>['theme'];
  layers: Record<LayerId, boolean>;
  mode3d: boolean;
  showActual: boolean;
  weekIdx: number;
  nowMode: 'clock' | 'manual';
  nowH: number;
  modelId: string;
}
let saved: Saved | null = null;
export const snapshotPrefs = () => {
  const s = useSim.getState();
  saved = { theme: s.theme, layers: { ...s.layers }, mode3d: s.mode3d, showActual: s.showActual, weekIdx: s.weekIdx, nowMode: s.nowMode, nowH: s.nowH, modelId: s.modelId };
};

/** Monday 11:00 of a replay week (the story is "a Monday in the life of the campus energy manager") */
function mondayNoon(ms: number[]): number {
  for (let h = 0; h < ms.length; h++) {
    const d = new Date(ms[h]);
    if (d.getUTCDay() === 1 && d.getUTCHours() === 11) return h;
  }
  return 11;
}

/** Every step starts from this baseline (real campus, standard model, Monday 11:00, nothing open, 2D map). */
export async function resetBase(): Promise<void> {
  let st = useSim.getState();
  const replay = st.replay;
  if (!replay) return;
  if (st.modelId !== 'standard') await st.setModel('standard');
  st = useSim.getState();
  st.resetScenario();
  st.setWeek(TOUR_WEEK);
  st.setForecast({ forecastOn: true, nowMode: 'manual', nowH: mondayNoon(replay[TOUR_WEEK].ms) });
  st.setPrefs({ showActual: false, theme: saved?.theme ?? st.theme });
  st.setUnderground(false);
  st.setSunLock(null);
  st.setLayers(BASE_LAYERS);
  st.setMode3d(false);
  st.setPlaying(false);
  st.goLive();
  st.select(null);
  st.setPanelUi({ buildingTab: 'overview', panelFocus: null, panelHover: null });
  closeCharts();
  const ui = useUi.getState();
  ui.setSide(null);
  ui.setSettings(null);
  (['scenario', 'model', 'calendar'] as Popup[]).forEach((p) => ui.setPopup(p, false));
  ui.setZoom('week');
  useInsightsUi.getState().setTab('whatif');
  clearHighlight();
  go('/');
}

export async function restore(): Promise<void> {
  const s = saved;
  clearHighlight();
  if (!s) return;
  const st = useSim.getState();
  if (st.modelId !== s.modelId) await st.setModel(s.modelId);
  const st2 = useSim.getState();
  st2.resetScenario();
  st2.setPrefs({ theme: s.theme, showActual: s.showActual });
  st2.setLayers(s.layers);
  st2.setMode3d(s.mode3d);
  st2.setSunLock(null);
  st2.setWeek(s.weekIdx);
  st2.setForecast({ nowMode: s.nowMode, nowH: s.nowH });
  st2.select(null);
  closeCharts();
  const ui = useUi.getState();
  ui.setSettings(null);
  (['scenario', 'model', 'calendar'] as Popup[]).forEach((p) => ui.setPopup(p, false));
  ui.setZoom('week');
  go('/');
  saved = null;
}

/* ------------------------------------------------------------- UI hooks --- */
export const side = (s: Side) => useUi.getState().setSide(s);
export const popup = (p: Popup, open: boolean) => useUi.getState().setPopup(p, open);
export const ask = (q: string) => useUi.getState().ask(q);
export const openCharts = () => useSim.setState({ chartsPinned: true, chartsOpen: true });

/** camera: eased fly-to (~1.2 s) when `animate`, instant otherwise (replays) */
export function fly(v: Partial<ViewState>, animate: boolean): void {
  camera.go(v, animate && !reducedMotion() ? 1200 : 0, 'fly');
}
export const home = (animate: boolean, is3d = false) => fly(is3d ? HOME_3D : HOME_2D, animate);

export type Cover = 'json' | 'insights' | 'facts' | null;

/* ---------------------------------------------------------- highlights --- */
/** soft ring on DOM elements the presenter is talking about (cleared on the next step) */
export function pulse(selector: string, delay = 350): void {
  window.setTimeout(() => {
    document.querySelectorAll(selector).forEach((el) => {
      el.classList.remove('tour-pulse');
      void (el as HTMLElement).offsetWidth;
      el.classList.add('tour-pulse');
      window.setTimeout(() => el.classList.remove('tour-pulse'), 2600);
    });
  }, delay);
}
export function clearHighlight(): void {
  document.querySelectorAll('.tour-pulse').forEach((el) => el.classList.remove('tour-pulse'));
}

/* ------------------------------------------------------- scene helpers --- */
/** largest roof that can carry PV: the building the story follows */
export function bigRoof(): { id: string; name: string } | null {
  const c = useSim.getState().campus;
  if (!c) return null;
  const roofs = c.features.filter((f) => f.properties.pv_fraction > 0).sort((a, b) => b.properties.area_m2 - a.properties.area_m2);
  const f = roofs[0] ?? c.features[0];
  return f ? { id: f.properties.osmId, name: f.properties.short } : null;
}

/** cable segment that feeds the most buildings (the trunk out of the substation) */
export function trunkCable(): string | null {
  const n = useSim.getState().network;
  if (!n) return null;
  let best = -1;
  let bd = -1;
  n.edges.forEach((e, i) => {
    const d = e.down ?? 0;
    if (d > bd) {
      bd = d;
      best = i;
    }
  });
  return best < 0 ? null : `cable:${best}`;
}

/** add one row of PV panels on a roof (same logic as the "+ Add panel" button of the building sidebar) */
export function addSolarPanel(id: string): void {
  const st = useSim.getState();
  const cfg = st.solar[id] ?? { on: false, fraction: 0, tilt: 18 };
  const M = worldRef.current;
  const ranks = M ? M.pv.filter((x) => M.ids[x.b] === id).map((x) => x.k).sort((a, b) => a - b) : [];
  const n = panelsOf(id).length + 1;
  if (!ranks.length || n > ranks.length) return;
  const lo = ranks[n - 1];
  const hi = ranks[n] ?? 1;
  st.setSolar(id, { on: true, fraction: Math.min(0.6, (0.6 * (lo + hi)) / 2), tilt: cfg.tilt });
}

/** one addition of the fault scene of beats 4-5: 1 original battery unit broken, 2 PV array broken, 3 grid outage at night (dark theme) */
export function faultStep(n: number): void {
  const st = useSim.getState();
  if (n === 1) {
    const asBuilt = st.batteries.find((b) => b.asBuilt);
    if (asBuilt) st.setFaults({ batteries: [asBuilt.id] });
  } else if (n === 2) {
    const roof = bigRoof();
    if (roof) st.setFaults({ roofs: [roof.id] });
  } else if (n === 3) {
    st.setFaults({ outage: { startH: Math.floor(derived.current?.nowH ?? 59), hours: 3 } });
    st.setPrefs({ theme: 'dark' });
    st.setSunLock(23);
  }
}
/** the whole scene up to stage `n`: an extra battery unit (so the agent has something left to re-plan with) plus faults 1..n */
export function faultScene(n: number): void {
  useSim.getState().installBattery('lg-ess');
  for (let i = 1; i <= n; i++) faultStep(i);
}
