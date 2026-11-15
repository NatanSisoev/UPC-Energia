/**
 * Asset register: type, specification, age and condition of every building, PV array, battery unit, cable and the
 * substation. The challenge data has no asset metadata, so years, conductor sizes, envelope classes etc. are
 * ESTIMATES (deterministic per asset, plausible for a 1990s–2010s Spanish campus) and the UI labels them as such.
 * Degradation models (typical published rates):
 *   PV modules  : −0.5 %/year output (crystalline Si), inverters replaced every ~12 years
 *   LFP battery : state of health −2 %/year (calendar + ~1 cycle/day), floor 70 %; round trip −0.3 pt/year
 *   MV cables   : XLPE insulation health −1.2 %/year over a ~40 year design life
 *   buildings   : envelope / HVAC condition from age since build or last refurbishment
 */
import type { BatteryUnit, BuildingProps, PanelModelId, SolarCfg } from '../types';
import { hash } from './scenario';
import { BATTERY_MODELS, PANEL_MODELS, cableMva, type CableModel } from './catalogue';
import { installedKwp } from '../sim/engine';

export const THIS_YEAR = 2026;

export type Grade = 'Good' | 'Fair' | 'Poor';
export interface Condition {
  /** 0..1 health */
  health: number;
  grade: Grade;
  note: string;
}
export const grade = (h: number): Grade => (h >= 0.85 ? 'Good' : h >= 0.7 ? 'Fair' : 'Poor');
export const gradeColor = (g: Grade) => (g === 'Good' ? 'var(--ok)' : g === 'Fair' ? 'var(--warn)' : 'var(--danger)');

export interface SpecRow {
  k: string;
  v: string;
}
export interface AssetSheet {
  kind: 'building' | 'pv' | 'battery' | 'cable' | 'substation';
  title: string;
  type: string;
  year: number;
  estimated: boolean;
  specs: SpecRow[];
  condition: Condition;
}

const pick = <T,>(seed: string, arr: T[]): T => arr[Math.min(arr.length - 1, Math.floor(hash(seed) * arr.length))];

/* ------------------------------------------------------------ buildings ---- */
const HVAC: Record<string, string[]> = {
  teaching: ['Gas boiler + split AC', 'Heat pump (air-water)', 'District heating + chillers'],
  lab: ['Heat pump (air-water)', 'Gas boiler + fume-hood extraction', 'VRF heat pump'],
  research: ['VRF heat pump', 'Chillers + heat recovery'],
  data_center: ['CRAC units + free cooling', 'Liquid cooling + chillers'],
  mixed: ['VRF heat pump', 'Heat pump (air-water)'],
  library: ['Heat pump (air-water)', 'Gas boiler + split AC'],
  sports: ['Gas boiler + solar thermal', 'Heat pump + DHW tanks'],
  residence: ['Gas boiler + DHW', 'Heat pump + DHW tanks'],
  aux: ['Electric heaters', 'Split AC'],
};
export function buildingSheet(p: BuildingProps): AssetSheet {
  const built = p.category === 'data_center' ? 2005 : 1965 + Math.round(hash(`${p.osmId}yr`) * 50);
  const refurb = built < 1995 && hash(`${p.osmId}rf`) > 0.45 ? 2008 + Math.round(hash(`${p.osmId}ry`) * 14) : null;
  const ref = refurb ?? built;
  const age = THIS_YEAR - ref;
  const health = Math.max(0.45, 1 - age * 0.011);
  const epc = health > 0.88 ? 'B' : health > 0.78 ? 'C' : health > 0.66 ? 'D' : 'E';
  const floors = p.levels ?? Math.max(1, Math.round(p.height_m / 3.6));
  return {
    kind: 'building',
    title: p.short,
    type: p.category === 'data_center' ? 'Data centre (HPC)' : `${p.category[0].toUpperCase()}${p.category.slice(1)} building`,
    year: built,
    estimated: true,
    specs: [
      { k: 'Built', v: `${built}${refurb ? ` · refurbished ${refurb}` : ''}` },
      { k: 'Floors / height', v: `${floors} · ${p.height_m.toFixed(0)} m` },
      { k: 'Footprint', v: `${Math.round(p.area_m2).toLocaleString('en')} m²` },
      { k: 'Gross floor area', v: `${Math.round(p.area_m2 * floors).toLocaleString('en')} m²` },
      { k: 'Energy class (EPC)', v: epc },
      { k: 'Heating / cooling', v: pick(`${p.osmId}hv`, HVAC[p.category] ?? HVAC.aux) },
      { k: 'Supply', v: p.category === 'data_center' ? 'MV 25 kV, dedicated transformer' : 'LV 400 V from campus ring' },
    ],
    condition: { health, grade: grade(health), note: `Envelope & HVAC ${age} years since ${refurb ? 'refurbishment' : 'construction'}.` },
  };
}

