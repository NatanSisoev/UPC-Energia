/**
 * Live simulation state. The playback clock walks through one REAL campus week (public/data/replay.json);
 * everything shown is derived from challenge.ts (exact port of sim/ + the MPC agent), so the KPIs and the
 * "score" are the contest's numbers. Heavy arrays live in `derived` (outside React state); the store only
 * carries a `version` counter so components know when to re-read them.
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
import { BATTERY_MODELS } from '../data/catalogue';
import {
  buildLoadShares,
  buildingSolarKw,
  PV_ASBUILT_KWP,
  asBuiltCoverage,
  DEFAULT_TILT,
  fleetSpec,
} from '../sim/engine';
import { simulateWeek, type SimResult, type WeekInput } from '../sim/challenge';
import { sunAt } from '../lib/sun';

const HOURS = 168;

/** Heavy derived data for the current week + configuration. */
export interface Derived {
  week: ReplayWeek;
  startMs: number;
  pvTot: Float64Array;
  shares: Float64Array;
  sims: { mpc: SimResult | null; template: SimResult | null; none: SimResult };
  chosen: SimResult;
  summary: Record<'mpc' | 'template' | 'none', WeekSummary>;
}

export const derived: { current: Derived | null } = { current: null };

interface SimStore {
  campus: CampusData | null;
  ground: GroundData | null;
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

  snap: Snapshot | null;
  /** bumped when week / solar / battery / agent change (components re-read `derived`) */
  version: number;

  load: () => Promise<void>;
  tick: (dtSec: number) => void;
  setPlaying: (v: boolean) => void;
  setSpeed: (v: number) => void;
  setTMin: (v: number) => void;
  setWeek: (i: number) => void;
  setAgent: (a: AgentKind) => void;
  setUnderground: (v: boolean) => void;
  toggleLayer: (id: LayerId) => void;
  setSunLock: (h: number | null) => void;
  select: (id: string | null) => void;
  setPanelModel: (id: PanelModelId) => void;
  setSolar: (id: string, patch: Partial<SolarCfg>) => void;
  solarPreset: (preset: 'off' | 'asbuilt' | 'max') => void;
  installBattery: (modelId: string) => void;
  updateBattery: (id: string, patch: Partial<BatteryUnit>) => void;
  removeBattery: (id: string) => void;
}

let unitSeq = 0;
const unit = (modelId: string): BatteryUnit => {
  const m = BATTERY_MODELS.find((x) => x.id === modelId)!;
  return { id: `b${unitSeq++}`, modelId, capacity: m.capacity, power: m.power };
};

export const useSim = create<SimStore>((set, get) => ({
  campus: null,
  ground: null,
  replay: null,
  loadError: null,
  weekIdx: 17, // a spring week with a nice price/CO2 spread
  tMin: 11 * 60,
  playing: true,
  speed: 60,
  panelModel: 'mono',
  solar: {},
  batteries: [unit('challenge')],
  agent: 'mpc',
  selection: null,
  underground: false,
  layers: { heat: false, people: false, weather: true, solar: true, cables: true, trees: true, shadows: true, labels: true },
  sunLock: null,
  snap: null,
  version: 0,

  load: async () => {
    try {
      const [c, g, r] = await Promise.all([
        fetch('/data/campus.json').then((x) => x.json()),
        fetch('/data/ground.json').then((x) => x.json()),
        fetch('/data/replay.json').then((x) => x.json()),
      ]);
      const campus = c as CampusData;
      const cov = asBuiltCoverage(campus.features.map((f) => f.properties));
      const solar: Record<string, SolarCfg> = {};
      for (const f of campus.features) {
        const has = f.properties.pv_fraction > 0;
        solar[f.properties.osmId] = { on: has, fraction: has ? cov : 0, tilt: DEFAULT_TILT };
      }
      set({ campus, ground: g as GroundData, replay: (r as { weeks: ReplayWeek[] }).weeks, solar });
      recompute(set, get);
    } catch (e) {
      set({ loadError: String(e) });
    }
  },

  tick: (dtSec) => {
    const s = get();
    if (!s.campus || !derived.current) return;
    if (!s.playing) return;
    let t = s.tMin + dtSec * s.speed;
    if (t >= HOURS * 60) t -= HOURS * 60;
    set({ tMin: t, snap: snapshotAt(get(), t) });
  },

  setPlaying: (v) => set({ playing: v }),
  setSpeed: (v) => set({ speed: v }),
  setTMin: (t) => set({ tMin: t, snap: derived.current ? snapshotAt(get(), t) : null }),
  setWeek: (i) => {
    set({ weekIdx: i, tMin: 0 });
    recompute(set, get);
  },
  setAgent: (a) => {
    set({ agent: a });
    recompute(set, get);
  },
  setUnderground: (v) => set({ underground: v }),
  toggleLayer: (id) => set((s) => ({ layers: { ...s.layers, [id]: !s.layers[id] } })),
  setSunLock: (h) => {
    set({ sunLock: h });
    set({ snap: derived.current ? snapshotAt(get(), get().tMin) : null });
  },
  select: (id) => set({ selection: id }),
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
    set((s) => ({ batteries: s.batteries.filter((b) => b.id !== id) }));
    recompute(set, get);
  },
}));

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

