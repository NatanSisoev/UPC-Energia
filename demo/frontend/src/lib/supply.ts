/**
 * Where the campus electricity comes from, hour by hour: own solar, the battery (discharging) or the public grid.
 * Solar is used first, then the battery's discharge, the rest is imported. Energy the grid sends INTO the
 * battery (charging) is not counted as building supply. Buildings share the campus mix in proportion to their
 * demand (one meter for the whole campus).
 */
import { derived } from '../store/useSim';

/** fixed source colours, shared with the cables on the map */
export const SOURCE = {
  grid: { label: 'Grid', long: 'Public grid', color: 'rgb(236,118,56)' },
  battery: { label: 'Battery', long: 'Campus battery', color: 'rgb(16,170,170)' },
  solar: { label: 'Solar', long: 'Rooftop solar', color: 'rgb(245,165,36)' },
} as const;
export type Source = keyof typeof SOURCE;

export interface Mix {
  /** kW delivered to the buildings by each source */
  grid: number;
  battery: number;
  solar: number;
  load: number;
}

/** supply mix of the campus at hour h */
export function mixAt(h: number): Mix {
  const d = derived.current;
  if (!d) return { grid: 0, battery: 0, solar: 0, load: 0 };
  const load = d.week.load[h];
  const solar = Math.min(d.pvTot[h], load);
  // battery discharge reaching the buildings = the grid import it avoided
  const battery = d.chosen.sp[h] < -1e-6 ? Math.max(0, Math.min(load - solar, Math.max(0, d.chosen.baseGrid[h]) - Math.max(0, d.chosen.grid[h]))) : 0;
  return { grid: Math.max(0, load - solar - battery), battery, solar, load };
}

let cache: { key: unknown; mixes: Mix[] } = { key: null, mixes: [] };
/** the whole week's mix (cached per derived object) */
export function weekMix(): Mix[] {
  const d = derived.current;
  if (!d) return [];
  if (cache.key !== d) cache = { key: d, mixes: Array.from({ length: d.week.load.length }, (_, h) => mixAt(h)) };
  return cache.mixes;
}

/** shares 0..1 of each source in a mix */
export const shares = (m: Mix) => {
  const t = Math.max(1e-9, m.grid + m.battery + m.solar);
  return { grid: m.grid / t, battery: m.battery / t, solar: m.solar / t };
};
