#!/usr/bin/env node
/**
 * build-ground-data.mjs — turns the raw OSM extracts into public/data/ground.json:
 *   roads   : [{c: class, w: width_m, p: [[lon,lat],...]}]
 *   greens  : [{k: 'grass'|'wood'|'garden'|'pitch'|'park'|'parking', p: ring}]
 *   context : neighbouring (non-campus) buildings [{p: ring, h: height_m}]
 *   water   : [{p: ring}]
 *   (outer ring: run scripts/fetch-ground-outer.mjs first; see below)
 *   bbox    : [minLon, minLat, maxLon, maxLat] of the covered area
 * If data-raw/ground-wide-overpass.json exists the map covers that wider neighbourhood (roads, parks and buildings),
 * otherwise only the campus bbox. Refetch it with (query in data-raw/ground-wide-query.txt):
 *   curl --data-urlencode "data@data-raw/ground-wide-query.txt" https://overpass-api.de/api/interpreter -o data-raw/ground-wide-overpass.json
 * Data (c) OpenStreetMap contributors, ODbL.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (f) => JSON.parse(readFileSync(join(HERE, '..', f), 'utf8'));
const WIDE = existsSync(join(HERE, '..', 'data-raw/ground-wide-overpass.json'));
const ground = read(WIDE ? 'data-raw/ground-wide-overpass.json' : 'data-raw/ground-overpass.json');
const raw = WIDE ? ground : read('data-raw/campus-overpass.json');
const campus = read('public/data/campus.json');

// covered area: the wide query's bbox (south,west,north,east) or the campus bbox
const q = WIDE ? readFileSync(join(HERE, '..', 'data-raw/ground-wide-query.txt'), 'utf8').match(/\(([\d.]+),([\d.]+),([\d.]+),([\d.]+)\)/) : null;
const [IX0, IY0, IX1, IY1] = q ? [+q[2], +q[1], +q[4], +q[3]] : campus.bbox;
// optional light outer ring (major roads, water, big green areas; no buildings): data-raw/ground-outer-overpass.json,
// fetched by scripts/fetch-ground-outer.mjs. When present the covered area is that wider bbox.
const OUTER_FILE = join(HERE, '..', 'data-raw/ground-outer-overpass.json');
const outer = existsSync(OUTER_FILE) ? JSON.parse(readFileSync(OUTER_FILE, 'utf8')) : null;
const ob = outer ? read('data-raw/ground-outer-bbox.json') : null;
const [X0, Y0, X1, Y1] = ob ? [ob.west, ob.south, ob.east, ob.north] : [IX0, IY0, IX1, IY1];

/** Clip a polyline to the bbox (Liang-Barsky per segment) -> list of polylines. */
function clipLine(pts) {
  const out = [];
  let cur = [];
  for (let i = 0; i < pts.length - 1; i++) {
    let [x0, y0] = pts[i];
    let [x1, y1] = pts[i + 1];
    const dx = x1 - x0, dy = y1 - y0;
    let t0 = 0, t1 = 1;
    for (const [p, q] of [[-dx, x0 - X0], [dx, X1 - x0], [-dy, y0 - Y0], [dy, Y1 - y0]]) {
      if (p === 0) { if (q < 0) { t0 = 2; break; } }
      else { const r = q / p; if (p < 0) { if (r > t1) { t0 = 2; break; } if (r > t0) t0 = r; } else { if (r < t0) { t0 = 2; break; } if (r < t1) t1 = r; } }
    }
    if (t0 > t1) { if (cur.length > 1) out.push(cur); cur = []; continue; }
    const a = [x0 + t0 * dx, y0 + t0 * dy];
    const b = [x0 + t1 * dx, y0 + t1 * dy];
    if (cur.length === 0) cur.push(a);
    cur.push(b);
    if (t1 < 1) { out.push(cur); cur = []; }
  }
  if (cur.length > 1) out.push(cur);
  return out;
}

/** Sutherland-Hodgman clip of a ring against the bbox. */
function clipRing(ringPts) {
  let poly = ringPts.slice(0, -1);
  const edges = [
    (p) => p[0] >= X0, (p) => p[0] <= X1, (p) => p[1] >= Y0, (p) => p[1] <= Y1,
  ];
  const inter = (a, b, k) => {
    if (k === 0 || k === 1) { const x = k === 0 ? X0 : X1; const t = (x - a[0]) / (b[0] - a[0]); return [x, a[1] + t * (b[1] - a[1])]; }
    const y = k === 2 ? Y0 : Y1; const t = (y - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), y];
  };
  edges.forEach((inside, k) => {
    const inp = poly; poly = [];
    for (let i = 0; i < inp.length; i++) {
      const a = inp[i], b = inp[(i + 1) % inp.length];
      if (inside(b)) { if (!inside(a)) poly.push(inter(a, b, k)); poly.push(b); }
      else if (inside(a)) poly.push(inter(a, b, k));
    }
  });
  return poly.length >= 3 ? [...poly, poly[0]] : null;
}

