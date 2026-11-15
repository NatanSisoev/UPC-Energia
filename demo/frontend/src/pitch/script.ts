/**
 * The 3-minute pitch, scene by scene (story from PLAN.md: problem -> data -> strategy -> live week -> results -> limits).
 * Captions may be functions of `Facts`, so every number shown on screen is read from the replay data or from
 * challenge.ts results — never typed in by hand.
 */
import type { ViewState } from '../components/MapView';
import { HOME } from '../components/MapView';
import type { LayerId } from '../types';
import type { InsightTab } from '../components/Insights';

export interface Facts {
  buildings: number;
  meanLoadMw: number;
  weeks: number;
  /** Python-reference means over all weeks (the numbers the TS engine reproduces) */
  meanMpc: number;
  meanTemplate: number;
  violations: number;
  /** currently replayed week, recomputed by challenge.ts in the browser */
  weekStart: string;
  scoreMpc: number;
  scoreTemplate: number;
  dCo2Mpc: number;
  dCostMpc: number;
  co2SavedKg: number;
  costSavedEur: number;
}

type Text = string | ((f: Facts) => string);

export interface Scene {
  id: string;
  /** seconds in auto mode */
  dur: number;
  kicker: string;
  title: Text;
  body: Text;
  /** presenter-only speaker notes */
  notes?: string;
  route: '/' | '/insights' | '/impact';
  insight?: InsightTab;
  /** camera: jump to `from` (instant), then drift to `to` over the scene */
  cam?: { from: Partial<ViewState>; to?: Partial<ViewState> };
  layers?: Partial<Record<LayerId, boolean>>;
  xray?: boolean;
  agent?: 'mpc' | 'template' | 'none';
  /** simulated minutes per real second (0 = paused) */
  speed?: number;
  tMin?: number;
  sunLock?: number | null;
  /** HUD pieces shown over the 3D scene */
  show?: { advisor?: boolean; timebar?: boolean };
}

const V = (p: Partial<ViewState>): Partial<ViewState> => ({ ...HOME, ...p });
const BASE: Partial<Record<LayerId, boolean>> = { heat: false, people: false };
export const PITCH_WEEK = 17;

