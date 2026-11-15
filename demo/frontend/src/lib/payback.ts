/**
 * Annual saving and payback of each catalogue item, from the app's own simulator and the replayed campus weeks.
 *  - Battery: the item alone (as the only battery) runs the MPC agent on every replay week; saving = cost saved vs
 *    no battery + CO2 saved valued at CO2_EUR_PER_KG.
 *  - Solar panel: the full usable roof (MAX_COVERAGE) is fitted with that technology on top of the existing plant;
 *    saving = grid cost avoided (price x imported energy) + CO2 avoided, both from the no-battery baseline.
 * Weekly figures are scaled to a year with 52 / (number of weeks replayed): an extrapolation, stated on the page.
 * Prices come from data/catalogue.ts (battery priceEur, panel eurPerKw): indicative, not quotes.
 */
import { BATTERY_MODELS, PANEL_MODELS } from '../data/catalogue';
import { simulateWeek, type BatterySpec, type WeekInput } from '../sim/challenge';
import { PV_ASBUILT_KWP, roofKwp, tiltFactor, DEFAULT_TILT } from '../sim/engine';
import { SWEEP_WEEKS } from '../sim/sweeps.core';
import type { BuildingProps, ReplayWeek } from '../types';

/** Assumption: value of one kg of CO2 avoided, EUR (about 80 EUR/t, the order of magnitude of the EU ETS price). */
export const CO2_EUR_PER_KG = 0.08;
export const MAX_COVERAGE = 0.6;
/** Typical service life used for the verdict, years. */
export const LIFETIME_YEARS = { battery: 15, solar: 25 };

export interface ItemEconomics {
  priceEur: number;
  annualSavingEur: number;
  /** years to pay back; Infinity when the item saves nothing */
  paybackYears: number;
  pays: boolean;
}

export interface Economics {
  weeks: number;
  /** weeks available in the replay */
  of: number;
  battery: Record<string, ItemEconomics>;
  solar: Record<string, ItemEconomics & { kwp: number }>;
}

/** Payback years = investment / annual saving; Infinity when nothing is saved. Shared by the catalogue and the simulated pane. */
export const paybackYearsOf = (priceEur: number, annualSavingEur: number) => (annualSavingEur > 0 ? priceEur / annualSavingEur : Infinity);
/** One week's saving scaled to a year (the same 52-weeks extrapolation as computeEconomics). */
export const WEEKS_PER_YEAR = 52;

const make = (priceEur: number, saving: number, life: number): ItemEconomics => {
  const paybackYears = paybackYearsOf(priceEur, saving);
  return { priceEur, annualSavingEur: saving, paybackYears, pays: paybackYears <= life };
};

const tick = () => new Promise<void>((r) => setTimeout(r, 0));
let cache: Economics | null = null;

/**
 * Runs on SWEEP_WEEKS (7 representative weeks spread over the year: the full 35 weeks take ~40 s of MPC runs) and
 * yields to the browser between items so the page stays responsive. The result is cached for the session.
 */
export async function computeEconomics(all: ReplayWeek[], roofs: BuildingProps[]): Promise<Economics> {
  if (cache) return cache;
  const weeks = SWEEP_WEEKS.filter((i) => i < all.length).map((i) => all[i]);
  const scale = 52 / Math.max(1, weeks.length);
  const input = (w: ReplayWeek, extraPv?: number[]): WeekInput => ({
    start: w.start,
    ms: w.ms,
    load: w.load,
    pv: extraPv ? w.pv.map((v, h) => v + extraPv[h]) : w.pv,
    price: w.price,
    co2: w.co2,
  });
  const none: BatterySpec = { capacityKwh: 1, powerKw: 0, eta: 1 };

  const battery: Economics['battery'] = {};
  for (const m of BATTERY_MODELS) {
    await tick();
    const spec: BatterySpec = { capacityKwh: m.capacity * 1000, powerKw: m.power * 1000, eta: Math.sqrt(m.rte / 100) };
    let eur = 0;
    for (const w of weeks) {
      const x = simulateWeek(input(w), spec, 'mpc').metrics;
      eur += x.costBase - x.costAgent + (x.co2Base - x.co2Agent) * CO2_EUR_PER_KG;
    }
    battery[m.id] = make(m.priceEur, eur * scale, LIFETIME_YEARS.battery);
  }

  const solar: Economics['solar'] = {};
  for (const m of PANEL_MODELS) {
    await tick();
    const kwp = roofs.reduce((a, p) => a + roofKwp(p, m.id), 0) * MAX_COVERAGE;
    let eur = 0;
    for (const w of weeks) {
      const base = simulateWeek(input(w), none, 'none');
      const extra = simulateWeek(input(w, w.pv.map((v) => (v / PV_ASBUILT_KWP) * kwp * tiltFactor(DEFAULT_TILT))), none, 'none');
      eur += base.cumBaseCost[base.n] - extra.cumBaseCost[extra.n] + (base.cumBaseCo2[base.n] - extra.cumBaseCo2[extra.n]) * CO2_EUR_PER_KG;
    }
    solar[m.id] = { ...make(m.eurPerKw * kwp, eur * scale, LIFETIME_YEARS.solar), kwp };
  }
  cache = { weeks: weeks.length, of: all.length, battery, solar };
  return cache;
}
