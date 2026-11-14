/**
 * Static geometry of the diorama (streets, parks, detailed buildings with floors/windows/parapets/rooftop plant,
 * PV arrays, trees, substation, battery yard) + the per-frame deck.gl layer factory.
 * All geometry is generated deterministically from OpenStreetMap footprints (no randomness at runtime).
 */
import { SolidPolygonLayer, PathLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import type { BuildingFeature, CampusData, GroundData, LayerId, Snapshot, SolarCfg } from '../types';
import { hash } from '../data/scenario';
import {
  type P2,
  area,
  centroid,
  distToRing,
  hull,
  inside,
  lonlat3,
  lonlatRing,
  normRing,
  offsetRing,
  rect,
  regular,
  toLocal,
  toLonLat,
} from './geo';
import { buildNetwork, edgeFlows, along, type BuildingGeo, type Network } from './network';
import { roofKwp, occupancy } from '../sim/engine';
import type { PanelModelId } from '../types';
import { derived } from '../store/useSim';
import { weekMsAt } from '../lib/format';

type RGB = [number, number, number];
type RGBA = [number, number, number, number];

// ------------------------------------------------------------- palette ---

const FACADE: Record<string, RGB> = {
  teaching: [222, 211, 192],
  lab: [208, 212, 214],
  research: [232, 236, 240],
  data_center: [108, 116, 128],
  mixed: [186, 204, 216],
  library: [222, 198, 156],
  sports: [214, 160, 128],
  residence: [186, 120, 98],
  aux: [190, 188, 182],
};
/** Roof tint doubles as the usage colour-code of the map (see Legend). */
export const ROOF: Record<string, RGB> = {
  teaching: [91, 141, 239],
  lab: [160, 120, 235],
  research: [40, 196, 214],
  data_center: [244, 81, 108],
  mixed: [32, 190, 170],
  library: [72, 199, 142],
  sports: [245, 190, 40],
  residence: [250, 140, 60],
  aux: [130, 144, 166],
};
export const roofColor = (cat: string): RGB => ROOF[cat] ?? ROOF.aux;

const mixc = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const rgba = (c: RGB, a = 255): RGBA => [Math.round(c[0]), Math.round(c[1]), Math.round(c[2]), a];
const jit = (c: RGB, k: number, seed: string): RGB => {
  const v = (hash(seed) - 0.5) * 2 * k;
  return [c[0] + v, c[1] + v, c[2] + v];
};
/** 0 = deep night .. 1 = full day */
export const dayLevel = (elev: number) => Math.min(1, Math.max(0, (elev + 7) / 20));
/** Night tint for unlit (flat) layers. */
export function shade(c: RGB, k: number): RGB {
  return [c[0] * (0.46 + 0.54 * k), c[1] * (0.5 + 0.5 * k), c[2] * (0.68 + 0.32 * k)];
}

// -------------------------------------------------------------- items ---

interface PolyItem {
  polygon: number[][][];
  h: number;
  color: RGB;
  b?: number; // building index
  k?: number; // floor index
  n?: number; // floors
  lit?: number; // per-floor lit threshold [0,1)
}

export interface World {
  geos: BuildingGeo[];
  net: Network;
  props: BuildingFeature['properties'][];
  centers: P2[];
  nodeOfBuilding: number[];
  plate: PolyItem[];
  ground: Array<{ polygon: number[][]; color: RGB }>;
  roadCasing: Array<{ path: number[][]; w: number; color: RGB }>;
  roadAsphalt: Array<{ path: number[][]; w: number; color: RGB }>;
  roadMarks: Array<{ path: number[][] }>;
  /** pitch mowing stripes, line markings and running tracks (flat, lon/lat polygons) */
  pitchMarks: Array<{ polygon: number[][][]; color: RGB }>;
  /** street lamps (lon, lat) */
  lamps: Array<{ pos: number[] }>;
  /** roads cars drive on (local metres, cumulative length) and the cars themselves */
  carRoads: Array<{ pts: P2[]; cum: number[]; len: number; w: number }>;
  cars: Array<{ road: number; off: number; v: number; lane: number; dir: 1 | -1; color: RGB }>;
  context: PolyItem[];
  trees: Array<{ trunk: PolyItem; crown: PolyItem; crown2: PolyItem }>;
  plinths: PolyItem[];
  bodies: PolyItem[];
  bands: PolyItem[];
  parapets: PolyItem[];
  decks: PolyItem[];
  equip: PolyItem[];
  panelCands: PolyItem[][]; // per building
  fixtures: PolyItem[]; // cabinets, substation, battery pad (static)
  containers: Array<PolyItem & { idx: number }>;
  battery: { pos: P2; n: number };
  substation: P2;
  footprints: number[][][][]; // lonlat outline per building (for selection ring)
  shadowSrc: Array<{ pts: P2[]; h: number }>;
  contextShadow: Array<{ pts: P2[]; h: number }>;
  edgePaths: number[][][];
  edgeIdx: number[];
  /** weekly peak kW per building (window-light occupancy) */
  peaks: Float64Array;
  peakWeek: string;
  /** candidate standing spots per building (local metres), ordered by hash */
  peopleCand: P2[][];
  /** pseudo-random cloud clusters */
  clouds: Array<{ pos: P2; r: number; k: number; parts: Array<{ dx: number; dy: number; r: number }> }>;
}

const poly = (outer: P2[], z: number, holes: P2[][] = []): number[][][] => [lonlat3(outer, z), ...holes.map((h) => lonlat3(h, z))];

/** Rounded-rectangle ("stadium") outline: running tracks. Local metres, long axis along x before rotation. */
function stadium(cx: number, cy: number, len: number, wid: number, ang: number, n = 14): P2[] {
  const r = wid / 2;
  const s = Math.max(0, len / 2 - r);
  const pts: P2[] = [];
  for (let i = 0; i <= n; i++) {
    const a = -Math.PI / 2 + (i / n) * Math.PI;
    pts.push([s + r * Math.cos(a), r * Math.sin(a)]);
  }
  for (let i = 0; i <= n; i++) {
    const a = Math.PI / 2 + (i / n) * Math.PI;
    pts.push([-s + r * Math.cos(a), r * Math.sin(a)]);
  }
  const c = Math.cos(ang);
  const sn = Math.sin(ang);
  return pts.map(([x, y]): P2 => [cx + x * c - y * sn, cy + x * sn + y * c]);
}

/**
 * Deterministic ground dressing, all derived from the OSM ground data: striped pitches with line markings and
 * running tracks, street lamps along roads, and the cars (positions are animated per frame in buildLayers).
 */
function decorateGround(W: World, ground: GroundData, allRings: P2[][]): void {
  const flat = (ring: P2[]) => lonlatRing(ring).map((q) => [q[0], q[1]]);
  const inBuilding = (p: P2) => allRings.some((r) => inside(p, r));

  // ---- pitches
  ground.greens.forEach((g, gi) => {
    if (g.k !== 'pitch') return;
    const loc = g.p.map(toLocal);
    let best = 0;
    let ang = 0;
    for (let i = 0; i < loc.length; i++) {
      const a = loc[i];
      const b = loc[(i + 1) % loc.length];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L > best) {
        best = L;
        ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      }
    }
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    const rot = loc.map(([x, y]): P2 => [x * ca + y * sa, -x * sa + y * ca]);
    const xs = rot.map((q) => q[0]);
    const ys = rot.map((q) => q[1]);
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs);
    const y0 = Math.min(...ys);
    const y1 = Math.max(...ys);
    let w = x1 - x0;
    let h = y1 - y0;
    if (w < h) [w, h] = [h, w]; // keep the long axis first (rotation below follows the longest edge anyway)
    if (w * h < 300) return;
    const back = (x: number, y: number): P2 => [x * ca - y * sa, x * sa + y * ca];
    const [cx, cy] = back((x0 + x1) / 2, (y0 + y1) / 2);
    const W0 = x1 - x0;
    const H0 = y1 - y0;
    const push = (ring: P2[], color: RGB) => W.pitchMarks.push({ polygon: [flat(ring)], color });
    // mowing stripes
    const n = Math.max(4, Math.round(W0 / 4.5));
    // (each stripe is cut to the pitch outline: y-extent of the polygon at the stripe's x)
    const yRange = (sx: number): [number, number] | null => {
      let lo = Infinity;
      let hi = -Infinity;
      for (let k = 0; k < rot.length; k++) {
        const a = rot[k];
        const b = rot[(k + 1) % rot.length];
        if ((a[0] - sx) * (b[0] - sx) > 0 || a[0] === b[0]) continue;
        const y = a[1] + ((b[1] - a[1]) * (sx - a[0])) / (b[0] - a[0]);
        lo = Math.min(lo, y);
        hi = Math.max(hi, y);
      }
      return hi - lo > 2 ? [lo + 0.5, hi - 0.5] : null;
    };
    for (let i = 0; i < n; i += 2) {
      const sx = x0 + ((i + 0.5) * W0) / n;
      const yr = yRange(sx);
      if (!yr) continue;
      const [px, py] = back(sx, (yr[0] + yr[1]) / 2);
      push(rect(px, py, W0 / n, yr[1] - yr[0], ang), [112 + hashInt(`${gi}s${i}`, 6), 202, 96]);
    }
    // markings: touchlines, goal lines, halfway line, centre circle
    const line = (ax: number, ay: number, bx: number, by: number) => {
      const [mx, my] = back((ax + bx) / 2, (ay + by) / 2);
      push(rect(mx, my, Math.max(0.3, Math.abs(bx - ax)), Math.max(0.3, Math.abs(by - ay)), ang), [236, 242, 232]);
    };
    const ix = Math.min(1.6, W0 * 0.04);
    const iy = Math.min(1.6, H0 * 0.04);
    const lw = 0.32;
    line(x0 + ix, y0 + iy, x1 - ix, y0 + iy + lw);
    line(x0 + ix, y1 - iy - lw, x1 - ix, y1 - iy);
    line(x0 + ix, y0 + iy, x0 + ix + lw, y1 - iy);
    line(x1 - ix - lw, y0 + iy, x1 - ix, y1 - iy);
    const mxr = (x0 + x1) / 2;
    line(mxr - lw / 2, y0 + iy, mxr + lw / 2, y1 - iy);
    if (W0 * H0 > 1500) {
      const ring = (r: number, k: number): P2[] => {
        const c0 = back(mxr, (y0 + y1) / 2);
        return regular(c0[0], c0[1], r, 28, ang + k);
      };
      const rr = Math.min(H0 * 0.16, 9.15);
      W.pitchMarks.push({ polygon: [flat(ring(rr, 0)), flat(ring(rr - lw, 0))], color: [236, 242, 232] });
    }
    // running track around the big grounds (only if it stays clear of buildings)
    if (W0 > 70 && H0 > 28) {
      const outer = stadium(cx, cy, W0 + 22, H0 + 22, ang);
      const inner = stadium(cx, cy, W0 + 2, H0 + 2, ang);
      if (!outer.some((p) => inBuilding(p))) {
        W.pitchMarks.push({ polygon: [flat(outer), flat(inner)], color: [188, 92, 70] });
        for (let l = 1; l < 4; l++) {
          const o = stadium(cx, cy, W0 + 2 + l * 6.4 + 0.3, H0 + 2 + l * 6.4 + 0.3, ang);
          const i2 = stadium(cx, cy, W0 + 2 + l * 6.4, H0 + 2 + l * 6.4, ang);
          W.pitchMarks.push({ polygon: [flat(o), flat(i2)], color: [238, 226, 214] });
        }
      }
    }
  });

  // ---- street lamps and cars
  let carBudget = 80;
  ground.roads.forEach((r, ri) => {
    if (r.w < 4) return;
    const loc = r.p.map(toLocal);
    const cum = [0];
    for (let i = 1; i < loc.length; i++) cum.push(cum[i - 1] + Math.hypot(loc[i][0] - loc[i - 1][0], loc[i][1] - loc[i - 1][1]));
    const len = cum[cum.length - 1];
    if (len < 30) return;
    // lamps every ~32 m, alternating sides
    if (W.lamps.length < 900) {
      let side = 1;
      for (let s = 12; s < len; s += 32) {
        const [p, d] = pointAlong(loc, cum, s);
        const off = r.w / 2 + 1.6;
        const q: P2 = [p[0] - d[1] * off * side, p[1] + d[0] * off * side];
        side = -side;
        if (!inBuilding(q)) W.lamps.push({ pos: toLonLat(q) });
      }
    }
    // cars on the wider carriageways
    if (r.w >= 6 && carBudget > 0 && len >= 60) {
      const idx = W.carRoads.length;
      W.carRoads.push({ pts: loc, cum, len, w: r.w });
      const k = Math.min(carBudget, 1 + Math.floor(len / 70));
      for (let c = 0; c < k; c++) {
        const dir = hash(`cd${ri}${c}`) < 0.5 ? 1 : -1;
        W.cars.push({
          road: idx,
          off: hash(`co${ri}${c}`) * len,
          v: 5 + hash(`cv${ri}${c}`) * 5,
          lane: (dir === 1 ? 1 : -1) * Math.max(1.2, r.w * 0.22),
          dir,
          color: CAR_COLORS[Math.floor(hash(`cc${ri}${c}`) * CAR_COLORS.length)],
        });
      }
      carBudget -= k;
    }
  });
}