/* ------------------------------------------------------------ PV arrays ---- */
export function pvYear(p: BuildingProps): number {
  return 2010 + Math.round(hash(`${p.osmId}pv`) * 9);
}
/** output factor from module ageing (1 = new) */
export const pvHealth = (year: number) => Math.max(0.75, 1 - 0.005 * (THIS_YEAR - year));
export function pvSheet(p: BuildingProps, cfg: SolarCfg, panel: PanelModelId, broken: boolean): AssetSheet {
  const m = PANEL_MODELS.find((x) => x.id === panel)!;
  const year = pvYear(p);
  const age = THIS_YEAR - year;
  const h = pvHealth(year);
  const kwp = installedKwp(p, cfg, panel);
  const invAge = age % 12;
  const health = broken ? 0 : h * (invAge > 10 ? 0.95 : 1);
  return {
    kind: 'pv',
    title: `PV array · ${p.short}`,
    type: `Rooftop PV, ${m.name}`,
    year,
    estimated: true,
    specs: [
      { k: 'Installed', v: `${year} (${age} years)` },
      { k: 'Peak power', v: `${kwp.toFixed(1)} kWp (${Math.round(kwp * 1000 / 430)} modules)` },
      { k: 'Module', v: `${m.name} · ${m.efficiency}% eff.` },
      { k: 'Tilt / roof covered', v: `${cfg.tilt}° · ${(cfg.fraction * 100).toFixed(1)}%` },
      { k: 'Inverter', v: `String inverter, ${invAge} years since replacement` },
      { k: 'Output vs new', v: `${(h * 100).toFixed(1)}% (−0.5 %/year)` },
    ],
    condition: { health, grade: broken ? 'Poor' : grade(health), note: broken ? 'Inverter reports a fault: no output.' : `Module degradation ${((1 - h) * 100).toFixed(1)}% after ${age} years.` },
  };
}

/** One PV panel row on a roof: a string of 4 modules on one mounting frame (4.2 × 1.8 m). */
export const PANEL_AREA_M2 = 4.2 * 1.8;
export const MODULES_PER_PANEL = 4;
const ISSUES = ['clean', 'clean', 'clean', 'clean', 'clean', 'light soiling', 'clean', 'bird droppings', 'clean', 'micro-cracks', 'clean', 'hot-spot on 1 cell'];

export interface PanelInfo {
  sheet: AssetSheet;
  ratedKw: number;
  /** 0..1 output factor of this panel vs a new one */
  health: number;
}
export function panelSheet(p: BuildingProps, j: number, cfg: SolarCfg, panel: PanelModelId, broken: boolean): PanelInfo {
  const m = PANEL_MODELS.find((x) => x.id === panel)!;
  const year = pvYear(p);
  const age = THIS_YEAR - year;
  const issue = broken ? 'inverter fault' : pick(`${p.osmId}is${j}`, ISSUES);
  const extra = issue === 'clean' ? 0 : issue === 'light soiling' ? 0.03 : issue === 'bird droppings' ? 0.05 : issue === 'micro-cracks' ? 0.08 : 0.12;
  // module ageing + panel-to-panel spread (mismatch) + its issue
  const health = broken ? 0 : Math.max(0.5, pvHealth(year) * (0.97 + 0.03 * hash(`${p.osmId}mm${j}`)) - extra);
  const ratedKw = PANEL_AREA_M2 * m.kwm2;
  const tag = p.short.replace(/^Edifici\s+/, '').replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase();
  return {
    ratedKw,
    health,
    sheet: {
      kind: 'pv',
      title: `PV-${tag}-${String(j).padStart(2, '0')}`,
      type: `${MODULES_PER_PANEL} × ${m.name} on one frame`,
      year,
      estimated: true,
      specs: [
        { k: 'Rated', v: `${(ratedKw * 1000).toFixed(0)} Wp (${MODULES_PER_PANEL} modules)` },
        { k: 'Module', v: `${m.name} · ${m.efficiency}% eff.` },
        { k: 'Area', v: `${PANEL_AREA_M2.toFixed(1)} m²` },
        { k: 'Tilt', v: `${cfg.tilt}°, aligned with the street grid` },
        { k: 'Installed', v: `${year} (${age} years)` },
        { k: 'Output vs new', v: `${(health * 100).toFixed(1)}%` },
        { k: 'Inspection', v: issue },
      ],
      condition: { health, grade: broken ? 'Poor' : grade(health), note: broken ? 'Array inverter reports a fault: no output.' : issue === 'clean' ? `Ageing only: −${((1 - pvHealth(year)) * 100).toFixed(1)}% after ${age} years.` : `Ageing plus ${issue} (−${(extra * 100).toFixed(0)}%). ${issue === 'hot-spot on 1 cell' ? 'Replace the module.' : 'Clean or inspect at the next visit.'}` },
    },
  };
}

