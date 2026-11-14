/**
 * Heavy, pure, synchronous re-runs of the challenge-exact agent (no DOM): used inside a Web Worker so the 3D
 * scene never stutters, and as a main-thread fallback. Deterministic.
 */
import type { ReplayWeek } from '../types';
import { CHALLENGE_SPEC, simulateWeek, type BatterySpec, type MpcOptions, type SimResult, type WeekInput } from './challenge';

export const toInput = (w: ReplayWeek): WeekInput => ({ start: w.start, ms: w.ms, load: w.load, pv: w.pv, price: w.price, co2: w.co2 });

export const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

/** Representative weeks (spread over the year) used by the sweeps so each stays a few seconds. */
export const SWEEP_WEEKS = [1, 6, 11, 17, 22, 28, 33];

export type JobKind = 'action' | 'horizon' | 'weight' | 'size';
export type Progress = (done: number, total: number) => void;

export interface HourStats {
  /** mean battery setpoint by hour of day, kW (+ charge) */
  sp: number[];
  /** mean state of charge by hour of day, % */
  soc: number[];
  /** % of hours with a charge / discharge action */
  charge: number[];
  discharge: number[];
}
export interface ActionByHour {
  mpc: HourStats;
  template: HourStats;
}
export interface SweepPoint {
  x: number;
  score: number;
  dCo2: number;
  dCost: number;
  viol: number;
}

function foldAction(weeks: ReplayWeek[], sims: SimResult[], spec: BatterySpec): HourStats {
  const sp = Array.from({ length: 24 }, () => [] as number[]);
  const soc = Array.from({ length: 24 }, () => [] as number[]);
  weeks.forEach((w, k) => {
    for (let i = 0; i < w.ms.length; i++) {
      const h = new Date(w.ms[i]).getUTCHours();
      sp[h].push(sims[k].sp[i]);
      soc[h].push((100 * sims[k].socStart[i]) / spec.capacityKwh);
    }
  });
  return {
    sp: sp.map(mean),
    soc: soc.map(mean),
    charge: sp.map((a) => (100 * a.filter((v) => v > 5).length) / Math.max(a.length, 1)),
    discharge: sp.map((a) => (100 * a.filter((v) => v < -5).length) / Math.max(a.length, 1)),
  };
}

/** What the real agent and the template do at each hour of the day, over all weeks. */
export function computeAction(weeks: ReplayWeek[], onProgress?: Progress): ActionByHour {
  const total = weeks.length * 2;
  let done = 0;
  const run = (kind: 'mpc' | 'template') =>
    weeks.map((w) => {
      const r = simulateWeek(toInput(w), CHALLENGE_SPEC, kind);
      onProgress?.(++done, total);
      return r;
    });
  const mpc = run('mpc');
  const template = run('template');
  return { mpc: foldAction(weeks, mpc, CHALLENGE_SPEC), template: foldAction(weeks, template, CHALLENGE_SPEC) };
}

const sizeSpec = (m: number): BatterySpec => ({ capacityKwh: CHALLENGE_SPEC.capacityKwh * m, powerKw: CHALLENGE_SPEC.powerKw * m, eta: CHALLENGE_SPEC.eta });

const SWEEPS: Record<Exclude<JobKind, 'action'>, { xs: number[]; make: (x: number) => { spec: BatterySpec; opts: MpcOptions } }> = {
  /** hours of price/CO2 look-ahead (the challenge provides 24) */
  horizon: { xs: [1, 3, 6, 12, 24, 48], make: (h) => ({ spec: CHALLENGE_SPEC, opts: { horizon: h } }) },
  /** CO2 share in the optimiser (cost share = 1 - x) */
  weight: { xs: [0, 0.25, 0.5, 0.7, 0.85, 1], make: (a) => ({ spec: CHALLENGE_SPEC, opts: { alphaCo2: a, betaCost: 1 - a } }) },
  /** battery size multiplier (power scales with energy: same 0.25 C as the challenge pack) */
  size: { xs: [0.5, 1, 2, 3, 4], make: (m) => ({ spec: sizeSpec(m), opts: {} }) },
};

export function computeSweep(kind: Exclude<JobKind, 'action'>, weeks: ReplayWeek[], onProgress?: Progress): SweepPoint[] {
  const { xs, make } = SWEEPS[kind];
  const wk = SWEEP_WEEKS.filter((i) => i < weeks.length).map((i) => weeks[i]);
  const total = xs.length * wk.length;
  let done = 0;
  return xs.map((x) => {
    const { spec, opts } = make(x);
    const part = wk.map((w) => {
      const m = simulateWeek(toInput(w), spec, 'mpc', opts).metrics;
      onProgress?.(++done, total);
      return m;
    });
    return { x, score: mean(part.map((m) => m.score)), dCo2: mean(part.map((m) => m.dCo2Pct)), dCost: mean(part.map((m) => m.dCostPct)), viol: part.reduce((a, m) => a + m.violations, 0) };
  });
}

export function computeJob(kind: JobKind, weeks: ReplayWeek[], onProgress?: Progress): ActionByHour | SweepPoint[] {
  return kind === 'action' ? computeAction(weeks, onProgress) : computeSweep(kind, weeks, onProgress);
}
