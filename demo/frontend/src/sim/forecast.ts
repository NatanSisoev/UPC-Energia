/**
 * History / forecast split for the replayed week.
 *
 * Everything before "now" is measured data. Everything after it is what we would know at that moment:
 *  - campus demand: same weekday & hour profile of the previous (up to 4) replayed weeks, corrected by the level
 *    of the last 24 measured hours (the correction fades out over ~2 days);
 *  - solar: mean of the same hour over the last 3 measured days (persistence);
 *  - price & CO2: the next 24 h are published day-ahead (as in the challenge), so they are real; beyond that the
 *    last published day is repeated.
 * Only information available at "now" is used, so the simulated agent plans exactly as it would live.
 */
import type { ReplayWeek } from '../types';

const keyOf = (ms: number) => {
  const d = new Date(ms);
  return d.getUTCDay() * 24 + d.getUTCHours();
};

export interface WeekSeries {
  load: Float64Array;
  pv: Float64Array;
  price: Float64Array;
  co2: Float64Array;
}

export function forecastWeek(replay: ReplayWeek[], weekIdx: number, nowH: number): WeekSeries {
  const w = replay[weekIdx];
  const n = w.load.length;
  const out: WeekSeries = {
    load: Float64Array.from(w.load),
    pv: Float64Array.from(w.pv),
    price: Float64Array.from(w.price),
    co2: Float64Array.from(w.co2),
  };
  if (nowH >= n) return out;
  const t0 = Math.max(0, nowH);

  // ---- demand profile by (weekday, hour) from earlier weeks
  const prev = replay
    .filter((x) => x.start < w.start)
    .sort((a, b) => (a.start < b.start ? 1 : -1))
    .slice(0, 4);
  const sum = new Float64Array(7 * 24);
  const cnt = new Float64Array(7 * 24);
  for (const p of prev) {
    for (let h = 0; h < p.load.length; h++) {
      const k = keyOf(p.ms[h]);
      sum[k] += p.load[h];
      cnt[k] += 1;
    }
  }
  // fallback (first week on record): this week's own history by hour of day
  const hodSum = new Float64Array(24);
  const hodCnt = new Float64Array(24);
  for (let h = 0; h < t0; h++) {
    const hod = new Date(w.ms[h]).getUTCHours();
    hodSum[hod] += w.load[h];
    hodCnt[hod] += 1;
  }
  const profile = (h: number): number => {
    const k = keyOf(w.ms[h]);
    if (cnt[k] > 0) return sum[k] / cnt[k];
    const hod = new Date(w.ms[h]).getUTCHours();
    if (hodCnt[hod] > 0) return hodSum[hod] / hodCnt[hod];
    const all = w.load.slice(0, Math.max(1, t0));
    return all.reduce((a, b) => a + b, 0) / all.length;
  };
  let ratio = 1;
  if (t0 > 0) {
    let a = 0;
    let b = 0;
    for (let h = Math.max(0, t0 - 24); h < t0; h++) {
      a += w.load[h];
      b += profile(h);
    }
    ratio = Math.min(1.3, Math.max(0.7, b > 0 ? a / b : 1));
  }
  for (let h = t0; h < n; h++) out.load[h] = profile(h) * (1 + (ratio - 1) * Math.exp(-(h - t0) / 48));

  // ---- solar: same hour over the last 3 measured days
  for (let h = t0; h < n; h++) {
    const hod = new Date(w.ms[h]).getUTCHours();
    let s = 0;
    let c = 0;
    for (let k = t0 - 1; k >= 0 && c < 3; k--) {
      if (new Date(w.ms[k]).getUTCHours() === hod) {
        s += w.pv[k];
        c++;
      }
    }
    if (c === 0) {
      // no history yet: same hour of the previous week
      const p = prev[0];
      const j = p ? p.ms.findIndex((m) => new Date(m).getUTCHours() === hod) : -1;
      out.pv[h] = j >= 0 ? p.pv[j] : 0;
    } else out.pv[h] = s / c;
  }

  // ---- prices & CO2: real for the published 24 h, then the last published day repeats
  const pub = Math.min(n, t0 + 24);
  for (let h = pub; h < n; h++) {
    let j = h;
    while (j >= pub) j -= 24;
    out.price[h] = w.price[Math.max(0, j)];
    out.co2[h] = w.co2[Math.max(0, j)];
  }
  return out;
}

/** Hour index of the week matching the real clock's weekday and hour (or mid-week if absent). */
export function clockHour(w: ReplayWeek, date = new Date()): number {
  const dow = date.getDay();
  const hod = date.getHours();
  for (let h = 0; h < w.ms.length; h++) {
    const d = new Date(w.ms[h]);
    if (d.getUTCDay() === dow && d.getUTCHours() === hod) return h;
  }
  return Math.floor(w.ms.length / 2);
}
