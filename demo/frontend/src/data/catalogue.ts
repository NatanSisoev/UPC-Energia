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