const CAR_COLORS: RGB[] = [[232, 232, 236], [40, 44, 56], [200, 48, 52], [60, 110, 200], [236, 190, 60], [120, 126, 138]];
const hashInt = (seed: string, span: number) => Math.round(hash(seed) * span);

/** Point and unit direction at distance s along a polyline with cumulative lengths. */
function pointAlong(pts: P2[], cum: number[], s: number): [P2, P2] {
  let i = 1;
  while (i < cum.length - 1 && cum[i] < s) i++;
  const a = pts[i - 1];
  const b = pts[i];
  const L = Math.max(1e-9, cum[i] - cum[i - 1]);
  const u = Math.min(1, Math.max(0, (s - cum[i - 1]) / L));
  return [[a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u], [(b[0] - a[0]) / L, (b[1] - a[1]) / L]];
}

// ---------------------------------------------------------- the build ---

export function buildWorld(campus: CampusData, ground: GroundData): World {
  const props = campus.features.map((f) => f.properties);
  const geos: BuildingGeo[] = campus.features.map((f) => {
    const polys = (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates) as number[][][][];
    return {
      rings: polys.map((p) => normRing(p[0].map((c) => toLocal(c)))),
      holes: polys.map((p) => p.slice(1).map((r) => normRing(r.map((c) => toLocal(c))).reverse())),
    };
  });
  const net = buildNetwork(campus.features, geos, campus.substation, campus.batterySite);
  const nodeOfBuilding = campus.features.map((_, i) => i + 2);
  const centers = geos.map((g) => centroid(g.rings.reduce((a, r) => (r.length > a.length ? r : a), g.rings[0])));
  const allRings = geos.flatMap((g) => g.rings);

  const W: World = {
    geos,
    net,
    props,
    centers,
    nodeOfBuilding,
    plate: [],
    ground: [],
    roadCasing: [],
    roadAsphalt: [],
    roadMarks: [],
    pitchMarks: [],
    lamps: [],
    carRoads: [],
    cars: [],
    context: [],
    trees: [],
    plinths: [],
    bodies: [],
    bands: [],
    parapets: [],
    decks: [],
    equip: [],
    panelCands: [],
    fixtures: [],
    containers: [],
    battery: { pos: toLocal(campus.batterySite), n: 4 },
    substation: toLocal(campus.substation),
    footprints: [],
    shadowSrc: [],
    contextShadow: [],
    edgePaths: net.edges.map((e) => e.path.map(toLonLat)),
    edgeIdx: net.edges.map((_, i) => i),
    peaks: new Float64Array(props.length),
    peakWeek: '',
    peopleCand: [],
    clouds: [],
  };

  // ---- diorama plate
  {
    const [x0, y0, x1, y1] = campus.bbox;
    const a = toLocal([x0, y0]);
    const b = toLocal([x1, y1]);
    const ring: P2[] = [a, [b[0], a[1]], b, [a[0], b[1]]];
    W.plate.push({ polygon: poly(ring, -14), h: 14, color: [92, 72, 58] });
  }

  // ---- ground cover
  const GREEN: Record<string, RGB> = {
    grass: [128, 196, 78],
    park: [116, 190, 72],
    garden: [104, 184, 84],
    wood: [78, 158, 64],
    pitch: [64, 176, 84],
    parking: [168, 170, 178],
  };
  for (const g of ground.greens) {
    W.ground.push({ polygon: g.p.map((q) => [q[0], q[1]]), color: jit(GREEN[g.k] ?? GREEN.grass, 5, `${g.p[0][0]}`) });
  }
  const casing: RGB = [222, 220, 212];
  const asphalt: RGB = [136, 142, 154];
  const path: RGB = [236, 226, 200];
  for (const r of ground.roads) {
    const pts = r.p.map((q) => [q[0], q[1]]);
    if (r.w >= 4) {
      W.roadCasing.push({ path: pts, w: r.w + 3.6, color: casing });
      W.roadAsphalt.push({ path: pts, w: r.w, color: asphalt });
      if (r.w >= 7) {
        // dashed centre line
        const loc = r.p.map(toLocal);
        let on = true;
        let acc = 0;
        let cur: P2[] = [loc[0]];
        for (let i = 0; i < loc.length - 1; i++) {
          const a = loc[i];
          const b = loc[i + 1];
          const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
          let d = 0;
          while (d < L) {
            const step = Math.min(L - d, (on ? 5 : 6) - acc);
            d += step;
            acc += step;
            const p: P2 = [a[0] + ((b[0] - a[0]) * d) / L, a[1] + ((b[1] - a[1]) * d) / L];
            if (on) cur.push(p);
            if (acc >= (on ? 5 : 6) - 1e-6) {
              if (on && cur.length > 1) W.roadMarks.push({ path: cur.map(toLonLat) });
              on = !on;
              acc = 0;
              cur = [p];
            }
          }
        }
      }
    } else {
      W.roadAsphalt.push({ path: pts, w: r.w, color: path });
    }
  }

  decorateGround(W, ground, allRings);

  // ---- context buildings (neighbourhood)
  for (const c of ground.context) {
    const ring = normRing(c.p.map(toLocal));
    if (ring.length < 3 || area(ring) < 20) continue;
    const seed = `${c.p[0][0]}${c.p[0][1]}`;
    W.context.push({ polygon: poly(ring, 0), h: c.h, color: jit([206, 199, 189], 10, seed) });
    W.context.push({ polygon: poly(offsetRing(ring, -0.5), c.h), h: 0.6, color: [150, 146, 142] });
    W.contextShadow.push({ pts: ring, h: c.h });
  }

  // ---- campus buildings
  const axis = net.axis;
  const ca = Math.cos(axis);
  const sa = Math.sin(axis);
  props.forEach((p, bi) => {
    const g = geos[bi];
    const base = jit(FACADE[p.category] ?? FACADE.aux, 7, p.osmId);
    const H = Math.max(3.5, p.height_m);
    const floors = Math.max(1, Math.min(16, Math.round(p.levels ?? (H - 1) / 3.6)));
    const fh = (H - 1) / floors;
    const glazing = p.category === 'data_center' ? 0 : p.category === 'sports' ? 0.28 : p.category === 'residence' ? 0.42 : 0.58;
    W.panelCands.push([]);
    const fp: number[][][] = [];
    g.rings.forEach((outer, pi) => {
      const holes = g.holes[pi];
      fp.push(lonlat3(outer, 0.4));
      W.plinths.push({ polygon: poly(offsetRing(outer, 0.3), 0, holes), h: 1.0, color: mixc(base, [90, 90, 96], 0.55), b: bi });
      W.bodies.push({ polygon: poly(outer, 0.9, holes), h: H - 0.9, color: base, b: bi });
      W.shadowSrc.push({ pts: outer, h: H });
      if (glazing > 0) {
        const wring = offsetRing(outer, 0.14);
        for (let k = 0; k < floors; k++) {
          const z0 = 1.0 + k * fh + fh * (0.5 - glazing / 2) * 0.9 + 0.1;
          W.bands.push({
            polygon: poly(wring, z0),
            h: fh * glazing,
            color: [0, 0, 0],
            b: bi,
            k,
            n: floors,
            lit: hash(`${p.osmId}w${pi}${k}`),
          });
        }
      } else {
        // louvred plant hall: dark vertical vents
        const wring = offsetRing(outer, 0.12);
        W.bands.push({ polygon: poly(wring, 2.2), h: Math.max(1, H - 5), color: [0, 0, 0], b: bi, k: 0, n: 1, lit: 0.5 });
      }
      // parapet + roof deck (sunken)
      const inner = offsetRing(outer, -0.55);
      W.parapets.push({ polygon: poly(offsetRing(outer, 0.12), H - 0.1, [inner.slice().reverse()]), h: 1.0, color: mixc(base, [255, 255, 255], 0.15), b: bi });
      W.decks.push({ polygon: poly(inner, H - 0.1), h: 0.35, color: mixc(roofColor(p.category), [180, 180, 184], 0.45), b: bi });

      // rooftop plant: stair core, lift motor-room, AC condensers
      const ar = area(outer);
      const eq: P2[] = [];
      const tryPlace = (w: number, d: number, hh: number, col: RGB, seed: string, margin = 3) => {
        for (let t = 0; t < 16; t++) {
          const rx = hash(`${seed}x${t}`);
          const ry = hash(`${seed}y${t}`);
          const xs = outer.map((q) => q[0]);
          const ys = outer.map((q) => q[1]);
          const c: P2 = [
            Math.min(...xs) + rx * (Math.max(...xs) - Math.min(...xs)),
            Math.min(...ys) + ry * (Math.max(...ys) - Math.min(...ys)),
          ];
          if (!inside(c, outer) || distToRing(c, outer) < margin) continue;
          if (holes.some((h) => inside(c, h.slice().reverse()))) continue;
          if (eq.some((e) => Math.hypot(e[0] - c[0], e[1] - c[1]) < 6)) continue;
          eq.push(c);
          W.equip.push({ polygon: poly(rect(c[0], c[1], w, d, axis), H + 0.2), h: hh, color: col, b: bi });
          return;
        }
      };
      if (ar > 160) {
        tryPlace(4.5, 4, 2.8, [196, 198, 204], `${p.osmId}stair${pi}`, 4);
        const nAc = Math.min(6, 1 + Math.floor(ar / 400));
        for (let i = 0; i < nAc; i++) tryPlace(2.4, 1.6, 1.3, [160, 166, 174], `${p.osmId}ac${pi}${i}`, 2.5);
        if (p.category === 'data_center' || p.category === 'research') {
          tryPlace(6, 2.6, 2.2, [120, 130, 142], `${p.osmId}chill${pi}`, 3);
          tryPlace(6, 2.6, 2.2, [120, 130, 142], `${p.osmId}chillb${pi}`, 3);
        }
      }

      // PV array candidates: rows aligned with the street grid
      if (p.pv_fraction > 0 && ar > 120) {
        const cs = geoRot(outer, -axis);
        const minX = Math.min(...cs.map((q) => q[0]));
        const maxX = Math.max(...cs.map((q) => q[0]));
        const minY = Math.min(...cs.map((q) => q[1]));
        const maxY = Math.max(...cs.map((q) => q[1]));
        const holesRot = holes.map((h) => geoRot(h, -axis));
        for (let y = minY + 2; y < maxY - 2; y += 3.5) {
          for (let x = minX + 2; x < maxX - 2; x += 4.6) {
            const cr: P2 = [x + 2.1, y + 0.95];
            const corners: P2[] = [[x, y], [x + 4.2, y], [x + 4.2, y + 1.9], [x, y + 1.9]];
            if (!corners.every((q) => inside(q, cs) && distToRing(q, cs) > 1.5)) continue;
            if (holesRot.some((h) => corners.some((q) => inside(q, h)))) continue;
            const wc: P2 = [cr[0] * ca - cr[1] * sa, cr[0] * sa + cr[1] * ca];
            if (eq.some((e) => Math.hypot(e[0] - wc[0], e[1] - wc[1]) < 3.6)) continue;
            W.panelCands[bi].push({ polygon: poly(rect(wc[0], wc[1], 4.2, 1.9, axis), H + 0.4), h: 0.8, color: [30, 58, 110], b: bi });
          }
        }
      }
    });
    W.footprints.push(fp);
  });

  // ---- people: standing spots on plazas around each building (outside the footprint, off the roads is not known -> near walls)
  props.forEach((p, bi) => {
    const ring = geos[bi].rings.reduce((a, r) => (r.length > a.length ? r : a), geos[bi].rings[0]);
    const cap = p.category === 'data_center' ? 12 : Math.min(160, Math.round((p.area_m2 * (p.levels ?? p.height_m / 3.5)) / 38));
    const out: P2[] = [];
    const xs = ring.map((q) => q[0]);
    const ys = ring.map((q) => q[1]);
    for (let t = 0; out.length < cap && t < cap * 14; t++) {
      const c: P2 = [
        Math.min(...xs) - 9 + hash(`${p.osmId}px${t}`) * (Math.max(...xs) - Math.min(...xs) + 18),
        Math.min(...ys) - 9 + hash(`${p.osmId}py${t}`) * (Math.max(...ys) - Math.min(...ys) + 18),
      ];
      if (allRings.some((r) => inside(c, r))) continue;
      if (distToRing(c, ring) > 9) continue;
      out.push(c);
    }
    W.peopleCand.push(out);
  });

  // ---- clouds
  for (let i = 0; i < 18; i++) {
    const parts = Array.from({ length: 6 }, (_, j) => ({ dx: (hash(`cd${i}${j}`) - 0.5) * 110, dy: (hash(`ce${i}${j}`) - 0.5) * 50, r: 20 + hash(`cr${i}${j}`) * 30 }));
    W.clouds.push({ pos: [-420 + hash(`cx${i}`) * 840, -380 + hash(`cy${i}`) * 760], r: 0, k: (i + 0.5) / 18, parts });
  }

  // ---- trees inside green areas (deterministic jittered grid)
  const treeAreas = ground.greens.filter((g) => g.k !== 'pitch' && g.k !== 'parking');
  let count = 0;
  for (const g of treeAreas) {
    if (count > 2200) break;
    const ring = normRing(g.p.map(toLocal));
    if (ring.length < 3 || area(ring) < 60) continue;
    const xs = ring.map((q) => q[0]);
    const ys = ring.map((q) => q[1]);
    const sp = g.k === 'wood' ? 5 : 7.2;
    for (let x = Math.min(...xs); x < Math.max(...xs); x += sp) {
      for (let y = Math.min(...ys); y < Math.max(...ys); y += sp) {
        const c: P2 = [x + (hash(`tx${x.toFixed(1)}${y.toFixed(1)}`) - 0.5) * sp * 0.8, y + (hash(`ty${x.toFixed(1)}${y.toFixed(1)}`) - 0.5) * sp * 0.8];
        if (!inside(c, ring) || distToRing(c, ring) < 1.5) continue;
        if (allRings.some((r) => inside(c, r) || distToRing(c, r) < 3.2)) continue;
        if (hash(`tk${c[0].toFixed(1)}${c[1].toFixed(1)}`) < 0.1) continue;
        const r = 2.1 + hash(`tr${c[0].toFixed(1)}`) * 2.1;
        const th = 3.2 + hash(`th${c[1].toFixed(1)}`) * 4.2;
        const col = jit(mixc([70, 150, 70], [132, 190, 70], hash(`tc${c[0].toFixed(1)}`)), 8, `tj${c[1].toFixed(1)}`);
        W.trees.push({
          trunk: { polygon: poly(rect(c[0], c[1], 0.5, 0.5), 0), h: 2.4, color: [96, 70, 52] },
          crown: { polygon: poly(regular(c[0], c[1], r, 9, hash(`tq${c[0].toFixed(1)}`) * 3), 1.8), h: th * 0.62, color: col },
          crown2: { polygon: poly(regular(c[0], c[1], r * 0.62, 8), 1.8 + th * 0.55), h: th * 0.4, color: mixc(col, [255, 255, 220], 0.14) },
        });
        count++;
      }
    }
  }

  // ---- service cabinets at every entrance
  net.nodes.forEach((nd) => {
    if (nd.kind !== 'bld') return;
    W.fixtures.push({ polygon: poly(rect(nd.pos[0], nd.pos[1], 1.6, 1.1, axis), 0), h: 1.3, color: [64, 170, 214] });
  });

  // ---- substation compound
  {
    const [sx, sy] = W.substation;
    W.fixtures.push({ polygon: poly(rect(sx, sy, 24, 17, axis), 0), h: 0.35, color: [150, 152, 158] });
    for (let i = 0; i < 3; i++) {
      const off = (i - 1) * 6.6;
      const cx = sx + off * ca - 2.6 * sa;
      const cy = sy + off * sa + 2.6 * ca;
      W.fixtures.push({ polygon: poly(rect(cx, cy, 4.6, 3.4, axis), 0.35), h: 4.2, color: [86, 98, 118] });
      for (let f = 0; f < 5; f++) {
        const fo = -1.9 + f * 0.95;
        W.fixtures.push({ polygon: poly(rect(cx + fo * ca - 2.1 * -sa, cy + fo * sa - 2.1 * ca, 0.28, 0.9, axis), 0.8), h: 3.2, color: [60, 70, 86] });
      }
      W.fixtures.push({ polygon: poly(rect(cx, cy, 1.1, 1.1, axis), 4.55), h: 1.5, color: [210, 214, 220] });
    }
    // control building + gantry posts
    W.fixtures.push({ polygon: poly(rect(sx + 8 * ca + 4 * sa * -1, sy + 8 * sa + 4 * ca * -1 + 0, 5.5, 4.2, axis), 0.35), h: 3.4, color: [212, 206, 196] });
    for (const [gx, gy] of [[-9, -6], [9, -6], [-9, 6], [9, 6]]) {
      W.fixtures.push({ polygon: poly(rect(sx + gx * ca - gy * sa, sy + gx * sa + gy * ca, 0.5, 0.5, axis), 0.35), h: 9, color: [170, 176, 186] });
    }
  }

  // ---- battery yard: container count follows installed capacity (updated by the layer factory)
  {
    const [bx, by] = W.battery.pos;
    W.fixtures.push({ polygon: poly(rect(bx, by, 30, 16, axis), 0), h: 0.3, color: [132, 136, 142] });
    for (let i = 0; i < 10; i++) {
      const col = i % 5;
      const row = Math.floor(i / 5);
      const lx = (col - 2) * 6.0;
      const ly = (row - 0.5) * 5.4;
      W.containers.push({
        polygon: poly(rect(bx + lx * ca - ly * sa, by + lx * sa + ly * ca, 5.8, 2.44, axis), 0.3),
        h: 2.9,
        color: [236, 240, 244],
        idx: i,
      });
    }
  }
  return W;
}

