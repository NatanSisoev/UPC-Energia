/**
 * Equipment catalogue for the what-if lab.
 * Specs are realistic-order-of-magnitude values published by vendors,
 * lightly rounded for the demo ("specs approximated for illustration").
 */
import type { PanelModelId } from '../types';

export interface BatteryModel {
  id: string;
  name: string;
  vendor: string;
  capacity: number; // MWh
  power: number; // MW
  /** round-trip efficiency % */
  rte: number;
  cycles: number;
  priceEur: number;
  accent: string;
  note: string;
}

export const BATTERY_MODELS: BatteryModel[] = [
  {
    id: 'challenge',
    name: 'Challenge Pack',
    vendor: 'UPC Sostenible spec',
    capacity: 2,
    power: 0.5,
    rte: 90,
    cycles: 6000,
    priceEur: 480_000,
    accent: '#34d399',
    note: 'The exact battery of the contest: 2 MWh, ±500 kW, 90 % round trip.',
  },
  {
    id: 'labcell',
    name: 'UPC Lab Cell',
    vendor: 'UPC pilot line',
    capacity: 0.24,
    power: 0.12,
    rte: 86,
    cycles: 6000,
    priceEur: 95_000,
    accent: '#94a3b8',
    note: 'Teaching-scale unit, perfect for classroom experiments.',
  },
  {
    id: 'lg-ess',
    name: 'Grid Stack 0.9',
    vendor: 'LG Energy Solution',
    capacity: 0.94,
    power: 0.5,
    rte: 88,
    cycles: 5000,
    priceEur: 260_000,
    accent: '#f87171',
    note: 'Compact commercial ESS, fast to deploy indoors.',
  },
  {
    id: 'fusion',
    name: 'Fusion M0',
    vendor: 'Huawei',
    capacity: 1.2,
    power: 0.6,
    rte: 89,
    cycles: 6000,
    priceEur: 320_000,
    accent: '#f472b6',
    note: 'Module-level optics, strong partial-load efficiency.',
  },
  {
    id: 'cube',
    name: 'Cube Pro',
    vendor: 'BYD',
    capacity: 2.76,
    power: 1.2,
    rte: 89,
    cycles: 8000,
    priceEur: 610_000,
    accent: '#60a5fa',
    note: 'Containerized LFP blade cells, very high cycle life.',
  },
  {
    id: 'megapack',
    name: 'Megapack 2 XL',
    vendor: 'Tesla',
    capacity: 3.87,
    power: 1.9,
    rte: 88,
    cycles: 8000,
    priceEur: 1_150_000,
    accent: '#34d399',
    note: 'The reference grid-scale unit on every campus RFP.',
  },
  {
    id: 'enerc',
    name: 'EnerC Plus',
    vendor: 'CATL',
    capacity: 5.02,
    power: 2.5,
    rte: 90,
    cycles: 10_000,
    accent: '#c084fc',
    priceEur: 1_050_000,
    note: 'Liquid-cooled 10k-cycle workhorse, best €/cycled-kWh.',
  },
];

export interface PanelModel {
  id: PanelModelId;
  name: string;
  /** kW per m² of roof at optimal tilt */
  kwm2: number;
  /** installed cost per kWp */
  eurPerKw: number;
  efficiency: number; // module efficiency
  accent: string;
}

export const PANEL_MODELS: PanelModel[] = [
  { id: 'mono', name: 'Mono PERC 430 W', kwm2: 0.2, eurPerKw: 110, efficiency: 21.8, accent: '#fbbf24' },
  { id: 'hjt', name: 'HJT Premium 500 W', kwm2: 0.235, eurPerKw: 135, efficiency: 23.5, accent: '#34d399' },
  { id: 'tandem', name: 'Tandem Perovskite 620 W', kwm2: 0.28, eurPerKw: 210, efficiency: 27.1, accent: '#22d3ee' },
];

/** Substation transformer headroom — total fleet power cannot exceed it. */
export const SUBSTATION_POWER_LIMIT_MW = 4.5;

export interface CableModel {
  id: string;
  name: string;
  /** network level it is meant for */
  level: 'LV' | 'MV' | 'DC';
  conductor: 'Cu' | 'Al';
  section: string;
  voltageKv: number;
  /** continuous current in buried ducts, A */
  ampacityA: number;
  /** AC resistance at 90 °C, ohm/km */
  rOhmKm: number;
  /** installed cost, EUR per metre (supply + trench + joints) */
  eurPerM: number;
  accent: string;
  note: string;
}

/** Apparent power the cable carries continuously (MVA; DC cables: MW). */
export function cableMva(c: CableModel): number {
  return (c.level === 'DC' ? c.voltageKv * c.ampacityA : Math.sqrt(3) * c.voltageKv * c.ampacityA) / 1000;
}

/** Indicative catalogue of the cables a campus network is built from (rounded from public manufacturer tables). */
export const CABLE_MODELS: CableModel[] = [
  { id: 'lv-al-240', name: 'LV Al 4×240 XLPE', level: 'LV', conductor: 'Al', section: '4×240 mm²', voltageKv: 0.4, ampacityA: 330, rOhmKm: 0.125, eurPerM: 55, accent: '#94a3b8', note: 'Cheapest building feeder; fine for small loads and short runs.' },
  { id: 'lv-cu-240', name: 'LV Cu 4×240 XLPE', level: 'LV', conductor: 'Cu', section: '4×240 mm²', voltageKv: 0.4, ampacityA: 430, rOhmKm: 0.075, eurPerM: 95, accent: '#f59e0b', note: 'Copper building feeder: lower losses and 30 % more current.' },
  { id: 'lv-cu-2x240', name: 'LV Cu 2×(4×240) twin', level: 'LV', conductor: 'Cu', section: '2×4×240 mm²', voltageKv: 0.4, ampacityA: 800, rOhmKm: 0.038, eurPerM: 190, accent: '#fb923c', note: 'Two cables in parallel: carries a full 500 kW battery link.' },
  { id: 'mv-al-150', name: 'MV Al 3×150 XLPE', level: 'MV', conductor: 'Al', section: '3×150 mm²', voltageKv: 20, ampacityA: 320, rOhmKm: 0.206, eurPerM: 70, accent: '#60a5fa', note: 'Standard 20 kV ring cable between the substation and transformer rooms.' },
  { id: 'mv-cu-240', name: 'MV Cu 3×240 XLPE', level: 'MV', conductor: 'Cu', section: '3×240 mm²', voltageKv: 20, ampacityA: 520, rOhmKm: 0.075, eurPerM: 140, accent: '#38bdf8', note: 'Heavy 20 kV trunk for a larger substation connection.' },
  { id: 'dc-pv-6', name: 'DC solar H1Z2Z2-K', level: 'DC', conductor: 'Cu', section: '1×6 mm²', voltageKv: 1.5, ampacityA: 70, rOhmKm: 3.39, eurPerM: 1.4, accent: '#34d399', note: 'Roof string cable between panels and inverter.' },
];
