/** Display formatters. Replay clock = local wall-clock stored as UTC ms, so UTC getters give local time. */
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const p2 = (n: number) => String(n).padStart(2, '0');

/** kW -> "123 kW" or "1.23 MW". */
export function fmtKw(kw: number): string {
  const a = Math.abs(kw);
  return a >= 1000 ? `${(kw / 1000).toFixed(2)} MW` : `${kw.toFixed(a < 10 ? 1 : 0)} kW`;
}

/** kW -> MW number string (unit shown by the caller). */
export function fmtMw(kw: number): string {
  return (kw / 1000).toFixed(2);
}

/** EUR amount -> "€12" / "€1.2k". */
export function fmtEur(eur: number): string {
  const a = Math.abs(eur);
  return a >= 1000 ? `€${(eur / 1000).toFixed(1)}k` : `€${eur.toFixed(a < 10 ? 2 : 0)}`;
}

/** "2025-09-01T00:00" -> "1 Sep". */
export function weekLabel(start: string): string {
  return `${+start.slice(8, 10)} ${MON[+start.slice(5, 7) - 1]}`;
}

/** Clock "HH:MM" at startMs + tMin minutes. */
export function clockAt(startMs: number, tMin: number): string {
  const d = new Date(startMs + tMin * 60_000);
  return `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
}

/** "Mon 1 Sep" at startMs + tMin minutes. */
export function dayLabelAt(startMs: number, tMin: number): string {
  const d = new Date(startMs + tMin * 60_000);
  return `${DOW[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]}`;
}