/** Re-run the three simulations (agent, template, no battery) for the current week + configuration. */
function recompute(set: Setter, get: () => SimStore): void {
  const s = get();
  if (!s.campus || !s.replay) return;
  const week = s.replay[s.weekIdx];
  const startMs = Date.UTC(
    +week.start.slice(0, 4),
    +week.start.slice(5, 7) - 1,
    +week.start.slice(8, 10),
    +week.start.slice(11, 13),
  );
  const props = s.campus.features.map((f) => f.properties);
  const key = `${s.weekIdx}`;
  let shares = shareCache.get(key);
  if (!shares) {
    shares = buildLoadShares(props, startMs, HOURS);
    shareCache.set(key, shares);
  }
  const pvTot = new Float64Array(HOURS);
  for (let h = 0; h < HOURS; h++) {
    const yieldKw = week.pv[h] / PV_ASBUILT_KWP;
    let t = 0;
    for (const p of props) t += buildingSolarKw(p, s.solar[p.osmId] ?? { on: false, fraction: 0, tilt: DEFAULT_TILT }, s.panelModel, yieldKw);
    pvTot[h] = t;
  }
  const input: WeekInput = { start: week.start, ms: week.ms, load: week.load, pv: pvTot, price: week.price, co2: week.co2 };
  const none = simulateWeek(input, { capacityKwh: 1, powerKw: 0, eta: 1 }, 'none');
  const spec = fleetSpec(s.batteries);
  const mpc = spec ? simulateWeek(input, spec, 'mpc') : null;
  const template = spec ? simulateWeek(input, spec, 'template') : null;
  const chosen = (s.agent === 'mpc' ? mpc : s.agent === 'template' ? template : none) ?? none;
  derived.current = {
    week,
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
  const soc = r === d.sims.none ? 0.5 * (fleetSpec(s.batteries)?.capacityKwh ?? 0) : r.socStart[h] + (r.socEnd[h] - r.socStart[h]) * f;
  const spec = fleetSpec(s.batteries);
  const cap = spec?.capacityKwh ?? 0;

  const perB: Snapshot['perB'] = {};
  const props = campus.features;
  const yieldKw = d.week.pv[h] / PV_ASBUILT_KWP;
  props.forEach((feat: BuildingFeature, i) => {
    const p = feat.properties;
    perB[p.osmId] = {
      loadKw: d.shares[i * HOURS + h] * loadKw,
      solarKw: buildingSolarKw(p, s.solar[p.osmId] ?? { on: false, fraction: 0, tilt: DEFAULT_TILT }, s.panelModel, yieldKw),
    };
  });

  const co2Kg = r.cumCo2[h] + (r.cumCo2[h + 1] - r.cumCo2[h]) * f;
  const baseCo2Kg = r.cumBaseCo2[h] + (r.cumBaseCo2[h + 1] - r.cumBaseCo2[h]) * f;
  const costEur = r.cumCost[h] + (r.cumCost[h + 1] - r.cumCost[h]) * f;
  const baseCostEur = r.cumBaseCost[h] + (r.cumBaseCost[h + 1] - r.cumBaseCost[h]) * f;
  const dCo2Pct = baseCo2Kg > 0 ? (100 * (baseCo2Kg - co2Kg)) / baseCo2Kg : 0;
  const dCostPct = baseCostEur > 0 ? (100 * (baseCostEur - costEur)) / baseCostEur : 0;
  const clockMs = d.startMs + tMin * 60_000;
  const sunMs = s.sunLock == null ? clockMs : Math.floor(clockMs / 86_400_000) * 86_400_000 + s.sunLock * 3_600_000;
  const sun = sunAt(sunMs);
  const trueSun = sunAt(clockMs);
  const irr = d.week.irr[h] + ((d.week.irr[Math.min(HOURS - 1, h + 1)] - d.week.irr[h]) * f);
  const clear = 1050 * Math.pow(Math.max(0, Math.sin((trueSun.elev * Math.PI) / 180)), 1.15);
  const cloud = trueSun.elev > 4 ? Math.min(1, Math.max(0, 1 - irr / Math.max(clear, 1))) : 0.25;

  return {
    tMin,
    hour: h,
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
