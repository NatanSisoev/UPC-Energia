/**
 * Data-insight computations over the REAL replay weeks (replay.json). Everything here is deterministic and
 * either a plain aggregate of the telemetry or a re-run of the challenge-exact agent in challenge.ts
 * (same physics, same score) with a changed look-ahead / weight / battery size.
 */
import type { ReplayWeek } from '../types';
import { computeJob, mean, type ActionByHour, type JobKind, type Progress, type SweepPoint } from './sweeps.core';
import SweepWorker from './sweeps.worker?worker';

export { SWEEP_WEEKS, toInput } from './sweeps.core';
export type { ActionByHour, SweepPoint };


const SEASONS = ['winter', 'spring', 'summer', 'autumn'] as const;
export type Season = (typeof SEASONS)[number];
/** month 0..11 -> season (Dec-Feb winter, Mar-May spring, ...) */
const seasonOf = (month: number): Season => SEASONS[Math.floor(((month + 1) % 12) / 3)];

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  return sorted[lo] + (sorted[Math.min(lo + 1, sorted.length - 1)] - sorted[lo]) * (i - lo);
}

export interface Profiles {
  hours: number[];
  price: { mean: number[]; p10: number[]; p90: number[] };
  co2: { mean: number[]; p10: number[]; p90: number[] };
  /** mean campus load in kW by hour of day */
  load: { weekday: number[]; saturday: number[]; sunday: number[] };
  /** mean PV output in kW by hour of day and season */
  pv: Record<Season, number[]>;
  /** mean daily energy per weekday (Mon..Sun), MWh */
  weekdayMwh: number[];
  totals: { loadMwh: number; pvMwh: number; surplusHoursPct: number; peakPvKw: number; peakLoadKw: number; meanLoadKw: number };
}