const r6 = (n) => Math.round(n * 1e6) / 1e6;
const ring = (g) => g.map((q) => [r6(q.lon), r6(q.lat)]);

const WIDTH = { motorway: 16, trunk: 15, motorway_link: 8, trunk_link: 8, secondary_link: 6, tertiary_link: 6, primary: 13, primary_link: 7, tertiary: 9, secondary: 11, residential: 7, unclassified: 6, living_street: 6, service: 4.5, pedestrian: 5, footway: 2.4, cycleway: 2.6, path: 1.8, steps: 2 };
const roads = [];
const greens = [];
const water = [];
const seen = new Set();
/** Douglas-Peucker, tolerance in degrees */
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const st = [[0, pts.length - 1]];
  while (st.length) {
    const [i, j] = st.pop();
    let md = 0, mi = -1;
    const [ax, ay] = pts[i], [bx, by] = pts[j];
    const L = Math.hypot(bx - ax, by - ay) || 1e-12;
    for (let k = i + 1; k < j; k++) {
      const d = Math.abs((bx - ax) * (ay - pts[k][1]) - (ax - pts[k][0]) * (by - ay)) / L;
      if (d > md) { md = d; mi = k; }
    }
    if (md > tol && mi > 0) { keep[mi] = 1; st.push([i, mi], [mi, j]); }
  }
  return pts.filter((_, k) => keep[k]);
}
/** simplify a closed ring: split it in two halves so the first==last point does not collapse it */
function simplifyRing(r, tol) {
  const m = Math.floor(r.length / 2);
  const out = [...simplify(r.slice(0, m + 1), tol), ...simplify(r.slice(m), tol).slice(1)];
  return out.length >= 4 ? out : null;
}
const ringArea = (r) => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]); return Math.abs(a / 2) * 111000 * 83000; };
function addElements(elements, isOuter) {
for (const e of elements) {
  if (!e.geometry || e.geometry.length < 2) continue;
  if (isOuter ? seen.has(e.id) : (seen.add(e.id), false)) continue; // the detailed inner extract wins over the outer one
  const t = e.tags ?? {};
  if (t.building) continue; // buildings are handled below (context)
  if (t.natural === 'water') {
    let cp = e.geometry.length >= 4 ? clipRing(ring(e.geometry)) : null;
    if (cp && isOuter) cp = simplifyRing(cp, 3e-5);
    if (cp) water.push({ p: cp });
    continue;
  }
  if (t.highway) {
    if (!(t.highway in WIDTH) || t.tunnel === 'yes' || t.layer < 0) continue;
    for (const seg of clipLine(ring(e.geometry))) roads.push({ c: t.highway, w: WIDTH[t.highway], p: isOuter ? simplify(seg, 2e-5) : seg });
  } else {
    const k = t.amenity === 'parking' ? 'parking' : t.leisure === 'pitch' ? 'pitch' : t.leisure === 'garden' ? 'garden' : t.leisure === 'park' ? 'park' : t.natural === 'wood' || t.landuse === 'forest' ? 'wood' : 'grass';
    let cp = e.geometry.length >= 4 ? clipRing(ring(e.geometry)) : null;
    if (cp && isOuter) { cp = ringArea(cp) < 8000 ? null : simplifyRing(cp, 3e-5); }
    if (cp && cp.length >= 4) greens.push({ k, p: cp });
  }
}
}
addElements(ground.elements, false);
if (outer) addElements(outer.elements, true);

function inRing([x, y], rg) {
  let ins = false;
  for (let i = 0, j = rg.length - 1; i < rg.length; j = i++) {
    const [xi, yi] = rg[i], [xj, yj] = rg[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ins = !ins;
  }
  return ins;
}
const campusRings = [];
for (const f of campus.features) {
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const p of polys) campusRings.push(p[0]);
}
const context = [];
for (const e of raw.elements) {
  if (e.type !== 'way' || !e.geometry || e.geometry.length < 4 || !e.tags?.building) continue;
  const p = clipRing(ring(e.geometry));
  if (!p) continue;
  const c = p.reduce((a, q) => [a[0] + q[0] / p.length, a[1] + q[1] / p.length], [0, 0]);
  if (campusRings.some((r) => inRing(c, r))) continue;
  const lv = parseFloat(e.tags['building:levels'] ?? '');
  context.push({ p, h: Number.isFinite(lv) ? lv * 3.2 + 1 : 11 + ((Math.abs(Math.round(c[0] * 1e5)) % 7) * 1.5) });
}
writeFileSync(join(HERE, '..', 'public', 'data', 'ground.json'), JSON.stringify({ bbox: [X0, Y0, X1, Y1], roads, greens, water, context }));
console.log({ bbox: [X0, Y0, X1, Y1], outer: !!outer, wide: WIDE, roads: roads.length, greens: greens.length, water: water.length, context: context.length });
