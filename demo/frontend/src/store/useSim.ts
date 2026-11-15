/**
 * Live simulation state. The playback clock walks through one REAL campus week (public/data/replay.json);
 * everything shown is derived from challenge.ts (exact port of sim/ + the MPC agent), so the KPIs and the
 * "score" are the contest's numbers. Heavy arrays live in `derived` (outside React state); the store only
 * carries a `version` counter so components know when to re-read them.
 *
 * History / forecast: with the forecast split on, hours after "now" use what was knowable at "now"
 * (sim/forecast.ts) and the agent plans on that, exactly as it would live.
 */
import { create } from 'zustand';
import type {
  AgentKind,
  BatteryUnit,
  BuildingFeature,
  CampusData,
  GroundData,
  LayerId,
  PanelModelId,
  ReplayWeek,
  Snapshot,
  SolarCfg,
  WeekSummary,
} from '../types';
import type { Network } from '../scene/network';
import { BATTERY_MODELS } from '../data/catalogue';
import { buildLoadShares, buildingSolarKw, PV_ASBUILT_KWP, asBuiltCoverage, DEFAULT_TILT, fleetSpec } from '../sim/engine';
import { simulateWeek, CHALLENGE_SPEC, type SimResult, type WeekInput } from '../sim/challenge';
import { forecastWeek, clockHour } from '../sim/forecast';
import { THIS_YEAR, batterySoh, pvHealth, pvYear } from '../data/assets';
import { sunAt } from '../lib/sun';
import { weekMsAt } from '../lib/format';

const HOURS = 168;

/** Heavy derived data for the current week + configuration. */
export interface Derived {
  /** the series the app shows: measured before `nowH`, forecast after it */
  week: ReplayWeek;
  /** the measured week (to compare the forecast with what really happened) */
  actual: ReplayWeek;
  /** first forecast hour, or null when the whole week is shown as history */
  nowH: number | null;
  startMs: number;
  pvTot: Float64Array;
  shares: Float64Array;
  sims: { mpc: SimResult | null; template: SimResult | null; none: SimResult };
  chosen: SimResult;
  summary: Record<'mpc' | 'template' | 'none', WeekSummary>;
  /** grid CO2 (kg) and cost (EUR) of the week: the real as-built campus vs the chosen (simulated) configuration */
  totals: { real: { co2Kg: number; costEur: number }; chosen: { co2Kg: number; costEur: number } };
}

export const derived: { current: Derived | null } = { current: null };

export type ThemeMode = 'light' | 'dark' | 'system';
export type LabelMode = 'hover' | 'top' | 'all';
export type AlarmKind = 'equipment' | 'outage' | 'demand' | 'price' | 'co2' | 'soc' | 'data';

export interface Faults {
  /** battery unit ids that are broken (offline) */
  batteries: string[];
  /** building osmIds whose PV array is broken */
  roofs: string[];
  /** simulated grid outage window (hour index in the week) */
  outage: { startH: number; hours: number } | null;
}

export interface AlarmCfg {
  /** contracted / substation demand limit, kW */
  maxDemandKw: number;
  /** €/kWh */
  priceHigh: number;
  /** kg CO2/kWh */
  co2High: number;
  /** 0..1 */
  socLow: number;
  on: Record<AlarmKind, boolean>;
}

/** A model (agent) that can drive the demo: built-in (public/data/models/index.json) or uploaded (/api/models). */
export interface ModelInfo {
  id: string;
  name: string;
  desc?: string;
  builtin: boolean;
  available: boolean;
  /** where its replay json lives; null = no battery */
  url?: string | null;
  meanScore?: number;
  violations?: number;
  msPerStep?: number | null;
  /** uploads only */
  status?: 'processing' | 'ready' | 'failed';
  stage?: string;
  progress?: number;
  error?: string;
  problems?: string[];
}

const MODEL_KEY = 'upc-energy-model';
export const DEFAULT_MODEL = 'standard';
const readModelPref = (): string => {
  try {
    return localStorage.getItem(MODEL_KEY) || DEFAULT_MODEL;
  } catch {
    return DEFAULT_MODEL;
  }
};