function geoRot(ring: P2[], a: number): P2[] {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return ring.map(([x, y]) => [x * c - y * s, x * s + y * c]);
}

// ---------------------------------------------------------------- layers ---

export interface Frame {
  snap: Snapshot | null;
  phase: number; // 0..1 cable pulse phase
  /** wall-clock seconds (visual animation only: cars) */
  clock: number;
  version: number;
  solar: Record<string, SolarCfg>;
  panel: PanelModelId;
  selection: string | null;
  underground: boolean;
  hoverId: string | null;
  fleetKwh: number;
  layers: Record<LayerId, boolean>;
}

interface Memo {
  version: number;
  panels: PolyItem[];
  flowsHour: number;
  flowKey: string;
  flows: Float64Array;
  shadowKey: string;
  shadows: Array<{ polygon: number[][][] }>;
}
const memo: Memo = { version: -1, panels: [], flowsHour: -1, flowKey: '', flows: new Float64Array(0), shadowKey: '', shadows: [] };

const FLAT = { depthCompare: 'always', depthWriteEnabled: false } as never;
const MAT = { ambient: 0.62, diffuse: 0.55, shininess: 28, specularColor: [200, 210, 225] } as never;
const MAT_MATTE = { ambient: 0.7, diffuse: 0.45, shininess: 6, specularColor: [90, 90, 90] } as never;