/** Hour-of-day / weekday / season aggregates of the telemetry (local wall clock via the per-row ms). */
export function buildProfiles(weeks: ReplayWeek[]): Profiles {
  const by = <T,>(f: () => T) => Array.from({ length: 24 }, f);
  const price = by<number[]>(() => []);
  const co2 = by<number[]>(() => []);
  const load = { weekday: by<number[]>(() => []), saturday: by<number[]>(() => []), sunday: by<number[]>(() => []) };
  const pv: Record<Season, number[][]> = { winter: by<number[]>(() => []), spring: by<number[]>(() => []), summer: by<number[]>(() => []), autumn: by<number[]>(() => []) };
  const dayKwh: number[][] = Array.from({ length: 7 }, () => []);
  const dayAcc = new Map<string, { dow: number; kwh: number; n: number }>();
  let loadSum = 0;
  let pvSum = 0;
  let surplus = 0;
  let rows = 0;
  let peakPv = 0;
  let peakLoad = 0;
  for (const w of weeks) {
    for (let i = 0; i < w.ms.length; i++) {
      const d = new Date(w.ms[i]);
      const h = d.getUTCHours();
      const dow = (d.getUTCDay() + 6) % 7;
      price[h].push(w.price[i]);
      co2[h].push(w.co2[i]);
      (dow === 5 ? load.saturday : dow === 6 ? load.sunday : load.weekday)[h].push(w.load[i]);
      pv[seasonOf(d.getUTCMonth())][h].push(w.pv[i]);
      const key = `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
      const a = dayAcc.get(key) ?? { dow, kwh: 0, n: 0 };
      a.kwh += w.load[i];
      a.n += 1;
      dayAcc.set(key, a);
      loadSum += w.load[i];
      pvSum += w.pv[i];
      if (w.pv[i] > w.load[i]) surplus++;
      peakPv = Math.max(peakPv, w.pv[i]);
      peakLoad = Math.max(peakLoad, w.load[i]);
      rows++;
    }
  }
  for (const a of dayAcc.values()) if (a.n === 24) dayKwh[a.dow].push(a.kwh / 1000);
  const q = (arrs: number[][], p: number) => arrs.map((a) => quantile([...a].sort((x, y) => x - y), p));
  return {
    hours: Array.from({ length: 24 }, (_, h) => h),
    price: { mean: price.map(mean), p10: q(price, 0.1), p90: q(price, 0.9) },
    co2: { mean: co2.map(mean), p10: q(co2, 0.1), p90: q(co2, 0.9) },
    load: { weekday: load.weekday.map(mean), saturday: load.saturday.map(mean), sunday: load.sunday.map(mean) },
    pv: { winter: pv.winter.map(mean), spring: pv.spring.map(mean), summer: pv.summer.map(mean), autumn: pv.autumn.map(mean) },
    weekdayMwh: dayKwh.map(mean),
    totals: { loadMwh: loadSum / 1000, pvMwh: pvSum / 1000, surplusHoursPct: (100 * surplus) / Math.max(rows, 1), peakPvKw: peakPv, peakLoadKw: peakLoad, meanLoadKw: loadSum / Math.max(rows, 1) },
  };
}
/* ------------------------------------------------------- heavy runs (worker) --- */

let worker: Worker | null = null;
let seq = 0;
const waiting = new Map<number, { resolve: (v: unknown) => void; kind: JobKind }>();
/** every caller interested in a job's progress (late callers share the running job) */
const listeners = new Map<JobKind, Set<Progress>>();

function getWorker(): Worker | null {
  if (worker) return worker;
  try {
    worker = new SweepWorker();
    worker.onmessage = (e: MessageEvent<{ id: number; type: string; done?: number; total?: number; result?: unknown }>) => {
      const w = waiting.get(e.data.id);
      if (!w) return;
      if (e.data.type === 'progress') listeners.get(w.kind)?.forEach((f) => f(e.data.done ?? 0, e.data.total ?? 1));
      else {
        waiting.delete(e.data.id);
        w.resolve(e.data.result);
      }
    };
    worker.onerror = () => {
      worker = null; // fall back to the main thread for later jobs
    };
  } catch {
    worker = null;
  }
  return worker;
}

const memo = new Map<string, Promise<unknown>>();

/** Run a sweep once per kind (shared promise), off the main thread when a Worker is available. */
function job<T>(kind: JobKind, weeks: ReplayWeek[], onProgress?: Progress): Promise<T> {
  if (onProgress) (listeners.get(kind) ?? listeners.set(kind, new Set()).get(kind)!).add(onProgress);
  let p = memo.get(kind) as Promise<T> | undefined;
  if (!p) {
    p = new Promise<T>((resolve) => {
      const w = getWorker();
      if (w) {
        const id = ++seq;
        waiting.set(id, { resolve: resolve as (v: unknown) => void, kind });
        w.postMessage({ id, kind, weeks });
      } else {
        setTimeout(() => resolve(computeJob(kind, weeks, (d, t) => listeners.get(kind)?.forEach((f) => f(d, t))) as T), 0);
      }
    });
    memo.set(kind, p);
  }
  return p;
}

/** What the real agent and the template do at each hour of the day, over all weeks. */
export const actionByHour = (weeks: ReplayWeek[], onProgress?: Progress) => job<ActionByHour>('action', weeks, onProgress);
/** Score vs hours of price/CO2 look-ahead (the challenge provides 24). */
export const horizonSweep = (weeks: ReplayWeek[], onProgress?: Progress) => job<SweepPoint[]>('horizon', weeks, onProgress);
/** CO2-vs-cost weight inside the optimiser (x = CO2 share). */
export const weightSweep = (weeks: ReplayWeek[], onProgress?: Progress) => job<SweepPoint[]>('weight', weeks, onProgress);
/** Score vs battery size (power scales with energy). */
export const sizeSweep = (weeks: ReplayWeek[], onProgress?: Progress) => job<SweepPoint[]>('size', weeks, onProgress);

/** Start every sweep in the background (idle time before the pitch / first Insights visit). */
export function warmInsights(weeks: ReplayWeek[]): void {
  void actionByHour(weeks);
  void horizonSweep(weeks);
  void weightSweep(weeks);
  void sizeSweep(weeks);
}
