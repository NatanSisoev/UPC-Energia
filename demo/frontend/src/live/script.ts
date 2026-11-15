/**
 * The 4-minute live demo: one real campus week replayed at 10 simulated minutes per real second
 * (about 40 simulated hours), with scripted events. Times are real seconds.
 */
import type { ViewState } from '../components/MapView';
import { HOME_3D } from '../components/MapView';

export const LIVE_SECONDS = 240;
/** week replayed by the live demo (spring week with a good price/CO2 spread) */
export const LIVE_WEEK = 17;
/** simulated minutes per real second */
export const LIVE_SPEED = 10;
/** day 2, 06:00 (week-relative; the weekday depends on the chosen week) */
export const LIVE_START_MIN = 1440 + 6 * 60;

/** Real-second marks of the battery-yard failure window. */
export const FAULT_AT = 150;
export const FAULT_END = 195;

export type LiveAction = 'reset' | 'expand' | 'fault' | 'restore' | 'summary';

export interface LiveEvent {
  at: number;
  kicker: string;
  text: string;
  cam?: Partial<ViewState>;
  action?: LiveAction;
}

const V = (p: Partial<ViewState>): Partial<ViewState> => ({ ...HOME_3D, ...p });
const YARD: Partial<ViewState> = { longitude: 2.117, latitude: 41.3853, pitch: 55, bearing: -30 };

export const EVENTS: LiveEvent[] = [
  { at: 0, action: 'reset', kicker: 'Day 2 · 06:00', text: 'The campus wakes up. The agent only knows the next 24 h of price and CO₂, and decides hour by hour when to charge or discharge the battery.', cam: V({ bearing: -30 }) },
  { at: 30, kicker: 'Reading the grid', text: 'Cheap, clean hours: charge. Expensive, dirty hours: discharge. Watch the supply pie: the grid share shrinks whenever the battery gives energy back.', cam: V({ zoom: 16.7, bearing: -60 }) },
  { at: 60, action: 'expand', kicker: 'Expansion', text: 'We add solar to every usable roof and a second battery to the yard. More sources, more play between grid, sun and storage.', cam: V({ zoom: 17, bearing: 20 }) },
  { at: 95, kicker: 'Solar noon', text: 'Sun and battery share the load. Surplus solar earns nothing in the contest, so storage turns it into evening savings.', cam: V({ zoom: 16.5, bearing: 60 }) },
  { at: 125, kicker: 'Heading into the peak', text: 'Prices and grid CO₂ climb into the ramp. The battery yard is the campus buffer.', cam: { ...YARD, zoom: 17.8 } },
  { at: FAULT_AT, action: 'fault', kicker: 'CRITICAL FAULT', text: 'Battery yard failure: protection trips every unit offline. An e-mail alert goes to the on-call phone right now.', cam: { ...YARD, zoom: 19 } },
  { at: 172, kicker: 'Degraded mode', text: 'No battery: grid and solar carry the campus. Grid import, and the cost and CO₂ it brings, goes up. The agent keeps running and waits for the all-clear.', cam: V({ bearing: -10 }) },
  { at: FAULT_END, action: 'restore', kicker: 'Restored', text: 'Technicians reset the yard and the self-test passes. The agent takes control of the batteries again.', cam: { ...YARD, zoom: 18.2 } },
  { at: 215, action: 'summary', kicker: 'Result', text: '', cam: V({ bearing: -18 }) },
];
