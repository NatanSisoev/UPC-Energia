/**
 * Deterministic synthetic scenario (price, CO2, weather, sun).
 *
 * Everything is a pure function of absolute minutes measured from
 * DEMO_EPOCH (Mon 2026-03-16 00:00 CET). History extends into negative
 * minutes, forecasts into positive ones — same functions, no randomness
 * at runtime, so the demo behaves identically every time it runs.
 */

/** Fixed demo "now-zero": Monday 2026-03-16 00:00 Europe/Madrid. */
export const DEMO_EPOCH_MS = Date.UTC(2026, 2, 16, 0, 0, 0) - 3_600_000; // CET = UTC+1

/** Hours of synthetic data the demo knows about. */
export const HISTORY_HOURS = 48;
export const FORECAST_HOURS = 36;

/** Deterministic hash → [0,1). */
export function hash(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

/** 0-based day index relative to epoch Monday. */
export function dayIndex(tMin: number): number {
  return Math.floor(tMin / 1440);
}

/** 0=Mon .. 6=Sun */
export function dayOfWeek(tMin: number): number {
  return ((dayIndex(tMin) % 7) + 7) % 7;
}

/** fractional hour of day [0..24) */
export function hourOfDay(tMin: number): number {
  return (((tMin % 1440) + 1440) % 1440) / 60;
}

const WEEKEND_FACTOR: [number, number] = [0.78, 0.72]; // Sat, Sun

function weekendFactor(tMin: number): number {
  const dow = dayOfWeek(tMin);
  if (dow === 5) return WEEKEND_FACTOR[0];
  if (dow === 6) return WEEKEND_FACTOR[1];
  return 1;
}

/** DAM (day-ahead market) style price curve, €/MWh, hourly. */
const PRICE_24 = [
  52, 48, 46, 45, 45, 48, 55, 68, 79, 84, 78, 72, 70, 74, 79, 92, 118, 135, 128, 112, 95, 78, 62, 55,
];

/** Grid CO2 intensity, g/kWh (solar midday dip, gas-fired evening peak). */
const CO2_24 = [
  210, 200, 190, 185, 185, 190, 205, 235, 262, 272, 256, 236, 222, 226, 242, 272, 302, 322, 300, 272,
  250, 235, 220, 205,
];

function curveAt(curve: number[], tMin: number, wobble: number, salt: string): number {
  const h = hourOfDay(tMin);
  const i = Math.floor(h) % 24;
  const frac = h - Math.floor(h);
  const v = curve[i] + (curve[(i + 1) % 24] - curve[i]) * frac;
  const n = (hash(`${salt}${dayIndex(tMin)}${i}`) - 0.5) * wobble;
  return Math.max(1, (v + n) * weekendFactor(tMin));
}

export function priceAt(tMin: number): number {
  return curveAt(PRICE_24, tMin, 14, 'price');
}

export function co2At(tMin: number): number {
  return curveAt(CO2_24, tMin, 22, 'co2');
}

/** Daily min/max price for the agent's cheap/expensive windows. */
export function priceDayRange(day: number): { min: number; max: number } {
  const dow = ((day % 7) + 7) % 7;
  const wf = dow === 5 ? WEEKEND_FACTOR[0] : dow === 6 ? WEEKEND_FACTOR[1] : 1;
  const arr = PRICE_24.map((v) => v * wf);
  return { min: Math.min(...arr), max: Math.max(...arr) };
}

/** Solar geometry: mid-March Barcelona daylight 06:55 → 19:25. */
export function sunFactor(tMin: number): number {
  const h = hourOfDay(tMin);
  const rise = 6.92;
  const set = 19.42;
  if (h <= rise || h >= set) return 0;
  return Math.pow(Math.sin((Math.PI * (h - rise)) / (set - rise)), 1.25);
}

/** Deterministic daily cloud attenuation 0.55 (grim) .. 1.0 (bluebird). */
export function cloudAt(tMin: number): number {
  const d = dayIndex(tMin);
  const r = hash(`cloud${d}`);
  // mix in a slow intra-day drift so mornings/afternoons differ
  const drift = 0.06 * Math.sin(hourOfDay(tMin) * 0.52 + r * 6.28);
  return Math.min(1, Math.max(0.45, 0.55 + 0.45 * r + drift));
}

/** Compact calendar label: "Mon 16 Mar" */
export function dayLabel(tMin: number): string {
  const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const abs = DEMO_EPOCH_MS + tMin * 60_000;
  // EPOCH is UTC+1 aligned, so UTC hours lag by 1 — shift to keep labels on the right day
  const shifted = new Date(abs + 3_600_000);
  const name = DOW[(shifted.getUTCDay() + 6) % 7];
  const dom = shifted.getUTCDate();
  return `${name} ${dom} ${MON[shifted.getUTCMonth()]}`;
}

/** "HH:MM" in fixed Europe/Madrid wall time. */
export function clockLabel(tMin: number): string {
  const shifted = DEMO_EPOCH_MS + tMin * 60_000 + 3_600_000; // CET
  const d = new Date(shifted);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}