interface SimStore {
  /** model selector */
  models: ModelInfo[];
  modelId: string;
  modelLoading: boolean;
  /** false when the dev middleware (uploads) is not reachable, e.g. a static deploy */
  uploadsOn: boolean;
  modelToast: { kind: 'error' | 'ok'; text: string } | null;
  loadModels: () => Promise<void>;
  setModel: (id: string) => Promise<void>;
  deleteModel: (id: string) => Promise<void>;
  setModelToast: (t: { kind: 'error' | 'ok'; text: string } | null) => void;
  campus: CampusData | null;
  ground: GroundData | null;
  network: Network | null;
  replay: ReplayWeek[] | null;
  loadError: string | null;

  weekIdx: number;
  tMin: number;
  playing: boolean;
  /** simulated minutes per real second */
  speed: number;

  panelModel: PanelModelId;
  solar: Record<string, SolarCfg>;
  batteries: BatteryUnit[];
  agent: AgentKind;
  selection: string | null;
  underground: boolean;
  layers: Record<LayerId, boolean>;
  /** null = the sun follows the clock; a number freezes the sun at that local hour of day */
  sunLock: number | null;
  /** map mode: flat 2D (default) or extruded 3D */
  mode3d: boolean;

  theme: ThemeMode;
  labelMode: LabelMode;
  showLegend: boolean;

  /** history / forecast split */
  forecastOn: boolean;
  /** 'clock': "now" follows the real weekday + hour; 'manual': fixed at nowH */
  nowMode: 'clock' | 'manual';
  nowH: number;
  /** draw the measured values over the forecast part of the timeline */
  showActual: boolean;
  /** apply equipment ageing (battery state of health, PV module degradation) to the simulation */
  ageing: boolean;

  faults: Faults;
  alarmCfg: AlarmCfg;

  snap: Snapshot | null;
  /** bumped when week / solar / battery / agent / forecast / faults change (components re-read `derived`) */
  version: number;

  load: () => Promise<void>;
  tick: (dtSec: number) => void;
  setPlaying: (v: boolean) => void;
  setSpeed: (v: number) => void;
  setTMin: (v: number) => void;
  /** jump to "now" and stop playback, so the view stays on the live hour */
  goLive: () => void;
  setWeek: (i: number) => void;
  setAgent: (a: AgentKind) => void;
  setUnderground: (v: boolean) => void;
  toggleLayer: (id: LayerId) => void;
  setLayers: (patch: Partial<Record<LayerId, boolean>>) => void;
  setSunLock: (h: number | null) => void;
  setMode3d: (v: boolean) => void;
  select: (id: string | null) => void;
  /** individual PV panel selected / hovered in the building sidebar, and which tab that sidebar shows */
  panelFocus: string | null;
  /** true only while the camera is centred on the selected building and slowly orbiting it (drives the X-ray wireframe) */
  orbiting: boolean;
  /** forecast generation: 'off' = future hidden (only past + LIVE), 'running' = being revealed hour by hour, 'ready' = shown */
  fcStage: 'off' | 'running' | 'ready';
  /** forecast hours revealed so far while running (fractional) */
  fcReveal: number;
  generateForecast: () => void;
  clearForecast: () => void;
  panelHover: { id: string; y: number } | null;
  buildingTab: 'overview' | 'solar';
  setPanelUi: (p: Partial<Pick<SimStore, 'panelFocus' | 'panelHover' | 'buildingTab'>>) => void;
  setPanelModel: (id: PanelModelId) => void;
  setSolar: (id: string, patch: Partial<SolarCfg>) => void;
  solarPreset: (preset: 'off' | 'asbuilt' | 'max') => void;
  installBattery: (modelId: string) => void;
  updateBattery: (id: string, patch: Partial<BatteryUnit>) => void;
  removeBattery: (id: string) => void;
  /** the bottom timeline is pinned open as a grid of charts (about half the page) */
  chartsPinned: boolean;
  setChartsPinned: (v: boolean) => void;
  /** charts panel opened by hovering the timeline (closes on leave unless pinned) */
  chartsOpen: boolean;
  /** the dwell timer is running (drives the progress hint) */
  chartsDwell: boolean;
  setPrefs: (p: Partial<Pick<SimStore, 'theme' | 'labelMode' | 'showLegend' | 'showActual'>>) => void;
  setForecast: (p: Partial<Pick<SimStore, 'forecastOn' | 'nowMode' | 'nowH'>>) => void;
  setFaults: (p: Partial<Faults>) => void;
  setAgeing: (v: boolean) => void;
  setAlarmCfg: (p: Partial<AlarmCfg>) => void;
  /** back to the real, as-built campus: challenge battery, real PV plant, MPC agent, no faults */
  resetScenario: () => void;
}