export const SCENES: Scene[] = [
  {
    id: 'problem',
    dur: 14,
    kicker: '1 · The problem',
    title: 'A campus that never switches off',
    body: (f) =>
      `UPC Campus Nord: ${f.buildings} buildings drawing ${f.meanLoadMw.toFixed(2)} MW on average, a small solar plant and one 2 MWh battery. Goal: cut CO₂ (70 % of the score) and electricity cost (30 %) versus the same campus with no battery.`,
    notes: 'Set the stakes: real telemetry, real grid price and CO2. Score = 0.7·ΔCO2 + 0.3·ΔCost − penalty·infractions.',
    route: '/',
    cam: { from: V({ pitch: 56, bearing: -18 }), to: V({ pitch: 56, bearing: -52, zoom: 16.3 }) },
    layers: { ...BASE, heat: true },
    xray: false,
    speed: 0,
    tMin: 11 * 60 + 5 * 1440,
    sunLock: 12.5,
    agent: 'mpc',
    show: {},
  },
  {
    id: 'prices',
    dur: 18,
    kicker: '2 · What the data says',
    title: 'Price and carbon peak at different hours',
    body: 'Real hourly price and grid CO₂ intensity, averaged by hour of day over 35 whole weeks. Cheap and clean hours exist every day — a battery can shift demand into them.',
    notes: 'Point at the daily swing versus the ~11 % round-trip loss.',
    route: '/insights',
    insight: 'prices',
    speed: 0,
  },
  {
    id: 'solar',
    dur: 16,
    kicker: '2 · What the data says',
    title: 'Solar is small — the grid is the lever',
    body: 'The PV plant is tiny next to campus demand, so there is almost never surplus to store. The prize is arbitrage: charge from the grid when it is cheap and clean, discharge when it is not.',
    notes: 'Demand is weekday-heavy; weekends are flat.',
    route: '/insights',
    insight: 'solar',
    speed: 0,
  },
  {
    id: 'strategy',
    dur: 22,
    kicker: '3 · The strategy',
    title: 'Look 24 h ahead, act now, re-plan every hour',
    body: 'Each hour the agent optimises the next 24 h of price × CO₂ exactly (dynamic programming on the value of stored energy), applies only the first move, then plans again. A hard safety clamp keeps every command feasible: zero infractions.',
    notes: 'No load forecast is needed; the last hour’s net load only stops it exporting battery energy. Each decision takes well under a millisecond in this browser port.',
    route: '/',
    cam: { from: V({ longitude: 2.1163, latitude: 41.3856, zoom: 17.6, pitch: 58, bearing: -40 }), to: V({ longitude: 2.117, latitude: 41.3853, zoom: 18.3, pitch: 60, bearing: -10 }) },
    layers: { ...BASE },
    xray: true,
    speed: 90,
    tMin: 6 * 60 + 5 * 1440,
    sunLock: null,
    show: { advisor: true },
  },
  {
    id: 'agent',
    dur: 16,
    kicker: '3 · The strategy',
    title: 'A daily rhythm nobody scheduled',
    body: 'Average battery action by hour over all 35 weeks: the agent charges in cheap, clean hours and discharges into expensive, dirty ones. The organisers’ template follows fixed clock windows.',
    route: '/insights',
    insight: 'agent',
    speed: 0,
  },
  {
    id: 'horizon',
    dur: 14,
    kicker: '3 · The strategy',
    title: 'Why 24 hours is enough',
    body: 'We re-ran the real agent with shorter and longer look-ahead. Most of the value arrives within 6 hours and the curve is flat by 12: a 2 MWh / 0.5 MW battery fills or empties in about 8 hours.',
    route: '/insights',
    insight: 'horizon',
    speed: 0,
  },
  {
    id: 'live',
    dur: 30,
    kicker: '4 · Live week',
    title: 'Watch the agent run a real week',
    body: (f) =>
      `Week of ${f.weekStart}: real load, solar, prices and CO₂ replayed through the leaderboard’s physics. Purple = charging, amber = discharging; the ribbon shows price and the battery’s moves hour by hour.`,
    notes: 'Let the clock run; point at a charge in the night valley and a discharge in the evening peak.',
    route: '/',
    cam: { from: V({ pitch: 54, bearing: -30, zoom: 16.4 }), to: V({ pitch: 54, bearing: 10, zoom: 16.7 }) },
    layers: { ...BASE, heat: true },
    xray: false,
    agent: 'mpc',
    speed: 200,
    tMin: 0,
    sunLock: null,
    show: { advisor: true, timebar: true },
  },
  {
    id: 'results',
    dur: 24,
    kicker: '5 · Results',
    title: (f) => `Score ${f.scoreMpc.toFixed(2)} vs ${f.scoreTemplate.toFixed(2)} for the template`,
    body: (f) =>
      `This week the agent cuts CO₂ by ${f.dCo2Mpc.toFixed(2)} % and cost by ${f.dCostMpc.toFixed(2)} % (${Math.round(f.co2SavedKg)} kg CO₂, €${Math.round(f.costSavedEur)}). Over all ${f.weeks} real weeks: mean ${f.meanMpc.toFixed(2)} vs ${f.meanTemplate.toFixed(2)}, with ${f.violations} infractions.`,
    notes: 'Whole-week blocks, like the hidden test. The bars are the Python reference that the TS engine reproduces to 1e-13.',
    route: '/impact',
    cam: { from: V({ pitch: 40, bearing: -18, zoom: 15.9 }), to: V({ pitch: 44, bearing: -40, zoom: 16 }) },
    layers: { ...BASE },
    xray: false,
    speed: 0,
    show: {},
  },
  {
    id: 'limits',
    dur: 12,
    kicker: '6 · Limits and next steps',
    title: 'Honest limits',
    body: 'A 2 MWh battery is small for a campus drawing over a megawatt, so gains are single-digit percent — bigger storage is the real lever. The public board covers half of the hidden weeks; our validation uses whole weeks. Next: uncertainty-aware control and a real deployment.',
    route: '/',
    cam: { from: V({ pitch: 40, bearing: -52, zoom: 16.3 }), to: V({ pitch: 0, bearing: 0, zoom: 16 }) },
    layers: { ...BASE },
    xray: false,
    speed: 40,
    sunLock: null,
    show: {},
  },
];

export const TOTAL_SECONDS = SCENES.reduce((a, s) => a + s.dur, 0);
