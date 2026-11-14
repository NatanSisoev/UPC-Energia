/** Local metric frame (x east, y north, metres) around the campus + small geometry helpers. */
export type P2 = [number, number];

export const ORIGIN = { lon: 2.1143, lat: 41.3875 };
const MY = 111_320;
const MX = MY * Math.cos((ORIGIN.lat * Math.PI) / 180);

export const toLocal = ([lon, lat]: number[]): P2 => [(lon - ORIGIN.lon) * MX, (lat - ORIGIN.lat) * MY];
export const toLonLat = ([x, y]: number[]): P2 => [ORIGIN.lon + x / MX, ORIGIN.lat + y / MY];

export function area(ring: P2[]): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

/** Drop the repeated closing vertex, force counter-clockwise. */
export function normRing(ring: P2[]): P2[] {
  let r = ring.slice();
  const f = r[0];
  const l = r[r.length - 1];
  if (f[0] === l[0] && f[1] === l[1]) r = r.slice(0, -1);
  return area(r) < 0 ? r.reverse() : r;
}

export function inside(p: P2, ring: P2[]): boolean {
  let ins = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) ins = !ins;
  }
  return ins;
}

export function distToSeg(p: P2, a: P2, b: P2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy || 1e-12;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

export function distToRing(p: P2, ring: P2[]): number {
  let d = Infinity;
  for (let i = 0; i < ring.length; i++) d = Math.min(d, distToSeg(p, ring[i], ring[(i + 1) % ring.length]));
  return d;
}

/** Miter offset of a CCW ring: d > 0 grows outward, d < 0 shrinks (clamped miter). */
export function offsetRing(ring: P2[], d: number): P2[] {
  const n = ring.length;
  const out: P2[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = ring[(i + n - 1) % n];
    const p1 = ring[i];
    const p2 = ring[(i + 1) % n];
    const e1 = norm([p1[0] - p0[0], p1[1] - p0[1]]);
    const e2 = norm([p2[0] - p1[0], p2[1] - p1[1]]);
    // outward normals of a CCW ring are the edge directions rotated by -90deg
    const n1: P2 = [e1[1], -e1[0]];
    const n2: P2 = [e2[1], -e2[0]];
    let mx = n1[0] + n2[0];
    let my = n1[1] + n2[1];
    const ml = Math.hypot(mx, my);
    if (ml < 1e-6) {
      out.push([p1[0] + n1[0] * d, p1[1] + n1[1] * d]);
      continue;
    }
    mx /= ml;
    my /= ml;
    const k = Math.min(2.2, 1 / Math.max(0.2, mx * n1[0] + my * n1[1]));
    out.push([p1[0] + mx * d * k, p1[1] + my * d * k]);
  }
  return out;
}

function norm(v: P2): P2 {
  const l = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / l, v[1] / l];
}

export function centroid(ring: P2[]): P2 {
  let x = 0;
  let y = 0;
  for (const p of ring) {
    x += p[0];
    y += p[1];
  }
  return [x / ring.length, y / ring.length];
}

/** Rectangle (centre, size, rotation in radians) as a CCW ring. */
export function rect(cx: number, cy: number, w: number, h: number, ang = 0): P2[] {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  return ([[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]] as P2[]).map(([x, y]) => [
    cx + x * c - y * s,
    cy + x * s + y * c,
  ]);
}

export function regular(cx: number, cy: number, r: number, n: number, rot = 0): P2[] {
  return Array.from({ length: n }, (_, i): P2 => {
    const a = rot + (i / n) * Math.PI * 2;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  });
}

/** Convex hull (monotone chain), CCW. */
export function hull(pts: P2[]): P2[] {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: P2, a: P2, b: P2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: P2[] = [];
  for (const q of p) {
    while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop();
    lo.push(q);
  }
  const up: P2[] = [];
  for (const q of p.slice().reverse()) {
    while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop();
    up.push(q);
  }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

export const lonlatRing = (r: P2[]): P2[] => r.map(toLonLat);

/** polygon with z coordinate for deck (lon, lat, z). */
export const lonlat3 = (r: P2[], z: number): number[][] => r.map((p) => [...toLonLat(p), z]);