/** Cable colour language: grid import = ember, back-feed = lime, battery = violet. */
const C_IMPORT: RGB = [255, 132, 80];
const C_EXPORT: RGB = [164, 232, 92];
const C_BATT: RGB = [176, 140, 255];

export function buildLayers(W: World, f: Frame, onHover: (id: string | null, x: number, y: number) => void, onClick: (id: string | null) => void) {
  const snap = f.snap;
  const elev = snap?.sunElev ?? 30;
  const day = dayLevel(elev);
  const kq = Math.round(day * 16);
  const hour = snap?.hour ?? 0;
  const hourKey = `${f.version}:${hour}`;

  // --- visible PV panels (depends only on solar config)
  if (memo.version !== f.version) {
    memo.version = f.version;
    const out: PolyItem[] = [];
    W.props.forEach((p, bi) => {
      const cfg = f.solar[p.osmId];
      if (!cfg?.on || cfg.fraction <= 0) return;
      const cands = W.panelCands[bi];
      const n = Math.round(cands.length * Math.min(1, cfg.fraction / 0.6));
      const hh = 0.45 + cfg.tilt * 0.035;
      for (let i = 0; i < n; i++) out.push({ ...cands[i], h: hh });
    });
    memo.panels = out;
    void roofKwp;
  }

  // --- cable flows (once per sim hour)
  if (snap && memo.flowKey !== hourKey) {
    memo.flowKey = hourKey;
    const nn = new Float64Array(W.net.nodes.length);
    W.props.forEach((p, i) => {
      const pt = snap.perB[p.osmId];
      nn[W.nodeOfBuilding[i]] = pt ? pt.loadKw - pt.solarKw : 0;
    });
    nn[1] = snap.battKw;
    memo.flows = edgeFlows(W.net, nn);
  }
  const flows = memo.flows;
  const edgeColor = (i: number): RGB => {
    const fl = flows[i] ?? 0;
    if (W.net.edges[i].to === 1) return C_BATT;
    return fl >= 0 ? C_IMPORT : C_EXPORT;
  };

  // --- projected shadows (once per sim hour)
  const shKey = `${Math.round(snap?.sunAz ?? 0)}:${Math.round(elev)}`;
  if (memo.shadowKey !== shKey) {
    memo.shadowKey = shKey;
    memo.shadows = [];
    if (elev > 2.5) {
      const az = ((snap?.sunAz ?? 180) * Math.PI) / 180;
      const t = 1 / Math.tan((Math.max(elev, 6) * Math.PI) / 180);
      const dx = -Math.sin(az) * t;
      const dy = -Math.cos(az) * t;
      const src = [...W.shadowSrc, ...W.contextShadow];
      for (const s of src) {
        const L = Math.min(s.h * 1, 70);
        const pts = s.pts.concat(s.pts.map(([x, y]): P2 => [x + dx * L, y + dy * L]));
        memo.shadows.push({ polygon: [lonlat3(hull(pts), 0.05)] });
      }
    }
  }

  const dv = derived.current;
  if (dv && W.peakWeek !== dv.week.start) {
    W.peakWeek = dv.week.start;
    for (let b = 0; b < W.props.length; b++) {
      let m = 0;
      for (let h = 0; h < 168; h++) m = Math.max(m, dv.shares[b * 168 + h] * dv.week.load[h]);
      W.peaks[b] = m;
    }
  }
  const sel = f.selection;
  const hov = f.hoverId;

  // ---------- window glass ----------
  const winColor = (d: PolyItem): RGBA => {
    const p = W.props[d.b!];
    const pt = snap?.perB[p.osmId];
    const peak = Math.max(1, W.peaks[d.b!]);
    const occ = Math.min(1, (pt?.loadKw ?? 0) / peak);
    const night = 1 - day;
    const lit = night > 0.25 && (d.lit ?? 0) < Math.pow(occ, 0.8) * 0.92 + 0.05;
    const glassDay = mixc([86, 120, 150], [170, 200, 224], Math.min(1, Math.max(0, elev / 60)) * 0.7);
    const glassNight: RGB = [28, 40, 66];
    const glass = mixc(glassNight, glassDay, day);
    if (lit) return rgba(mixc(glass, [255, 214, 138], Math.min(1, night * 1.25)), 255);
    return rgba(glass, 255);
  };

  const layers: unknown[] = [];

  // diorama slab + base
  layers.push(
    new SolidPolygonLayer<PolyItem>({
      id: 'plate',
      data: W.plate,
      extruded: true,
      getPolygon: (d) => d.polygon as never,
      getElevation: (d) => d.h,
      getFillColor: (d) => rgba(shade(d.color, day)) as never,
      material: MAT_MATTE,
      updateTriggers: { getFillColor: [kq] },
    }),
  );
  layers.push(
    new SolidPolygonLayer({
      id: 'base',
      data: [{ polygon: W.plate[0].polygon.map((r) => r.map((q) => [q[0], q[1]])) }],
      getPolygon: (d: { polygon: number[][][] }) => d.polygon as never,
      getFillColor: rgba(shade([206, 204, 190], day)) as never,
      parameters: FLAT,
      updateTriggers: { getFillColor: [kq] },
    }),
    new SolidPolygonLayer({
      id: 'greens',
      data: W.ground,
      getPolygon: (d: { polygon: number[][] }) => d.polygon as never,
      getFillColor: (d: { color: RGB }) => rgba(shade(d.color, day)) as never,
      parameters: FLAT,
      updateTriggers: { getFillColor: [kq] },
    }),
    new PathLayer({
      id: 'road-casing',
      data: W.roadCasing,
      getPath: (d: { path: number[][] }) => d.path as never,
      getWidth: (d: { w: number }) => d.w,
      getColor: (d: { color: RGB }) => rgba(shade(d.color, day)) as never,
      widthUnits: 'meters',
      capRounded: true,
      jointRounded: true,
      parameters: FLAT,
      updateTriggers: { getColor: [kq] },
    }),
    new PathLayer({
      id: 'road-asphalt',
      data: W.roadAsphalt,
      getPath: (d: { path: number[][] }) => d.path as never,
      getWidth: (d: { w: number }) => d.w,
      getColor: (d: { color: RGB }) => rgba(shade(d.color, day)) as never,
      widthUnits: 'meters',
      capRounded: true,
      jointRounded: true,
      parameters: FLAT,
      updateTriggers: { getColor: [kq] },
    }),
    new PathLayer({
      id: 'road-marks',
      data: W.roadMarks,
      getPath: (d: { path: number[][] }) => d.path as never,
      getWidth: 0.28,
      getColor: rgba(shade([236, 232, 210], day)) as never,
      widthUnits: 'meters',
      parameters: FLAT,
      updateTriggers: { getColor: [kq] },
    }),
    new SolidPolygonLayer({
      id: 'pitch-marks',
      data: W.pitchMarks,
      getPolygon: (d: { polygon: number[][][] }) => d.polygon as never,
      getFillColor: (d: { color: RGB }) => rgba(shade(d.color, day)) as never,
      parameters: FLAT,
      updateTriggers: { getFillColor: [kq] },
    }),
  );

  // --- cars (animated by wall clock) and street lamps (lit after dusk)
  {
    const night = 1 - day;
    const cars: Array<{ pos: number[]; color: RGB; head: number[] }> = [];
    for (const c of W.cars) {
      const road = W.carRoads[c.road];
      const s0 = (c.off + c.v * f.clock) % road.len;
      const s = c.dir === 1 ? s0 : road.len - s0;
      const [p, d] = pointAlong(road.pts, road.cum, s);
      const q: P2 = [p[0] - d[1] * c.lane, p[1] + d[0] * c.lane];
      const ahead: P2 = [q[0] + d[0] * c.dir * 2.6, q[1] + d[1] * c.dir * 2.6];
      cars.push({ pos: toLonLat(q), color: c.color, head: toLonLat(ahead) });
    }
    layers.push(
      new ScatterplotLayer({
        id: 'cars',
        data: cars,
        getPosition: (d: { pos: number[] }) => d.pos as never,
        getRadius: 2.3,
        radiusUnits: 'meters',
        getFillColor: (d: { color: RGB }) => [...shade(d.color, Math.max(0.35, day)), 255] as never,
        parameters: FLAT,
        updateTriggers: { getFillColor: [kq] },
      }),
    );
    if (night > 0.25) {
      layers.push(
        new ScatterplotLayer({
          id: 'headlights',
          data: cars,
          getPosition: (d: { head: number[] }) => d.head as never,
          getRadius: 2.6,
          radiusUnits: 'meters',
          getFillColor: [255, 236, 170, Math.round(150 * night)] as never,
          parameters: FLAT,
          updateTriggers: { getFillColor: [kq] },
        }),
      );
    }
    if (night > 0.2) {
      layers.push(
        new ScatterplotLayer({
          id: 'lamp-pools',
          data: W.lamps,
          getPosition: (d: { pos: number[] }) => d.pos as never,
          getRadius: 12,
          radiusUnits: 'meters',
          getFillColor: [255, 196, 96, Math.round(15 * night)] as never,
          parameters: FLAT,
          updateTriggers: { getFillColor: [kq] },
        }),
        new ScatterplotLayer({
          id: 'lamp-pools-core',
          data: W.lamps,
          getPosition: (d: { pos: number[] }) => d.pos as never,
          getRadius: 6,
          radiusUnits: 'meters',
          getFillColor: [255, 204, 110, Math.round(34 * night)] as never,
          parameters: FLAT,
          updateTriggers: { getFillColor: [kq] },
        }),
        new ScatterplotLayer({
          id: 'lamp-cores',
          data: W.lamps,
          getPosition: (d: { pos: number[] }) => d.pos as never,
          getRadius: 1.1,
          radiusUnits: 'meters',
          getFillColor: [255, 238, 190, Math.round(255 * Math.min(1, night * 1.4))] as never,
          parameters: FLAT,
          updateTriggers: { getFillColor: [kq] },
        }),
      );
    }
  }

  // --- underground cable trenches (drawn into the street surface, below everything standing)
  const cableLayers = () => {
    const ug = f.underground;
    const lw = (i: number) => 0.9 + Math.min(1.9, Math.abs(flows[i] ?? 0) / 700) * (ug ? 1.5 : 1);
    return [
      new PathLayer({
        id: 'trench',
        data: W.edgeIdx,
        getPath: (i: number) => W.edgePaths[i] as never,
        getWidth: 3.6,
        getColor: rgba(shade([74, 58, 46], day)) as never,
        widthUnits: 'meters',
        capRounded: true,
        jointRounded: true,
        parameters: FLAT,
        updateTriggers: { getColor: [kq] },
      }),
      new PathLayer({
        id: 'duct',
        data: W.edgeIdx,
        getPath: (i: number) => W.edgePaths[i] as never,
        getWidth: 2.3,
        getColor: rgba(shade([128, 116, 104], day)) as never,
        widthUnits: 'meters',
        capRounded: true,
        jointRounded: true,
        parameters: FLAT,
        updateTriggers: { getColor: [kq] },
      }),
      new PathLayer({
        id: 'cable-glow',
        data: W.edgeIdx,
        getPath: (i: number) => W.edgePaths[i] as never,
        getWidth: (i: number) => lw(i) * 3.4,
        getColor: (i: number) => [...edgeColor(i), Math.abs(flows[i] ?? 0) > 5 ? (ug ? 96 : 54) : 0] as never,
        widthUnits: 'meters',
        capRounded: true,
        jointRounded: true,
        parameters: FLAT,
        updateTriggers: { getWidth: [hourKey, ug], getColor: [hourKey, ug] },
      }),
      new PathLayer({
        id: 'cable-core',
        data: W.edgeIdx,
        getPath: (i: number) => W.edgePaths[i] as never,
        getWidth: lw,
        getColor: (i: number) => (Math.abs(flows[i] ?? 0) > 5 ? [...edgeColor(i), 255] : [128, 128, 138, 255]) as never,
        widthUnits: 'meters',
        capRounded: true,
        jointRounded: true,
        parameters: FLAT,
        updateTriggers: { getWidth: [hourKey, ug], getColor: [hourKey] },
      }),
    ];
  };
  const showCables = f.layers.cables || f.underground;
  if (showCables) layers.push(...cableLayers());

  // manholes
  if (showCables) layers.push(
    new ScatterplotLayer({
      id: 'manholes',
      data: W.net.manholes,
      getPosition: (p: P2) => [...toLonLat(p), 0] as never,
      getRadius: 1.7,
      radiusUnits: 'meters',
      getFillColor: rgba(shade([46, 46, 54], day)) as never,
      getLineColor: rgba(shade([170, 170, 178], day)) as never,
      stroked: true,
      getLineWidth: 0.35,
      lineWidthUnits: 'meters',
      parameters: FLAT,
      updateTriggers: { getFillColor: [kq], getLineColor: [kq] },
    }),
  );

  // pulses travelling through the ducts
  if (snap && showCables) {
    const pulses: Array<{ pos: number[]; color: RGB; r: number }> = [];
    W.net.edges.forEach((e, i) => {
      const fl = flows[i] ?? 0;
      const a = Math.abs(fl);
      if (a < 5) return;
      const reps = Math.max(1, Math.min(7, Math.round(e.len / 18)));
      const dir = fl >= 0 ? 1 : -1;
      for (let k = 0; k < reps; k++) {
        let t = (f.phase * (0.5 + Math.min(2, a / 600)) + k / reps) % 1;
        if (dir < 0) t = 1 - t;
        pulses.push({ pos: [...toLonLat(along(e.path, e.len, t)), 0.1], color: edgeColor(i), r: 0.9 + Math.min(1.5, a / 900) });
      }
    });
    layers.push(
      new ScatterplotLayer({
        id: 'pulses',
        data: pulses,
        getPosition: (d: { pos: number[] }) => d.pos as never,
        getRadius: (d: { r: number }) => d.r * (f.underground ? 1.6 : 1.1),
        radiusUnits: 'meters',
        getFillColor: (d: { color: RGB }) => [...mixc(d.color, [255, 255, 255], 0.6), 255] as never,
        parameters: FLAT,
      }),
    );
  }

  // soft projected shadows
  if (memo.shadows.length && f.layers.shadows) {
    layers.push(
      new SolidPolygonLayer({
        id: 'shadows',
        data: memo.shadows,
        getPolygon: (d: { polygon: number[][][] }) => d.polygon as never,
        getFillColor: [18, 20, 40, Math.round(66 * Math.min(1, elev / 14))] as never,
        parameters: FLAT,
        updateTriggers: { getFillColor: [shKey] },
      }),
    );
  }

  const fade = f.underground ? 0.22 : 1;
  const A = (a: number) => Math.round(a * (f.underground ? 0.22 : 1));

  // context + trees
  layers.push(
    new SolidPolygonLayer<PolyItem>({
      id: 'context',
      data: W.context,
      extruded: true,
      getPolygon: (d) => d.polygon as never,
      getElevation: (d) => d.h,
      getFillColor: (d) => rgba(d.color, A(255)) as never,
      material: MAT_MATTE,
      updateTriggers: { getFillColor: [f.underground] },
    }),
    new SolidPolygonLayer({
      id: 'tree-trunks',
      visible: f.layers.trees,
      data: W.trees,
      extruded: true,
      getPolygon: (d: (typeof W.trees)[number]) => d.trunk.polygon as never,
      getElevation: (d: (typeof W.trees)[number]) => d.trunk.h,
      getFillColor: (d: (typeof W.trees)[number]) => rgba(d.trunk.color, A(255)) as never,
      material: MAT_MATTE,
      updateTriggers: { getFillColor: [f.underground] },
    }),
    new SolidPolygonLayer({
      id: 'tree-crowns',
      visible: f.layers.trees,
      data: W.trees,
      extruded: true,
      getPolygon: (d: (typeof W.trees)[number]) => d.crown.polygon as never,
      getElevation: (d: (typeof W.trees)[number]) => d.crown.h,
      getFillColor: (d: (typeof W.trees)[number]) => rgba(d.crown.color, A(255)) as never,
      material: MAT_MATTE,
      updateTriggers: { getFillColor: [f.underground] },
    }),
    new SolidPolygonLayer({
      id: 'tree-crowns2',
      visible: f.layers.trees,
      data: W.trees,
      extruded: true,
      getPolygon: (d: (typeof W.trees)[number]) => d.crown2.polygon as never,
      getElevation: (d: (typeof W.trees)[number]) => d.crown2.h,
      getFillColor: (d: (typeof W.trees)[number]) => rgba(d.crown2.color, A(255)) as never,
      material: MAT_MATTE,
      updateTriggers: { getFillColor: [f.underground] },
    }),
  );

  // campus buildings
  const solid = (id: string, data: PolyItem[], color: (d: PolyItem) => RGBA, trig: unknown[], extra: Record<string, unknown> = {}) =>
    new SolidPolygonLayer<PolyItem>({
      id,
      data,
      extruded: true,
      getPolygon: (d) => d.polygon as never,
      getElevation: (d) => d.h,
      getFillColor: color as never,
      material: MAT,
      updateTriggers: { getFillColor: trig },
      ...extra,
    });
  // power-usage heatmap: load density now, relative to the hungriest building
  const heat = f.layers.heat;
  const dens = W.props.map((p) => (snap?.perB[p.osmId]?.loadKw ?? 0) / Math.max(200, p.area_m2));
  const dMax = Math.max(1e-6, ...dens);
  const heatColor = (b: number): RGB => {
    const t = Math.min(1, Math.pow(dens[b] / dMax, 0.8));
    return t < 0.5 ? mixc([60, 204, 128], [255, 218, 74], t * 2) : mixc([255, 218, 74], [255, 74, 82], (t - 0.5) * 2);
  };
  const selTint = (d: PolyItem, c: RGB): RGB => {
    if (heat && !(d.h < 1.2 && d.polygon[0][0][2] > 1.5 && d.color[0] > 200)) c = mixc(c, heatColor(d.b!), 0.88);
    const id = W.props[d.b!].osmId;
    return id === sel ? mixc(c, [255, 255, 255], 0.22) : id === hov ? mixc(c, [255, 255, 255], 0.12) : c;
  };
  const pick = {
    pickable: true,
    onHover: (i: { object?: PolyItem; x: number; y: number }) => onHover(i.object ? W.props[i.object.b!].osmId : null, i.x, i.y),
    onClick: (i: { object?: PolyItem }) => onClick(i.object ? W.props[i.object.b!].osmId : null),
  };
  layers.push(
    solid('plinths', W.plinths, (d) => rgba(selTint(d, d.color), A(255)), [f.underground, sel, hov, heat, heat ? hourKey : 0]),
    solid('bodies', W.bodies, (d) => rgba(selTint(d, d.color), A(255)), [f.underground, sel, hov, heat, heat ? hourKey : 0], pick),
    solid('bands', W.bands, (d) => {
      const c = winColor(d);
      return [c[0], c[1], c[2], A(255)] as RGBA;
    }, [hourKey, kq, f.underground], { material: { ambient: 0.9, diffuse: 0.3, shininess: 80, specularColor: [255, 255, 255] } as never }),
    solid('parapets', W.parapets, (d) => rgba(d.color, A(255)), [f.underground]),
    solid('decks', W.decks, (d) => rgba(selTint(d, d.color), A(255)), [f.underground, sel, hov, heat, heat ? hourKey : 0]),
    solid('equip', W.equip, (d) => rgba(d.color, A(255)), [f.underground]),
  );

  // PV arrays
  const sheen = Math.min(1, Math.max(0, Math.sin((Math.max(elev, 0) * Math.PI) / 180))) * Math.min(1, (snap?.solarKw ?? 0) / 40 + 0.15);
  layers.push(
    solid(
      'pv',
      memo.panels,
      () => rgba(mixc([20, 36, 82], [120, 196, 255], sheen * 0.9), A(255)),
      [f.version, Math.round(sheen * 20), f.underground],
      { visible: f.layers.solar, material: { ambient: 0.9, diffuse: 0.5, shininess: 120, specularColor: [255, 255, 255] } as never },
    ),
  );

  // fixtures: cabinets, substation, battery
  layers.push(solid('fixtures', W.fixtures, (d) => rgba(d.color, A(255)), [f.underground]));

  const nCont = Math.max(1, Math.min(10, Math.round(f.fleetKwh / 400)));
  const act = snap?.battKw ?? 0;
  const lamp: RGB = act > 5 ? C_BATT : act < -5 ? [255, 180, 60] : [88, 220, 150];
  layers.push(
    solid(
      'containers',
      W.containers.filter((c) => c.idx < nCont),
      (d) => rgba(d.color, A(255)),
      [nCont, f.underground],
    ),
    // luminous roof strip that encodes charging / discharging / idle
    solid(
      'container-lamps',
      W.containers
        .filter((c) => c.idx < nCont)
        .map((c): PolyItem => ({ ...c, polygon: c.polygon.map((r) => r.map((q) => [q[0], q[1], 3.25])), h: 0.25 })),
      () => [...lamp, A(255)] as RGBA,
      [Math.sign(act), nCont, f.underground],
      { material: { ambient: 1, diffuse: 0, shininess: 0, specularColor: [0, 0, 0] } as never },
    ),
  );

  // SOC beacon: a column of light next to the yard, height ∝ state of charge
  {
    const [bx, by] = W.battery.pos;
    const soc = snap?.soc ?? 0;
    const ca = Math.cos(W.net.axis);
    const sa = Math.sin(W.net.axis);
    const cx = bx + 18 * ca;
    const cy = by + 18 * sa;
    const beacon: PolyItem[] = [
      { polygon: poly(regular(cx, cy, 2.2, 12), 0), h: 1.0, color: [70, 76, 90] },
      { polygon: poly(regular(cx, cy, 1.0, 12), 1.0), h: 2 + soc * 22, color: lamp },
    ];
    layers.push(
      solid('beacon', beacon, (d) => rgba(d.color, 255), [soc.toFixed(2), Math.sign(act)], {
        material: { ambient: 1, diffuse: 0.1, shininess: 20, specularColor: [255, 255, 255] } as never,
      }),
    );
  }

  // selection ring
  if (sel) {
    const bi = W.props.findIndex((p) => p.osmId === sel);
    if (bi >= 0) {
      const pulse = 1.2 + 0.5 * Math.sin(f.phase * Math.PI * 2);
      layers.push(
        new PathLayer({
          id: 'selection',
          data: W.footprints[bi].map((r) => ({ path: r.concat([r[0]]) })),
          getPath: (d: { path: number[][] }) => d.path as never,
          getWidth: pulse * 1.4,
          getColor: [255, 246, 160, 255] as never,
          widthUnits: 'meters',
          jointRounded: true,
          parameters: FLAT,
        }),
      );
    }
  }

  // ---- people concentration
  if (f.layers.people && snap && dv) {
    const dd = new Date(weekMsAt(dv.week.ms, snap.tMin));
    const hod = dd.getUTCHours();
    const dow = (dd.getUTCDay() + 6) % 7;
    const dots: Array<{ pos: number[]; color: RGB }> = [];
    const halos: Array<{ pos: number[]; r: number; color: RGB }> = [];
    W.props.forEach((p, bi) => {
      const cand = W.peopleCand[bi];
      const n = Math.round(cand.length * occupancy(p.category, hod, dow));
      const col = mixc(roofColor(p.category), [255, 255, 255], 0.35);
      for (let i = 0; i < n; i++) {
        const c = cand[i];
        const w = 1 + (i % 5) * 0.4;
        dots.push({ pos: [...toLonLat([c[0] + Math.sin(f.phase * 6.283 * w + i) * 0.9, c[1] + Math.cos(f.phase * 6.283 * w * 0.8 + i * 1.7) * 0.9]), 0.15], color: col });
      }
      if (n > 3) halos.push({ pos: [...toLonLat(W.centers[bi]), 0.1], r: 10 + Math.sqrt(n) * 3.4, color: roofColor(p.category) });
    });
    layers.push(
      new ScatterplotLayer({
        id: 'people-halo',
        data: halos,
        getPosition: (d: { pos: number[] }) => d.pos as never,
        getRadius: (d: { r: number }) => d.r,
        radiusUnits: 'meters',
        getFillColor: (d: { color: RGB }) => [...d.color, 90] as never,
        parameters: FLAT,
      }),
      new ScatterplotLayer({
        id: 'people',
        data: dots,
        getPosition: (d: { pos: number[] }) => d.pos as never,
        getRadius: 0.95,
        radiusUnits: 'meters',
        getFillColor: (d: { color: RGB }) => [...d.color, 255] as never,
        stroked: true,
        getLineColor: [20, 26, 48, 230] as never,
        getLineWidth: 0.22,
        lineWidthUnits: 'meters',
        parameters: FLAT,
      }),
    );
  }

  // ---- weather: drifting clouds + their shadows, driven by the station irradiance
  if (f.layers.weather && snap) {
    const cloudy = snap.cloud;
    const drift = snap.tMin * 0.22;
    const azr = ((snap.sunAz ?? 180) * Math.PI) / 180;
    const sh = elev > 6 ? 150 / Math.tan((elev * Math.PI) / 180) : 0;
    const discs: Array<{ pos: number[]; r: number; sh: number[] }> = [];
    for (const c of W.clouds) {
      if (c.k > cloudy * 0.9) continue;
      const cx = ((((c.pos[0] + drift + 450) % 900) + 900) % 900) - 450;
      for (const part of c.parts) {
        const x = cx + part.dx;
        const y = c.pos[1] + part.dy;
        discs.push({ pos: [...toLonLat([x, y]), 150], r: part.r, sh: [...toLonLat([x - Math.sin(azr) * sh, y - Math.cos(azr) * sh]), 0.08] });
      }
    }
    layers.push(
      new ScatterplotLayer({
        id: 'cloud-shadows',
        data: discs,
        getPosition: (d: { sh: number[] }) => d.sh as never,
        getRadius: (d: { r: number }) => d.r,
        radiusUnits: 'meters',
        getFillColor: [20, 30, 60, Math.round(48 * Math.min(1, elev / 12))] as never,
        parameters: FLAT,
      }),
      new ScatterplotLayer({
        id: 'clouds',
        data: discs,
        getPosition: (d: { pos: number[] }) => d.pos as never,
        getRadius: (d: { r: number }) => d.r,
        radiusUnits: 'meters',
        getFillColor: [...shade([255, 255, 255], day), 105] as never,
        parameters: { depthWriteEnabled: false } as never,
      }),
    );
  }

  // floating labels
  const labels: Array<{ pos: number[]; text: string; size: number; kind: 'b' | 'x' }> = [];
  W.props.forEach((p, i) => {
    const big = p.area_m2 > 1100 || p.category === 'data_center';
    if (!big && p.osmId !== sel && p.osmId !== hov) return;
    labels.push({ pos: [...toLonLat(W.centers[i]), p.height_m + 6], text: p.short, size: 12, kind: 'b' });
  });
  labels.push({
    pos: [...toLonLat([W.battery.pos[0], W.battery.pos[1] + 0]), 14 + (snap?.soc ?? 0) * 22],
    text: `Battery ${Math.round((snap?.soc ?? 0) * 100)}%  ${act > 5 ? '▲ charging' : act < -5 ? '▼ discharging' : '● idle'}`,
    size: 13,
    kind: 'x',
  });
  labels.push({ pos: [...toLonLat(W.substation), 12], text: 'Grid substation', size: 13, kind: 'x' });
  layers.push(
    new TextLayer({
      id: 'labels',
      visible: f.layers.labels,
      data: labels,
      getPosition: (d: (typeof labels)[number]) => d.pos as never,
      getText: (d: (typeof labels)[number]) => d.text,
      getSize: (d: (typeof labels)[number]) => d.size,
      getColor: [255, 255, 255, 255] as never,
      getBackgroundColor: (d: (typeof labels)[number]) => (d.kind === 'x' ? [20, 26, 48, 235] : [20, 26, 48, 205]) as never,
      getBorderColor: (d: (typeof labels)[number]) => (d.kind === 'x' ? [140, 255, 210, 255] : [255, 255, 255, 70]) as never,
      getBorderWidth: 1.4,
      background: true,
      backgroundPadding: [7, 3, 7, 3],
      billboard: true,
      fontFamily: 'Nunito Variable, Nunito, system-ui, sans-serif',
      fontWeight: 800,
      characterSet: 'auto',
      getTextAnchor: 'middle',
      getAlignmentBaseline: 'center',
      parameters: { depthCompare: 'always' } as never,
      updateTriggers: { getText: [hourKey, Math.round((snap?.soc ?? 0) * 100), Math.sign(act), sel, hov] },
    }),
  );
  void fade;
  void centroid;
  return layers;
}