let unitSeq = 0;
/** a new (simulated) unit commissioned this year */
const unit = (modelId: string): BatteryUnit => {
  const m = BATTERY_MODELS.find((x) => x.id === modelId)!;
  return { id: `b${unitSeq++}`, modelId, capacity: m.capacity, power: m.power, year: THIS_YEAR };
};
/** the real campus battery (the challenge spec); its commissioning year is an estimate */
const asBuiltUnit = (): BatteryUnit => ({ ...unit('challenge'), year: 2023, asBuilt: true });

/** user preferences that survive a reload (per browser) */
const PREF_KEY = 'upc-energy-prefs';
function loadPrefs(): Partial<SimStore> {
  try {
    return JSON.parse(localStorage.getItem(PREF_KEY) ?? '{}') as Partial<SimStore>;
  } catch {
    return {};
  }
}
function savePrefs(s: SimStore): void {
  try {
    const { theme, labelMode, showLegend, layers, mode3d, speed, showActual, alarmCfg } = s;
    localStorage.setItem(PREF_KEY, JSON.stringify({ theme, labelMode, showLegend, layers, mode3d, speed2: speed, showActual, alarmCfg }));
  } catch {
    /* private mode: preferences just are not remembered */
  }
}

const DEFAULT_LAYERS: Record<LayerId, boolean> = {
  heat: true,
  glow: false, // off by default: buildings carry the heat colour themselves
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

const prefs = loadPrefs();

export const useSim = create<SimStore>((set, get) => ({
  models: [],
  modelId: DEFAULT_MODEL,
  modelLoading: false,
  uploadsOn: false,
  modelToast: null,
  setModelToast: (t) => set({ modelToast: t }),
  loadModels: async () => {
    let built: ModelInfo[] = [];
    let up: ModelInfo[] = [];
    let uploadsOn = false;
    try {
      built = await fetch('/data/models/index.json').then((x) => (x.ok ? x.json() : []));
    } catch {
      /* no built-in index: only the default model exists */
    }
    try {
      const r = await fetch('/api/models');
      if (r.ok && (r.headers.get('content-type') ?? '').includes('json')) {
        up = ((await r.json()) as ModelInfo[]).map((m) => ({ ...m, builtin: false, available: m.status === 'ready' }));
        uploadsOn = true;
      }
    } catch {
      /* static deploy: uploads unavailable */
    }
    if (!built.length) built = [{ id: DEFAULT_MODEL, name: 'Standard MPC', builtin: true, available: true, url: '/data/replay.json' }];
    set({ models: [...built, ...up], uploadsOn });
  },
  setModel: async (id) => {
    const s = get();
    const m = s.models.find((x) => x.id === id);
    if (!m || !m.available) return;
    set({ modelLoading: true });
    try {
      let replay = s.replay;
      if (m.id !== 'none') {
        const url = m.builtin ? (m.url ?? '/data/replay.json') : `/api/models/${m.id}/replay`;
        const r = await fetch(url);
        if (!r.ok) throw new Error(`${m.name}: replay not available (HTTP ${r.status})`);
        replay = ((await r.json()) as { weeks: ReplayWeek[] }).weeks;
      } else if (!replay) {
        throw new Error('data not loaded yet');
      }
      set({ replay, modelId: id, agent: id === 'none' ? 'none' : 'mpc' });
      try {
        localStorage.setItem(MODEL_KEY, id);
      } catch {
        /* not remembered */
      }
      recompute(set, get);
    } catch (e) {
      set({ modelToast: { kind: 'error', text: `Could not switch model: ${e instanceof Error ? e.message : String(e)}` } });
    } finally {
      set({ modelLoading: false });
    }
  },
  deleteModel: async (id) => {
    try {
      const r = await fetch(`/api/models/${id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      if (get().modelId === id) await get().setModel(DEFAULT_MODEL);
      await get().loadModels();
    } catch (e) {
      set({ modelToast: { kind: 'error', text: `Could not delete the model: ${e instanceof Error ? e.message : String(e)}` } });
    }
  },
  campus: null,
  ground: null,
  network: null,
  replay: null,
  loadError: null,
  weekIdx: 17, // a spring week with a nice price/CO2 spread
  tMin: 24 * 60 + 13 * 60,
  playing: false,
  speed: (prefs as { speed2?: number }).speed2 ?? 30, // 0.5 simulated hours per second
  panelModel: 'mono',
  solar: {},
  batteries: [asBuiltUnit()],
  agent: 'mpc',
  selection: null,
  panelFocus: null,
  orbiting: false,
  fcStage: 'off',
  fcReveal: 0,
  chartsPinned: false,
  chartsOpen: false,
  chartsDwell: false,
  setChartsPinned: (v) => set({ chartsPinned: v }),
  panelHover: null,
  buildingTab: 'overview',
  underground: false,
  layers: { ...DEFAULT_LAYERS, ...(prefs.layers ?? {}) },
  sunLock: null,
  mode3d: prefs.mode3d ?? false,
  theme: prefs.theme ?? 'light',
  labelMode: prefs.labelMode ?? 'hover',
  showLegend: prefs.showLegend ?? false,
  forecastOn: true,
  nowMode: 'clock',
  nowH: 84,
  showActual: prefs.showActual ?? false,
  ageing: false,
  faults: { batteries: [], roofs: [], outage: null },
  alarmCfg: {
    maxDemandKw: 1600,
    priceHigh: 0.25,
    co2High: 0.2,
    socLow: 0.1,
    on: { equipment: true, outage: true, demand: true, price: true, co2: true, soc: true, data: true },
    ...(prefs.alarmCfg ?? {}),
  },
  snap: null,
  version: 0,

  load: async () => {
    try {
      const [c, g, r, n] = await Promise.all([
        fetch('/data/campus.json').then((x) => x.json()),
        fetch('/data/ground.json').then((x) => x.json()),
        fetch('/data/replay.json').then((x) => x.json()),
        fetch('/data/network.json').then((x) => x.json()),
      ]);
      const campus = c as CampusData;
      const cov = asBuiltCoverage(campus.features.map((f) => f.properties));
      const solar: Record<string, SolarCfg> = {};
      for (const f of campus.features) {
        const has = f.properties.pv_fraction > 0;
        solar[f.properties.osmId] = { on: has, fraction: has ? cov : 0, tilt: DEFAULT_TILT };
      }
      const replay = (r as { weeks: ReplayWeek[] }).weeks;
      const nowH = clockHour(replay[get().weekIdx]);
      // open at "now", in the history part
      set({ campus, ground: g as GroundData, network: n as Network, replay, solar, nowH, tMin: nowH * 60 });
      recompute(set, get);
      await get().loadModels();
      const saved = readModelPref();
      if (saved !== DEFAULT_MODEL) {
        if (get().models.some((m) => m.id === saved && m.available)) await get().setModel(saved);
        else
          try {
            localStorage.removeItem(MODEL_KEY);
          } catch {
            /* ignore */
          }
      }
    } catch (e) {
      set({ loadError: String(e) });
    }
  },

  tick: (dtSec) => {
    const s = get();
    if (!s.campus || !derived.current) return;
    if (!s.playing) return;
    const maxMin = visibleLimitH(s) * 60 - 1;
    let t = s.tMin + dtSec * s.speed;
    if (t >= maxMin) {
      // the future is not generated: stop at LIVE instead of wrapping around the week
      if (maxMin < HOURS * 60 - 1) {
        set({ tMin: maxMin, playing: false, snap: snapshotAt(get(), maxMin) });
        return;
      }
    }
    if (t >= HOURS * 60) t -= HOURS * 60;
    set({ tMin: t, snap: snapshotAt(get(), t) });
  },

  setPlaying: (v) => set({ playing: v }),
  setSpeed: (v) => {
    set({ speed: v });
    savePrefs(get());
  },
  setTMin: (t0) => {
    const t = Math.min(t0, visibleLimitH(get()) * 60 - 1);
    set({ tMin: t, snap: derived.current ? snapshotAt(get(), t) : null });
  },
  goLive: () => {
    const t = get().nowH * 60;
    set({ playing: false, tMin: t, snap: derived.current ? snapshotAt(get(), t) : null });
  },
  generateForecast: () => {
    const d = derived.current;
    const s = get();
    if (!d || d.nowH == null || s.fcStage === 'running') return;
    const total = Math.max(1, d.week.load.length - d.nowH - 1);
    stopForecastTimer();
    set({ fcStage: 'running', fcReveal: 0 });
    const t0 = performance.now();
    // ~9 s of "generation"; eases out so the first hours appear quickly and the far horizon takes longer
    fcTimer = window.setInterval(() => {
      const p = Math.min(1, (performance.now() - t0) / FC_DURATION_MS);
      const e = 1 - Math.pow(1 - p, 1.6);
      if (p >= 1) {
        stopForecastTimer();
        set({ fcStage: 'ready', fcReveal: total });
      } else set({ fcReveal: e * total });
    }, 60);
  },
  clearForecast: () => {
    stopForecastTimer();
    const s = get();
    const d = derived.current;
    const lim = d?.nowH != null ? d.nowH * 60 : null;
    set({ fcStage: 'off', fcReveal: 0, ...(lim != null && s.tMin > lim ? { tMin: lim, playing: false } : {}) });
    if (lim != null && s.tMin > lim) set({ snap: derived.current ? snapshotAt(get(), lim) : null });
  },
  setWeek: (i) => {
    const s = get();
    stopForecastTimer();
    set({ fcStage: 'off', fcReveal: 0 });
    set({ weekIdx: i, ...(s.nowMode === 'clock' && s.replay ? { nowH: clockHour(s.replay[i]) } : {}) });
    recompute(set, get);
  },
  setAgent: (a) => {
    set({ agent: a });
    recompute(set, get);
  },
  setUnderground: (v) => set({ underground: v }),
  toggleLayer: (id) => {
    set((s) => ({ layers: { ...s.layers, [id]: !s.layers[id] } }));
    savePrefs(get());
  },
  setLayers: (patch) => {
    set((s) => ({ layers: { ...s.layers, ...patch } }));
    savePrefs(get());
  },
  setSunLock: (h) => {
    set({ sunLock: h });
    set({ snap: derived.current ? snapshotAt(get(), get().tMin) : null });
  },
  setMode3d: (v) => {
    set({ mode3d: v });
    savePrefs(get());
  },
  select: (id) => {
    // a single PV panel: open its building on the Solar tab with that panel selected
    const m = id?.match(/^panel:(.+):(\d+)$/);
    if (m) set({ selection: m[1], panelFocus: id, buildingTab: 'solar' });
    else set((s) => ({ selection: id, panelFocus: null, panelHover: null, buildingTab: id === s.selection ? s.buildingTab : 'overview' }));
  },
  setPanelUi: (p) => set(p),
  setPanelModel: (id) => {
    set({ panelModel: id });
    recompute(set, get);
  },
  setSolar: (id, patch) => {
    set((s) => ({ solar: { ...s.solar, [id]: { ...s.solar[id], ...patch } } }));
    recompute(set, get);
  },
  solarPreset: (preset) => {
    const s = get();
    const cov = asBuiltCoverage(s.campus!.features.map((f) => f.properties));
    const solar = { ...s.solar };
    for (const f of s.campus!.features) {
      const has = f.properties.pv_fraction > 0;
      solar[f.properties.osmId] = {
        ...solar[f.properties.osmId],
        on: preset !== 'off' && has,
        fraction: preset === 'off' ? 0 : preset === 'max' ? 0.6 : has ? cov : 0,
      };
    }
    set({ solar });
    recompute(set, get);
  },
  installBattery: (modelId) => {
    set((s) => ({ batteries: [...s.batteries, unit(modelId)] }));
    recompute(set, get);
  },
  updateBattery: (id, patch) => {
    set((s) => ({ batteries: s.batteries.map((b) => (b.id === id ? { ...b, ...patch } : b)) }));
    recompute(set, get);
  },
  removeBattery: (id) => {
    set((s) => ({ batteries: s.batteries.filter((b) => b.id !== id), faults: { ...s.faults, batteries: s.faults.batteries.filter((x) => x !== id) } }));
    recompute(set, get);
  },
  setPrefs: (p) => {
    set(p);
    savePrefs(get());
  },
  setForecast: (p) => {
    const s = get();
    const next: Partial<SimStore> = { ...p, fcStage: 'off', fcReveal: 0 };
    stopForecastTimer();
    if (p.nowMode === 'clock' && s.replay) next.nowH = clockHour(s.replay[s.weekIdx]);
    set(next);
    recompute(set, get);
    // a hidden future cannot stay selected: pull the playhead back to LIVE
    const lim = visibleLimitH(get()) * 60 - 1;
    if (get().tMin > lim) get().setTMin(lim);
  },
  setAgeing: (v) => {
    set({ ageing: v });
    recompute(set, get);
  },
  setFaults: (p) => {
    set((s) => ({ faults: { ...s.faults, ...p } }));
    recompute(set, get);
  },
  resetScenario: () => {
    const campus = get().campus;
    const solar: Record<string, SolarCfg> = {};
    if (campus) {
      const cov = asBuiltCoverage(campus.features.map((f) => f.properties));
      for (const f of campus.features) {
        const has = f.properties.pv_fraction > 0;
        solar[f.properties.osmId] = { on: has, fraction: has ? cov : 0, tilt: DEFAULT_TILT };
      }
    }
    set({ batteries: [asBuiltUnit()], panelModel: 'mono', agent: 'mpc', ageing: false, solar, faults: { batteries: [], roofs: [], outage: null } });
    recompute(set, get);
  },
  setAlarmCfg: (p) => {
    set((s) => ({ alarmCfg: { ...s.alarmCfg, ...p, on: { ...s.alarmCfg.on, ...(p.on ?? {}) } } }));
    set({ version: get().version + 1 });
    savePrefs(get());
  },
}));

const FC_DURATION_MS = 9000;
let fcTimer = 0;
function stopForecastTimer(): void {
  if (fcTimer) window.clearInterval(fcTimer);
  fcTimer = 0;
}

/**
 * Hours of the week that may be shown (exclusive upper bound): everything up to and including LIVE, plus the forecast
 * hours generated so far. Without a forecast split (or before it is generated) the future is hidden.
 */
export function visibleLimitH(s: Pick<SimStore, 'fcStage' | 'fcReveal'>): number {
  const d = derived.current;
  const n = d?.week.load.length ?? 168;
  if (!d || d.nowH == null) return n;
  if (s.fcStage === 'ready') return n;
  return Math.min(n, d.nowH + 1 + (s.fcStage === 'running' ? Math.floor(s.fcReveal) : 0));
}

type Setter = (p: Partial<SimStore> | ((s: SimStore) => Partial<SimStore>)) => void;

const shareCache = new Map<string, Float64Array>();

function summarize(r: SimResult): WeekSummary {
  const m = r.metrics;
  return {
    score: m.score,
    dCo2Pct: m.dCo2Pct,
    dCostPct: m.dCostPct,
    violations: m.violations,
    co2SavedKg: m.co2Base - m.co2Agent,
    costSavedEur: m.costBase - m.costAgent,
  };
}

/** Battery units that are not marked broken. */
export function workingBatteries(s: Pick<SimStore, 'batteries' | 'faults'>): BatteryUnit[] {
  return s.batteries.filter((b) => !s.faults.batteries.includes(b.id));
}

const roofCfg = (s: SimStore, id: string): SolarCfg => {
  const c = s.solar[id] ?? { on: false, fraction: 0, tilt: DEFAULT_TILT };
  return s.faults.roofs.includes(id) ? { ...c, on: false } : c;
};

/** Re-run the three simulations (agent, template, no battery) for the current week + configuration. */
function recompute(set: Setter, get: () => SimStore): void {
  const s = get();
  if (!s.campus || !s.replay) return;
  const actual = s.replay[s.weekIdx];
  const nowH = s.forecastOn ? Math.min(actual.load.length, Math.max(0, s.nowH)) : null;
  let week = actual;
  if (nowH != null && nowH < actual.load.length) {
    const fc = forecastWeek(s.replay, s.weekIdx, nowH);
    week = { ...actual, load: Array.from(fc.load), pv: Array.from(fc.pv), price: Array.from(fc.price), co2: Array.from(fc.co2) };
  }
  const startMs = Date.UTC(+week.start.slice(0, 4), +week.start.slice(5, 7) - 1, +week.start.slice(8, 10), +week.start.slice(11, 13));
  const props = s.campus.features.map((f) => f.properties);
  const key = `${s.weekIdx}`;
  let shares = shareCache.get(key);
  if (!shares) {
    shares = buildLoadShares(props, week.ms, HOURS);
    shareCache.set(key, shares);
  }
  const pvTot = new Float64Array(HOURS);
  for (let h = 0; h < HOURS; h++) {
    const yieldKw = week.pv[h] / PV_ASBUILT_KWP;
    let t = 0;
    for (const p of props) t += buildingSolarKw(p, roofCfg(s, p.osmId), s.panelModel, yieldKw) * pvFactor(s, p);
    pvTot[h] = t;
  }
  const input: WeekInput = { start: week.start, ms: week.ms, load: week.load, pv: pvTot, price: week.price, co2: week.co2 };
  const none = simulateWeek(input, { capacityKwh: 1, powerKw: 0, eta: 1 }, 'none');
  const spec = fleetSpec(effectiveBatteries(s));
  // an external model's recorded setpoints are only meaningful on the battery they were recorded for (the 2 MWh / 500 kW challenge unit)
  const ext = s.modelId !== DEFAULT_MODEL && s.modelId !== 'none' ? actual.mpc.sp : undefined;
  const override = ext && spec && spec.capacityKwh === CHALLENGE_SPEC.capacityKwh && spec.powerKw === CHALLENGE_SPEC.powerKw && Math.abs(spec.eta - CHALLENGE_SPEC.eta) < 1e-9 ? ext : undefined;
  const mpc = spec ? simulateWeek(input, spec, 'mpc', { override }) : null;
  const template = spec ? simulateWeek(input, spec, 'template') : null;
  const chosen = (s.agent === 'mpc' ? mpc : s.agent === 'template' ? template : none) ?? none;
  // the real campus for the same week: measured PV of the as-built plant, the as-built battery under the MPC agent
  const realSim = simulateWeek({ ...input, pv: week.pv }, CHALLENGE_SPEC, 'mpc', { override: ext }).metrics;
  const chosenM = chosen.metrics;
  derived.current = {
    totals: {
      real: { co2Kg: realSim.co2Agent, costEur: realSim.costAgent },
      chosen: { co2Kg: chosenM.co2Agent, costEur: chosenM.costAgent },
    },
    week,
    actual,
    nowH,
    startMs,
    pvTot,
    shares,
    sims: { mpc, template, none },
    chosen,
    summary: {
      mpc: summarize(mpc ?? none),
      template: summarize(template ?? none),
      none: summarize(none),
    },
  };
  set({ version: get().version + 1, snap: snapshotAt(get(), get().tMin) });
}

/** Instantaneous campus state at sim-minute t of the current week. */
function snapshotAt(s: SimStore, tMin: number): Snapshot | null {
  const d = derived.current;
  const campus = s.campus;
  if (!d || !campus) return null;
  const h = Math.min(HOURS - 1, Math.floor(tMin / 60));
  const f = tMin / 60 - h;
  const r = d.chosen;
  const loadKw = d.week.load[h];
  const solarKw = d.pvTot[h];
  const battKw = r.sp[h];
  const spec = fleetSpec(effectiveBatteries(s));
  const cap = spec?.capacityKwh ?? 0;
  const soc = r === d.sims.none ? 0.5 * cap : r.socStart[h] + (r.socEnd[h] - r.socStart[h]) * f;

  const perB: Snapshot['perB'] = {};
  const yieldKw = d.week.pv[h] / PV_ASBUILT_KWP;
  campus.features.forEach((feat: BuildingFeature, i) => {
    const p = feat.properties;
    perB[p.osmId] = {
      loadKw: d.shares[i * HOURS + h] * loadKw,
      solarKw: buildingSolarKw(p, roofCfg(s, p.osmId), s.panelModel, yieldKw) * pvFactor(s, p),
    };
  });

  const co2Kg = r.cumCo2[h] + (r.cumCo2[h + 1] - r.cumCo2[h]) * f;
  const baseCo2Kg = r.cumBaseCo2[h] + (r.cumBaseCo2[h + 1] - r.cumBaseCo2[h]) * f;
  const costEur = r.cumCost[h] + (r.cumCost[h + 1] - r.cumCost[h]) * f;
  const baseCostEur = r.cumBaseCost[h] + (r.cumBaseCost[h + 1] - r.cumBaseCost[h]) * f;
  const dCo2Pct = baseCo2Kg > 0 ? (100 * (baseCo2Kg - co2Kg)) / baseCo2Kg : 0;
  const dCostPct = baseCostEur > 0 ? (100 * (baseCostEur - costEur)) / baseCostEur : 0;
  const clockMs = weekMsAt(d.week.ms, tMin);
  const sunMs = s.sunLock == null ? clockMs : Math.floor(clockMs / 86_400_000) * 86_400_000 + s.sunLock * 3_600_000;
  const sun = sunAt(sunMs);
  const trueSun = sunAt(clockMs);
  const irr = d.week.irr[h] + (d.week.irr[Math.min(HOURS - 1, h + 1)] - d.week.irr[h]) * f;
  const clear = 1050 * Math.pow(Math.max(0, Math.sin((trueSun.elev * Math.PI) / 180)), 1.15);
  const cloud = trueSun.elev > 4 ? Math.min(1, Math.max(0, 1 - irr / Math.max(clear, 1))) : 0.25;

  return {
    tMin,
    hour: h,
    forecast: d.nowH != null && h >= d.nowH,
    loadKw,
    solarKw,
    gridKw: r.grid[h],
    baseGridKw: r.baseGrid[h],
    battKw,
    soc: cap > 0 ? soc / cap : 0,
    capacityKwh: cap,
    ratedKw: spec?.powerKw ?? 0,
    price: d.week.price[h],
    co2: d.week.co2[h],
    perB,
    costEur,
    co2Kg,
    baseCostEur,
    baseCo2Kg,
    scoreSoFar: Math.max(0, 0.7 * dCo2Pct + 0.3 * dCostPct),
    dCo2Pct,
    dCostPct,
    reason: r.reasons[h],
    sunElev: sun.elev,
    sunAz: sun.az,
    tempC: d.week.temp[h],
    irr,
    cloud,
  };
}

/** working units, with their capacity reduced to the state of health when ageing is on */
export function effectiveBatteries(s: Pick<SimStore, 'batteries' | 'faults' | 'ageing'>): BatteryUnit[] {
  const w = workingBatteries(s);
  return s.ageing ? w.map((u) => ({ ...u, capacity: u.capacity * batterySoh(u.year ?? THIS_YEAR) })) : w;
}

/** PV output factor from module ageing (1 when ageing is off) */
function pvFactor(s: Pick<SimStore, 'ageing'>, p: BuildingFeature['properties']): number {
  return s.ageing ? pvHealth(pvYear(p)) : 1;
}
