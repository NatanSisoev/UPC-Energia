/** Shared types for the UPC Energia demo. */
import type { AgentKind, Reason } from './sim/challenge';

export type Category =
  | 'teaching'
  | 'lab'
  | 'research'
  | 'data_center'
  | 'mixed'
  | 'library'
  | 'sports'
  | 'residence'
  | 'aux';

/** Properties baked by scripts/build-campus-data.mjs into public/data/campus.json */
export interface BuildingProps {
  osmId: string;
  name: string;
  short: string;
  school: string;
  category: Category;
  levels?: number;
  area_m2: number;
  height_m: number;
  overdrive: number;
  pv_fraction: number;
  centroid: [number, number];
}

export interface BuildingFeature {
  type: 'Feature';
  geometry: {
    type: 'Polygon' | 'MultiPolygon';
    coordinates: number[][][] | number[][][][];
  };
  properties: BuildingProps;
}

export interface CampusData {
  type: 'FeatureCollection';
  attribution: string;
  bbox: [number, number, number, number];
  substation: [number, number];
  batterySite: [number, number];
  features: BuildingFeature[];
}

export interface GroundData {
  roads: Array<{ c: string; w: number; p: [number, number][] }>;
  greens: Array<{ k: string; p: [number, number][] }>;
  context: Array<{ p: [number, number][]; h: number }>;
  /** covered area (wider than the campus when built from the wide OSM extract) */
  bbox?: [number, number, number, number];
  water?: Array<{ p: [number, number][] }>;
}

export interface ReplayWeek {
  start: string;
  ms: number[];
  load: number[];
  pv: number[];
  price: number[];
  co2: number[];
  irr: number[];
  temp: number[];
  mpc: { score: number; dco2: number; dcost: number; viol: number; sp?: number[] };
  template: { score: number; dco2: number; dcost: number; viol: number };
}

export type PanelModelId = 'mono' | 'hjt' | 'tandem';

/** Per-roof solar configuration owned by the store. */
export interface SolarCfg {
  on: boolean;
  /** 0..1 share of the usable roof covered with panels */
  fraction: number;
  /** panel tilt in degrees */
  tilt: number;
  /** module technology installed on this roof; falls back to the campus-wide `panelModel` when unset */
  model?: PanelModelId;
}

export interface BatteryUnit {
  id: string;
  modelId: string;
  /** MWh */
  capacity: number;
  /** MW */
  power: number;
  /** commissioning year (drives the ageing / state of health) */
  year?: number;
  /** part of the real campus (not added in a simulation) */
  asBuilt?: boolean;
}

export type { AgentKind, Reason };

export interface BuildingPoint {
  loadKw: number;
  solarKw: number;
}

/** One instantaneous campus state (all derived from the challenge-exact simulation). */
export interface Snapshot {
  tMin: number;
  hour: number;
  /** true when this hour is after "now" (values are forecast, not measured) */
  forecast: boolean;
  loadKw: number;
  solarKw: number;
  /** import (+) / export (-) AFTER the battery */
  gridKw: number;
  /** import (+) / export (-) WITHOUT a battery */
  baseGridKw: number;
  /** battery setpoint, + = charging */
  battKw: number;
  /** 0..1 */
  soc: number;
  capacityKwh: number;
  ratedKw: number;
  /** EUR/kWh */
  price: number;
  /** kg CO2/kWh */
  co2: number;
  perB: Record<string, BuildingPoint>;
  /** cumulative since the start of the week */
  costEur: number;
  co2Kg: number;
  baseCostEur: number;
  baseCo2Kg: number;
  /** challenge score "so far" (percent units) */
  scoreSoFar: number;
  dCo2Pct: number;
  dCostPct: number;
  reason: Reason;
  /** sun elevation in degrees (negative = night) */
  sunElev: number;
  sunAz: number;
  /** campus weather station: ambient temperature C, irradiance W/m2, cloudiness 0..1 (derived) */
  tempC: number;
  irr: number;
  cloud: number;
}

export interface WeekSummary {
  score: number;
  dCo2Pct: number;
  dCostPct: number;
  violations: number;
  co2SavedKg: number;
  costSavedEur: number;
}

export interface ChartRow {
  h: number;
  label: string;
  load: number;
  solar: number;
  grid: number;
  baseGrid: number;
  soc: number;
  batt: number;
  price: number;
  co2: number;
}

export type LayerId = 'heat' | 'glow' | 'sun' | 'assets' | 'people' | 'weather' | 'solar' | 'cables' | 'trees' | 'shadows' | 'labels';