/* ------------------------------------------------------------- batteries ---- */
/** state of health: −2 %/year calendar + cycling, floor 70 % */
export const batterySoh = (year: number) => Math.max(0.7, 1 - 0.02 * (THIS_YEAR - year));
export function batterySheet(u: BatteryUnit, broken: boolean): AssetSheet {
  const m = BATTERY_MODELS.find((x) => x.id === u.modelId)!;
  const year = u.year ?? THIS_YEAR;
  const age = THIS_YEAR - year;
  const soh = batterySoh(year);
  const cycles = Math.round(age * 330);
  return {
    kind: 'battery',
    title: m.name,
    type: `LFP battery storage · ${m.vendor}`,
    year,
    estimated: u.modelId === 'challenge',
    specs: [
      { k: 'Installed', v: age > 0 ? `${year} (${age} years)` : `${year} (new)` },
      { k: 'Energy / power', v: `${u.capacity.toFixed(2)} MWh · ${u.power.toFixed(2)} MW` },
      { k: 'Usable now', v: `${(u.capacity * soh).toFixed(2)} MWh (SOH ${(soh * 100).toFixed(0)}%)` },
      { k: 'Round trip', v: `${(m.rte - 0.3 * age).toFixed(1)}% (rated ${m.rte}%)` },
      { k: 'Cycles', v: `${cycles.toLocaleString('en')} of ${m.cycles.toLocaleString('en')} rated` },
      { k: 'Chemistry', v: 'Lithium iron phosphate, liquid cooled' },
    ],
    condition: { health: broken ? 0 : soh, grade: broken ? 'Poor' : grade(soh), note: broken ? 'Unit offline (BMS fault).' : `Capacity fade ${((1 - soh) * 100).toFixed(0)}% after ${cycles.toLocaleString('en')} cycles.` },
  };
}

/* ---------------------------------------------------------------- cables ---- */
export interface CableInfo {
  /** index of the edge in network.json */
  i: number;
  len: number;
  /** buildings fed through the segment (sizes the conductor) */
  down: number;
  flowKw: number;
  /** catalogue cable installed in place of the original one */
  model?: CableModel;
}
/** thermal rating of a buried 20 kV-class 3-core Al XLPE segment, by how many buildings it feeds (kW) */
export const cableRatingKw = (down: number, model?: CableModel) => (model ? cableMva(model) * 1000 : down >= 10 ? 9000 : down >= 3 ? 6800 : 5000);

export function cableSheet(c: CableInfo): AssetSheet {
  const trunk = c.down >= 10;
  const mm2 = trunk ? 240 : c.down >= 3 ? 150 : 95;
  const ratedKw = cableRatingKw(c.down, c.model);
  const year = c.model ? THIS_YEAR : 1988 + Math.round(hash(`cab${c.i}`) * 30);
  const age = THIS_YEAR - year;
  const health = Math.max(0.4, 1 - 0.012 * age);
  const load = Math.abs(c.flowKw) / ratedKw;
  return {
    kind: 'cable',
    title: `Cable segment C-${String(c.i + 1).padStart(2, '0')}`,
    type: c.down <= 1 ? 'MV service drop to one building' : `MV underground cable · ${trunk ? 'trunk' : 'branch'} feeding ${c.down} buildings`,
    year,
    estimated: true,
    specs: [
      { k: 'Conductor', v: c.model ? `${c.model.name} · ${c.model.voltageKv} kV` : `RHZ1 12/20 kV · 3×${mm2} mm² Al XLPE` },
      { k: 'Length', v: `${c.len.toFixed(0)} m` },
      { k: 'Installed', v: `${year} (${age} years)` },
      { k: 'Rating', v: `${(ratedKw / 1000).toFixed(1)} MW` },
      { k: 'Flow now', v: `${Math.abs(c.flowKw).toFixed(0)} kW ${c.flowKw >= 0 ? 'to buildings' : 'back-feed'} · ${(load * 100).toFixed(1)}% loaded` },
    ],
    condition: { health, grade: grade(health), note: `Insulation ${age} of ~40 design years${health < 0.7 ? ': schedule a partial-discharge test.' : '.'}` },
  };
}

/* ------------------------------------------------------------ substation ---- */
export function substationSheet(peakKw: number, outage: boolean): AssetSheet {
  const year = 1992;
  const age = THIS_YEAR - year;
  const health = Math.max(0.5, 1 - 0.009 * age);
  return {
    kind: 'substation',
    title: 'Campus substation',
    type: 'MV/LV transformer substation',
    year,
    estimated: true,
    specs: [
      { k: 'Transformers', v: '3 × 1,600 kVA, 25 kV / 400 V, oil' },
      { k: 'Firm capacity', v: '3.2 MVA (N−1) · 4.5 MW limit' },
      { k: 'Installed', v: `${year} (${age} years)` },
      { k: 'Week peak load', v: `${(peakKw / 1000).toFixed(2)} MW (${((100 * peakKw) / 4500).toFixed(0)}% of limit)` },
      { k: 'Protection', v: 'SF6 switchgear, remote telemetry' },
    ],
    condition: { health: outage ? 0 : health, grade: outage ? 'Poor' : grade(health), note: outage ? 'Grid supply lost (simulated outage).' : `Transformer oil and bushings at ${age} years: routine.` },
  };
}
