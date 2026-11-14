/**
 * Campus physics for the demo, anchored on the REAL data.
 *
 * - Campus load and solar totals come straight from the challenge dataset (public/data/replay.json), so the
 *   numbers on screen are the numbers the model track is scored on.
 * - Per-building values are an illustrative disaggregation: each building gets a share of the real campus load
 *   proportional to area x usage-density x daily shape (normalised so the shares sum to 1 every hour).
 * - Solar per building = installed kWp x tilt factor x real per-kWp yield of the campus plant.
 * - The battery and its agent live in challenge.ts (exact port of sim/ + agent/).
 */
import type { BuildingProps, PanelModelId, SolarCfg } from '../types';
import { PANEL_MODELS } from '../data/catalogue';
import { hash } from '../data/scenario';

// ---------------------------------------------------------------- loads ---

const LOAD_DENSITY: Record<string, number> = {
  teaching: 0.04,
  lab: 0.06,
  research: 0.08,
  data_center: 0.35,
  mixed: 0.05,
  library: 0.025,
  sports: 0.03,
  residence: 0.035,
  aux: 0.02,
};

const SHAPE: Record<string, number[]> = {
  teaching: [0.06, 0.05, 0.05, 0.05, 0.05, 0.08, 0.25, 0.55, 0.8, 0.9, 0.92, 0.85, 0.7, 0.85, 0.88, 0.85, 0.7, 0.45, 0.3, 0.2, 0.14, 0.1, 0.08, 0.06],
  lab: [0.12, 0.1, 0.1, 0.1, 0.1, 0.12, 0.3, 0.55, 0.75, 0.85, 0.9, 0.88, 0.8, 0.88, 0.9, 0.88, 0.82, 0.7, 0.55, 0.4, 0.28, 0.2, 0.16, 0.13],
  research: [0.3, 0.29, 0.28, 0.28, 0.28, 0.3, 0.4, 0.55, 0.7, 0.8, 0.85, 0.85, 0.8, 0.85, 0.85, 0.82, 0.75, 0.62, 0.5, 0.42, 0.38, 0.34, 0.32, 0.31],
  data_center: [0.97, 0.97, 0.96, 0.96, 0.96, 0.97, 0.98, 0.99, 1, 1.01, 1.02, 1.02, 1.01, 1.01, 1, 1, 1, 0.99, 0.99, 0.98, 0.98, 0.97, 0.97, 0.97],
  mixed: [0.1, 0.09, 0.09, 0.08, 0.08, 0.1, 0.3, 0.6, 0.85, 0.95, 0.95, 0.9, 0.78, 0.9, 0.95, 0.92, 0.85, 0.7, 0.5, 0.3, 0.2, 0.16, 0.13, 0.11],
  library: [0.04, 0.04, 0.03, 0.03, 0.03, 0.05, 0.1, 0.25, 0.45, 0.65, 0.75, 0.8, 0.7, 0.8, 0.82, 0.78, 0.7, 0.55, 0.4, 0.3, 0.18, 0.1, 0.06, 0.05],
  sports: [0.05, 0.04, 0.03, 0.03, 0.03, 0.04, 0.08, 0.15, 0.25, 0.35, 0.45, 0.55, 0.6, 0.65, 0.7, 0.75, 0.85, 0.95, 1, 0.9, 0.6, 0.3, 0.15, 0.08],
  residence: [0.55, 0.52, 0.5, 0.5, 0.5, 0.55, 0.65, 0.8, 0.7, 0.55, 0.5, 0.5, 0.55, 0.6, 0.62, 0.65, 0.7, 0.78, 0.88, 0.95, 0.92, 0.82, 0.68, 0.6],
  aux: [0.1, 0.09, 0.09, 0.08, 0.08, 0.1, 0.25, 0.5, 0.8, 0.9, 0.92, 0.88, 0.75, 0.88, 0.92, 0.9, 0.8, 0.6, 0.4, 0.25, 0.18, 0.14, 0.12, 0.1],
};

/** [saturday, sunday] activity factor per category. */
const WEEKEND_SHAPE: Record<string, [number, number]> = {
  teaching: [0.3, 0.22],
  lab: [0.45, 0.35],
  research: [0.7, 0.6],
  data_center: [1, 1],
  mixed: [0.35, 0.28],
  library: [0.55, 0.35],
  sports: [1.05, 0.9],
  residence: [0.96, 0.96],
  aux: [0.4, 0.35],
};

