/** Live facts for the tour captions. Every number on a card is read from the store / replay data here, never typed. */
import { derived, useSim, type ModelInfo } from '../store/useSim';
import { computeAlarms } from '../lib/alarms';
import { cachedEconomics } from '../lib/payback';
import { fmtEur, fmtKw } from '../lib/format';
import { bigRoof } from './actions';
import { panelsOf } from '../scene/minimal';

export interface TF {
  buildings: number;
  cables: number;
  meanLoadMw: number;
  weeks: number;
  week: string;
  demandKw: number;
  solarKw: number;
  battKw: number;
  socPct: number;
  price: number;
  co2: number;
  hottest: { name: string; kw: number } | null;
  sel: string;
  roof: string;
  panels: number;
  /** consequences of the simulated changes vs the real campus (selected week) */
  dCo2Kg: number;
  dCo2Pct: number;
  dCostEur: number;
  dCostPct: number;
  alarmsActive: number;
  alarmsUpcoming: number;
  alarmsPast: number;
  /** replay of the current model */
  modelName: string;
  modelWeekScore: number;
  modelMean: number;
  models: ModelInfo[];
  scoreMpc: number;
  scoreTemplate: number;
  co2SavedKg: number;
  costSavedEur: number;
  meanMpc: number;
  meanTemplate: number;
  violations: number;
  /** payback of the featured catalogue battery (null until the catalogue page has computed it) */
  featPayback: { name: string; years: number; saving: number; price: number } | null;
  fmtKw: (v: number) => string;
  fmtEur: (v: number) => string;
}

export const FEATURED_BATTERY = 'cube';

export function tourFacts(): TF | null {
  const s = useSim.getState();
  const d = derived.current;
  const snap = s.snap;
  if (!d || !s.replay || !s.campus || !snap) return null;
  let sum = 0;
  let n = 0;
  for (const w of s.replay) for (const v of w.load) (sum += v), n++;
  let hottest: TF['hottest'] = null;
  s.campus.features.forEach((f) => {
    const kw = snap.perB[f.properties.osmId]?.loadKw ?? 0;
    if (!hottest || kw > hottest.kw) hottest = { name: f.properties.short, kw };
  });
  const sel = s.selection ? (s.campus.features.find((f) => f.properties.osmId === s.selection)?.properties.short ?? s.selection) : '';
  const roof = bigRoof();
  const t = d.totals;
  const al = computeAlarms();
  const h = snap.hour;
  const eco = cachedEconomics()?.battery[FEATURED_BATTERY];
  const cur = s.models.find((m) => m.id === s.modelId);
  return {
    buildings: s.campus.features.length,
    cables: s.network?.edges.length ?? 0,
    meanLoadMw: sum / n / 1000,
    weeks: s.replay.length,
    week: d.week.start.slice(0, 10),
    demandKw: snap.loadKw,
    solarKw: snap.solarKw,
    battKw: snap.battKw,
    socPct: snap.soc * 100,
    price: snap.price,
    co2: snap.co2,
    hottest,
    sel,
    roof: roof?.name ?? '',
    panels: roof ? panelsOf(roof.id).length : 0,
    dCo2Kg: t.chosen.co2Kg - t.real.co2Kg,
    dCo2Pct: t.real.co2Kg > 0 ? ((t.chosen.co2Kg - t.real.co2Kg) / t.real.co2Kg) * 100 : 0,
    dCostEur: t.chosen.costEur - t.real.costEur,
    dCostPct: t.real.costEur > 0 ? ((t.chosen.costEur - t.real.costEur) / t.real.costEur) * 100 : 0,
    alarmsActive: al.filter((a) => a.startH <= h && h < a.endH).length,
    alarmsUpcoming: al.filter((a) => a.startH > h).length,
    alarmsPast: al.filter((a) => a.endH <= h).length,
    modelName: cur?.name ?? s.modelId,
    modelWeekScore: s.replay[s.weekIdx].mpc.score,
    modelMean: s.replay.reduce((a, w) => a + w.mpc.score, 0) / s.replay.length,
    models: s.models,
    scoreMpc: d.summary.mpc.score,
    scoreTemplate: d.summary.template.score,
    co2SavedKg: d.summary.mpc.co2SavedKg,
    costSavedEur: d.summary.mpc.costSavedEur,
    meanMpc: s.replay.reduce((a, w) => a + w.mpc.score, 0) / s.replay.length,
    meanTemplate: s.replay.reduce((a, w) => a + w.template.score, 0) / s.replay.length,
    violations: s.replay.reduce((a, w) => a + w.mpc.viol, 0),
    featPayback: eco ? { name: 'Cube Pro', years: eco.paybackYears, saving: eco.annualSavingEur, price: eco.priceEur } : null,
    fmtKw,
    fmtEur,
  };
}

/** a real replay row as the raw JSON the grid operator would see (hook slide) */
export function rawJsonRow(): string | null {
  const d = derived.current;
  const s = useSim.getState();
  if (!d) return null;
  const w = d.actual;
  const h = Math.floor(d.nowH ?? 59);
  const r = (v: number, k = 3) => Number(v.toFixed(k));
  const next = w.price.slice(h, h + 24);
  const list = (a: number[]) => `[${a.slice(0, 6).map((v) => r(v, 4)).join(', ')}, … ${Math.max(0, a.length - 6)} more]`;
  void s;
  return [
    '{',
    `  "timestamp": "${new Date(w.ms[h]).toISOString().slice(0, 16)}",`,
    `  "load_kw": ${r(w.load[h], 1)},`,
    `  "pv_kw": ${r(w.pv[h], 1)},`,
    `  "price_eur_kwh": ${r(w.price[h], 4)},`,
    `  "co2_kg_kwh": ${r(w.co2[h], 4)},`,
    `  "irradiance_w_m2": ${r(w.irr[h], 1)},`,
    `  "temp_c": ${r(w.temp[h], 1)},`,
    `  "price_next_24h": ${list(next)},`,
    `  "co2_next_24h": ${list(w.co2.slice(h, h + 24))}`,
    '}',
  ].join('\n');
}
