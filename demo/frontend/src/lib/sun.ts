/**
 * Sun position for UPC Campus Nord (Barcelona). Deterministic (NOAA low-precision algorithm).
 *
 * Input convention: the replay clock is *local wall-clock time stored as if it were UTC*
 * (replay.json `ms` for "2025-09-01T00:00" is 2025-09-01T00:00:00Z), so we convert it to true UTC
 * with the Europe/Madrid offset (+1 h winter, +2 h summer) before computing the position.
 * Output: elevation (deg, negative = night) and azimuth (deg from north, clockwise).
 */
const LAT = 41.3875;
const LON = 2.1143;
const RAD = Math.PI / 180;

/** Last Sunday of the month (UTC day-of-month) for DST switching. */
function lastSunday(year: number, month: number): number {
  const last = new Date(Date.UTC(year, month + 1, 0));
  return last.getUTCDate() - last.getUTCDay();
}

/** Europe/Madrid UTC offset in hours for a local-naive timestamp. */
export function madridOffsetH(localMs: number): number {
  const d = new Date(localMs);
  const y = d.getUTCFullYear();
  const start = Date.UTC(y, 2, lastSunday(y, 2), 3); // 02:00 -> 03:00 local
  const end = Date.UTC(y, 9, lastSunday(y, 9), 3); // 03:00 -> 02:00 local
  return localMs >= start && localMs < end ? 2 : 1;
}

export interface SunPos {
  elev: number;
  az: number;
}

export function sunAt(localMs: number): SunPos {
  const utcMs = localMs - madridOffsetH(localMs) * 3_600_000;
  const jd = utcMs / 86_400_000 + 2440587.5;
  const T = (jd - 2451545.0) / 36525;
  const L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360;
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C =
    Math.sin(M * RAD) * (1.914602 - T * (0.004817 + 0.000014 * T)) +
    Math.sin(2 * M * RAD) * (0.019993 - 0.000101 * T) +
    Math.sin(3 * M * RAD) * 0.000289;
  const trueLong = L0 + C;
  const omega = 125.04 - 1934.136 * T;
  const lambda = trueLong - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * RAD);
  const decl = Math.asin(Math.sin(eps * RAD) * Math.sin(lambda * RAD));
  const y = Math.tan((eps * RAD) / 2) ** 2;
  const eqTime =
    4 *
    (y * Math.sin(2 * L0 * RAD) -
      2 * e * Math.sin(M * RAD) +
      4 * e * y * Math.sin(M * RAD) * Math.cos(2 * L0 * RAD) -
      0.5 * y * y * Math.sin(4 * L0 * RAD) -
      1.25 * e * e * Math.sin(2 * M * RAD)) /
    RAD;
  const utcMin = (((utcMs % 86_400_000) + 86_400_000) % 86_400_000) / 60_000;
  const solarMin = (utcMin + eqTime + 4 * LON + 1440) % 1440;
  const ha = (solarMin / 4 - 180) * RAD;
  const lat = LAT * RAD;
  const sinEl = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(ha);
  const el = Math.asin(Math.max(-1, Math.min(1, sinEl)));
  const az = Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(lat) - Math.tan(decl) * Math.cos(lat));
  // atan2 form gives azimuth measured from south, positive to the west -> convert to north-clockwise
  const azN = (az / RAD + 180 + 360) % 360;
  return { elev: el / RAD, az: azN };
}