/** Unnormalised raw activity of one building at a given hour (hour-of-day, day-of-week 0=Mon). */
function rawLoad(b: BuildingProps, hourOfDay: number, dow: number, absHour: number): number {
  const arr = SHAPE[b.category] ?? SHAPE.teaching;
  const wk = dow === 5 ? WEEKEND_SHAPE[b.category]?.[0] ?? 1 : dow === 6 ? WEEKEND_SHAPE[b.category]?.[1] ?? 1 : 1;
  const base = b.area_m2 * (LOAD_DENSITY[b.category] ?? 0.03) * b.overdrive;
  const noise =
    (hash(`${b.osmId}h${absHour}`) - 0.5) * 0.14 + (hash(`${b.osmId}d${Math.floor(absHour / 24)}`) - 0.5) * 0.22;
  return Math.max(base * 0.02, base * (arr[hourOfDay] / Math.max(...arr)) * wk * (1 + noise));
}

/** Typical occupancy 0..1 of a building category at a given hour/day (for the "people" layer). */
export function occupancy(cat: string, hourOfDay: number, dow: number): number {
  const arr = SHAPE[cat] ?? SHAPE.teaching;
  const wk = dow === 5 ? WEEKEND_SHAPE[cat]?.[0] ?? 1 : dow === 6 ? WEEKEND_SHAPE[cat]?.[1] ?? 1 : 1;
  const raw = (arr[hourOfDay] / Math.max(...arr)) * wk;
  if (cat === 'data_center') return 0.06; // a handful of operators
  if (cat === 'residence') return Math.min(1, 0.25 + 0.75 * raw);
  // people leave when the load shape's "activity" part falls; offices/classrooms are empty at night
  return Math.min(1, Math.max(0.02, (raw - 0.1) / 0.8));
}

/**
 * Share of the real campus load drawn by each building, for every hour of a week.
 * Layout: shares[b * hours + h]; for each h the shares sum to 1.
 */
export function buildLoadShares(buildings: BuildingProps[], ms: ArrayLike<number>, hours: number): Float64Array {
  const nb = buildings.length;
  const out = new Float64Array(nb * hours);
  for (let h = 0; h < hours; h++) {
    const d = new Date(ms[h]);
    const hod = d.getUTCHours();
    const dow = (d.getUTCDay() + 6) % 7;
    let sum = 0;
    for (let b = 0; b < nb; b++) {
      const v = rawLoad(buildings[b], hod, dow, Math.floor(ms[h] / 3_600_000));
      out[b * hours + h] = v;
      sum += v;
    }
    for (let b = 0; b < nb; b++) out[b * hours + h] /= sum;
  }
  return out;
}

// ---------------------------------------------------------------- solar ---

/** Peak AC output of the real campus PV plant in the dataset (3 inverters, ~144 kW max in the train data). */
export const PV_ASBUILT_KWP = 160;
export const DEFAULT_TILT = 18;
export const DEFAULT_PANEL: PanelModelId = 'mono';

export function panelKwm2(panel: PanelModelId): number {
  return PANEL_MODELS.find((p) => p.id === panel)!.kwm2;
}

/** kWp if 100 % of the usable roof were covered. */
export function roofKwp(b: BuildingProps, panel: PanelModelId): number {
  return b.area_m2 * b.pv_fraction * panelKwm2(panel);
}

/** Roof coverage at which the campus reproduces the real plant (every roof the same coverage). */
export function asBuiltCoverage(buildings: BuildingProps[]): number {
  const area = buildings.reduce((a, b) => a + b.area_m2 * b.pv_fraction, 0);
  return PV_ASBUILT_KWP / Math.max(1, area * panelKwm2(DEFAULT_PANEL));
}

export function tiltFactor(tilt: number): number {
  return Math.max(0.55, 1 - (tilt - DEFAULT_TILT) ** 2 / 2400);
}

/** Installed capacity (kWp) of one building under its config. */
export function installedKwp(b: BuildingProps, cfg: SolarCfg, panel: PanelModelId): number {
  return cfg.on ? roofKwp(b, panel) * cfg.fraction : 0;
}

/** Output (kW) of one building for a real campus-plant yield (kW per kWp). */
export function buildingSolarKw(b: BuildingProps, cfg: SolarCfg, panel: PanelModelId, yieldKwPerKwp: number): number {
  return installedKwp(b, cfg, panel) * tiltFactor(cfg.tilt) * yieldKwPerKwp;
}

// ---------------------------------------------------------- battery fleet ---

import type { BatterySpec } from './challenge';
import type { BatteryUnit } from '../types';
import { BATTERY_MODELS } from '../data/catalogue';

export function modelOf(unit: BatteryUnit) {
  return BATTERY_MODELS.find((m) => m.id === unit.modelId)!;
}

/** The installed units behave as ONE battery for the dispatcher: summed energy / power, capacity-weighted RTE. */
export function fleetSpec(units: BatteryUnit[]): BatterySpec | null {
  if (units.length === 0) return null;
  const cap = units.reduce((a, u) => a + u.capacity, 0);
  const power = units.reduce((a, u) => a + u.power, 0);
  const rte = units.reduce((a, u) => a + (modelOf(u).rte / 100) * u.capacity, 0) / cap;
  return { capacityKwh: cap * 1000, powerKw: power * 1000, eta: Math.sqrt(rte) };
}
