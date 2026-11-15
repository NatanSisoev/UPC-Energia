/**
 * Campus map renderer (deck.gl layers over OpenStreetMap footprints), clean "map" style in light or dark.
 *
 * Static geometry is built once (`buildMinimal`, a few ms; the cable routing is precomputed in network.json).
 * `buildMinimalLayers` turns the current frame (clock, sun, weather, flows, faults, alarms, hover) into layers.
 * Optional layers: heat colours + glow, daylight & shadows from the real sun position, clouds from the campus
 * irradiance, underground cables with flow pulses, battery yard + substation, PV arrays, trees, people.
 */
import { PathLayer, ScatterplotLayer, SolidPolygonLayer } from '@deck.gl/layers';
import type { CampusData, GroundData, LayerId, Snapshot } from '../types';
import { type P2, area, centroid, hull, inside, normRing, offsetRing, rect, toLocal, toLonLat } from './geo';
import { edgeFlows, along, type Network } from './network';
import { derived, useSim } from '../store/useSim';
import { occupancy } from '../sim/engine';
import { hash } from '../data/scenario';
import { weekMsAt } from '../lib/format';

type RGB = [number, number, number];
type RGBA = [number, number, number, number];

/* ------------------------------------------------------------- palette ---- */

interface Palette {
  land: RGB;
  green: RGB;
  pitch: RGB;
  parking: RGB;
  water: RGB;
  road: RGB;
  roadEdge: RGB;
  path: RGB;
  context: RGB;
  building: RGB;
  tree: RGB;
  outline: RGBA;
  shadow: RGBA;
  cableIdle: RGBA;
}
const LIGHT: Palette = {
  land: [243, 242, 238],
  green: [214, 233, 209],
  pitch: [198, 226, 194],
  parking: [229, 231, 235],
  water: [188, 214, 236],
  road: [255, 255, 255],
  roadEdge: [214, 218, 225],
  path: [244, 245, 247],
  context: [221, 224, 229],
  building: [206, 210, 216],
  tree: [160, 200, 150],
  outline: [90, 60, 50, 70],
  shadow: [30, 36, 60, 46],
  cableIdle: [150, 156, 168, 160],
};
const DARK: Palette = {
  land: [18, 23, 31],
  green: [27, 45, 37],
  pitch: [30, 54, 40],
  parking: [33, 37, 45],
  water: [22, 40, 64],
  road: [50, 56, 68],
  roadEdge: [38, 43, 53],
  path: [40, 45, 55],
  context: [40, 45, 56],
  building: [62, 68, 80],
  tree: [40, 76, 52],
  outline: [255, 255, 255, 40],
  shadow: [0, 0, 0, 90],
  cableIdle: [110, 118, 134, 170],
};
/** what the light map turns into at night when the "sun" layer is on */
const NIGHT: Palette = {
  ...DARK,
  land: [60, 66, 78],
  green: [52, 70, 64],
  road: [96, 104, 120],
  path: [80, 88, 102],
  context: [78, 86, 102],
  building: [92, 100, 116],
};

export const ACCENT: Record<'light' | 'dark', RGB> = { light: [0, 123, 192], dark: [77, 171, 247] };
const C_IMPORT: RGB = [236, 118, 56];
const C_EXPORT: RGB = [64, 176, 96];
const C_BATT: RGB = [16, 170, 170];
const C_FAULT: RGB = [220, 38, 38];
/** simulated (not as-built) equipment */
export const C_SIM: RGB = [124, 92, 240];

/** Heat ramp (ColorBrewer OrRd): t in 0..1 -> colour. */
const RAMP: RGB[] = [
  [254, 240, 217],
  [253, 204, 138],
  [252, 141, 89],
  [227, 74, 51],
  [179, 0, 0],
];
export function heatColor(t: number): RGB {
  const x = Math.min(1, Math.max(0, t)) * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(x));
  const f = x - i;
  const a = RAMP[i];
  const b = RAMP[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}
export const HEAT_CSS = `linear-gradient(90deg, ${RAMP.map((c) => `rgb(${c.join(',')})`).join(', ')})`;

const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const rgba = (c: RGB, a = 255): RGBA => [Math.round(c[0]), Math.round(c[1]), Math.round(c[2]), Math.round(a)];
/** 0 = deep night .. 1 = full day */
export const dayLevel = (elev: number) => Math.min(1, Math.max(0, (elev + 6) / 16));

/* --------------------------------------------------------------- world ---- */

interface Shadowed {
  ring: P2[];
  h: number;
}

/** pieces of the substation model, each with its own material colour */
type SubPart = 'yard' | 'fence' | 'building' | 'roof' | 'plinth' | 'tank' | 'radiator' | 'bushing' | 'steel' | 'wall' | 'conductor' | 'insulator';
/** pieces of the battery yard; 'roof' of a container carries its state colour (charging / discharging / fault / simulated) */
type BattPart = 'yard' | 'fence' | 'plinth' | 'body' | 'roof' | 'roofgrey' | 'hvac' | 'door' | 'pcs' | 'tank' | 'radiator' | 'bushing' | 'kiosk' | 'hydrant' | 'trench';
/** a box: footprint polygon (lon/lat) at base height z, extruded by h */
type Box3<K> = { polygon: number[][]; z: number; h: number; k: K };

export interface MiniWorld {
  ids: string[];
  names: string[];
  heights: number[];
  areas: number[];
  categories: string[];
  /** lon/lat centre per building */
  centers: number[][];
  buildings: Array<{ polygon: number[][][]; b: number }>;
  /** roof decks (inset footprint, reads as a parapet) and floor-slab lines for the 3D detail */
  roofs: Array<{ polygon: number[][]; b: number }>;
  floors: Array<{ path: number[][]; b: number }>;
  /** rooftop plant (stair cores, AC units) as small boxes: polygon at roof level + height */
  equip: Array<{ polygon: number[][]; b: number; h: number }>;
  context: Array<{ polygon: number[][]; h: number }>;
  greens: Array<{ polygon: number[][]; k: string }>;
  water: Array<{ polygon: number[][] }>;
  roads: Array<{ path: number[][]; w: number; major: boolean }>;
  trees: Array<{ pos: number[]; r: number }>;
  shadowSrc: Shadowed[];
  /** PV array footprints (inset roof) per building that can host panels */
  /** one item per PV panel row (4 modules); j = number on its roof, k = rank deciding which rows a coverage share shows */
  pv: Array<{ polygon: number[][]; b: number; h: number; k: number; j: number; center: number[] }>;
  /** candidate standing spots for people per building (lon/lat) */
  people: number[][][];
  clouds: Array<{ pos: P2; k: number; parts: Array<{ dx: number; dy: number; r: number }> }>;
  net: Network | null;
  edgePaths: number[][][];
  /** outdoor substation: gravel yard + boxes (polygon at base z, height h) for each piece of plant */
  substation: { center: number[]; polygon: number[][]; parts: Array<{ polygon: number[][]; z: number; h: number; k: SubPart }> };
  /** BESS yard: fixed plant + 20 container slots (each a list of boxes), filled in order by the installed units */
  battery: { center: number[]; pad: number[][]; containers: Box3<BattPart>[][]; parts: Box3<BattPart>[] };
  bbox: [number, number, number, number];
  peakKw: number;
  peakWeek: string;
}

/** the world the map is showing (the sidebar reads the panel geometry from it) */
export const worldRef: { current: MiniWorld | null } = { current: null };

/** stable id of one PV panel row: panel:<building osmId>:<number on that roof> */
export const panelId = (osmId: string, j: number) => `panel:${osmId}:${j}`;
export const parsePanelId = (id: string): { osmId: string; j: number } | null => {
  const m = id.match(/^panel:(.+):(\d+)$/);
  return m ? { osmId: m[1], j: +m[2] } : null;
};

/** is this panel row installed under the current roof coverage (0.6 = full roof)? */
export function panelVisible(M: MiniWorld, x: MiniWorld['pv'][number]): boolean {
  const s = useSim.getState();
  const id = M.ids[x.b];
  const c = s.solar[id];
  if (!c || (!c.on && !s.faults.roofs.includes(id)) || c.fraction <= 0) return false;
  return x.k < Math.max(0.12, c.fraction / 0.6);
}

/** the installed panels of one building, in roof order */
export function panelsOf(osmId: string): MiniWorld['pv'] {
  const M = worldRef.current;
  if (!M) return [];
  const b = M.ids.indexOf(osmId);
  return M.pv.filter((x) => x.b === b && panelVisible(M, x));
}

export function buildMinimal(campus: CampusData, ground: GroundData, net: Network | null): MiniWorld {
  const axis = net?.axis ?? 0;
  const pvCount: number[] = [];
  const lon = (ring: P2[]) => ring.map((q) => toLonLat(q));
  const M: MiniWorld = {
    ids: [],
    names: [],
    heights: [],
    areas: [],
    categories: [],
    centers: [],
    buildings: [],
    roofs: [],
    floors: [],
    equip: [],
    context: [],
    greens: [],
    water: [],
    roads: [],
    trees: [],
    shadowSrc: [],
    pv: [],
    people: [],
    clouds: [],
    net,
    edgePaths: net ? net.edges.map((e) => e.path.map((q) => toLonLat(q))) : [],
    substation: { center: [], polygon: [], parts: [] },
    battery: { center: [], pad: [], containers: [], parts: [] },
    bbox: ground.bbox ?? campus.bbox,
    peakKw: 1,
    peakWeek: '',
  };
  const campusRings: P2[][] = [];
  campus.features.forEach((f, b) => {
    const p = f.properties;
    const polys = (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates) as number[][][][];
    let biggest: P2[] = [];
    const H = Math.max(4, p.height_m);
    for (const pl of polys) {
      M.buildings.push({ polygon: pl.map((r) => r.map((q) => [q[0], q[1]])), b });
      const ring = normRing(pl[0].map((c) => toLocal(c)));
      campusRings.push(ring);
      M.shadowSrc.push({ ring, h: H });
      // detail: roof deck inset, one slab line per floor, a few rooftop units
      const inset = offsetRing(ring, -0.9);
      if (inset.length >= 3) M.roofs.push({ polygon: lon(inset), b });
      const floors = Math.max(1, Math.min(14, Math.round(p.levels ?? (H - 1) / 3.6)));
      const outer = lon(ring);
      for (let k = 1; k < floors; k++) {
        const z = (H * k) / floors;
        M.floors.push({ path: [...outer, outer[0]].map((q) => [q[0], q[1], z]), b });
      }
      const ar = area(ring);
      if (ar > 160 && inset.length >= 3) {
        const xs = inset.map((q) => q[0]);
        const ys = inset.map((q) => q[1]);
        const n = Math.min(5, 1 + Math.floor(ar / 450));
        let placed = 0;
        for (let i = 0; i < 24 && placed < n; i++) {
          const c: P2 = [Math.min(...xs) + hash(`${p.osmId}ex${i}`) * (Math.max(...xs) - Math.min(...xs)), Math.min(...ys) + hash(`${p.osmId}ey${i}`) * (Math.max(...ys) - Math.min(...ys))];
          if (!inside(c, offsetRing(ring, -3))) continue;
          const big = placed === 0;
          M.equip.push({ polygon: lon(rect(c[0], c[1], big ? 4.5 : 2.4, big ? 4 : 1.6, axis)), b, h: big ? 2.6 : 1.3 });
          placed++;
        }
      }
      if (ring.length > biggest.length) biggest = ring;
      // PV panel rows aligned with the street grid; each gets a stable rank so a coverage share shows a subset
      if (p.pv_fraction > 0 && area(ring) > 120) {
        const c0 = Math.cos(-axis);
        const s0 = Math.sin(-axis);
        const rot = ring.map(([x, y]): P2 => [x * c0 - y * s0, x * s0 + y * c0]);
        const xs = rot.map((q) => q[0]);
        const ys = rot.map((q) => q[1]);
        const safe = offsetRing(rot, -2);
        for (let y = Math.min(...ys) + 2; y < Math.max(...ys) - 2; y += 3.4) {
          for (let x = Math.min(...xs) + 2; x < Math.max(...xs) - 2; x += 4.6) {
            const corners: P2[] = [[x, y], [x + 4.2, y], [x + 4.2, y + 1.8], [x, y + 1.8]];
            if (safe.length < 3 || !corners.every((q) => inside(q, safe))) continue;
            const cx = x + 2.1;
            const cy = y + 0.9;
            const wc: P2 = [cx * Math.cos(axis) - cy * Math.sin(axis), cx * Math.sin(axis) + cy * Math.cos(axis)];
            M.pv.push({ polygon: lon(rect(wc[0], wc[1], 4.2, 1.8, axis)), b, h: H, k: hash(`${p.osmId}pv${x.toFixed(0)}:${y.toFixed(0)}`), j: pvCount[b] = (pvCount[b] ?? 0) + 1, center: toLonLat(wc) });
          }
        }
      }
    }
    const c = centroid(biggest);
    M.ids.push(p.osmId);
    M.names.push(p.short);
    M.heights.push(H);
    M.areas.push(p.area_m2);
    M.categories.push(p.category);
    M.centers.push(toLonLat(c));
    // people: spots on a ring around the building, ordered by hash so a share n of them is a stable subset
    const cap = p.category === 'data_center' ? 12 : Math.min(140, Math.round((p.area_m2 * (p.levels ?? p.height_m / 3.5)) / 40));
    const R = Math.sqrt(Math.max(100, p.area_m2)) / 2;
    const spots: number[][] = [];
    for (let i = 0; i < cap; i++) {
      const a = hash(`${p.osmId}a${i}`) * Math.PI * 2;
      const r = R + 3 + hash(`${p.osmId}r${i}`) * 10;
      spots.push(toLonLat([c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r]));
    }
    M.people.push(spots);
  });

  for (const g of ground.greens) M.greens.push({ polygon: g.p.map((q) => [q[0], q[1]]), k: g.k });
  for (const w of ground.water ?? []) M.water.push({ polygon: w.p.map((q) => [q[0], q[1]]) });
  for (const r of ground.roads) M.roads.push({ path: r.p.map((q) => [q[0], q[1]]), w: r.w, major: r.w >= 4 });
  for (const c of ground.context) {
    if (c.p.length < 3) continue;
    // neighbourhood buildings are drawn flat, so they cast no shadow either
    M.context.push({ polygon: c.p.map((q) => [q[0], q[1]]), h: c.h });
  }

  // trees: jittered grid inside parks and gardens, kept off buildings
  let count = 0;
  for (const g of ground.greens) {
    if (count > 3500 || g.k === 'pitch' || g.k === 'parking') continue;
    const ring = normRing(g.p.map((q) => toLocal(q)));
    if (ring.length < 3 || area(ring) < 150) continue;
    const xs = ring.map((q) => q[0]);
    const ys = ring.map((q) => q[1]);
    const sp = g.k === 'wood' ? 6 : 9;
    for (let x = Math.min(...xs); x < Math.max(...xs) && count <= 3500; x += sp) {
      for (let y = Math.min(...ys); y < Math.max(...ys); y += sp) {
        const k = `${x.toFixed(0)}:${y.toFixed(0)}`;
        if (hash(`tk${k}`) < 0.35) continue;
        const c: P2 = [x + (hash(`tx${k}`) - 0.5) * sp * 0.8, y + (hash(`ty${k}`) - 0.5) * sp * 0.8];
        if (!inside(c, ring)) continue;
        if (campusRings.some((r) => inside(c, r))) continue;
        M.trees.push({ pos: toLonLat(c), r: 1.8 + hash(`tr${k}`) * 1.8 });
        count++;
      }
    }
  }

  for (let i = 0; i < 18; i++) {
    const parts = Array.from({ length: 6 }, (_, j) => ({ dx: (hash(`cd${i}${j}`) - 0.5) * 120, dy: (hash(`ce${i}${j}`) - 0.5) * 55, r: 22 + hash(`cr${i}${j}`) * 32 }));
    M.clouds.push({ pos: [-700 + hash(`cx${i}`) * 1400, -650 + hash(`cy${i}`) * 1300], k: (i + 0.5) / 18, parts });
  }

  // substation compound and battery yard
  const sub = toLocal(campus.substation);
  const ca = Math.cos(axis);
  const sa = Math.sin(axis);
  M.substation = { center: toLonLat(sub), polygon: lon(rect(sub[0], sub[1], 30, 22, axis)), parts: [] };
  {
    // a typical 25/0.4 kV outdoor substation (30 x 22 m, local x along the street axis):
    // fenced gravel yard, control building, two power transformers on plinths with radiators, conservator tanks and
    // bushings, a fire wall between them, breaker/disconnector poles and the steel gantry carrying the busbars.
    const parts = M.substation.parts;
    const box = (lx: number, ly: number, w: number, d: number, z: number, h: number, k: SubPart) => {
      parts.push({ polygon: lon(rect(sub[0] + lx * ca - ly * sa, sub[1] + lx * sa + ly * ca, w, d, axis)), z, h, k });
    };
    box(0, 0, 30, 22, 0, 0.15, 'yard');
    // perimeter fence (thin walls) with a gate gap on the street side
    box(0, 10.9, 30, 0.12, 0.15, 2.4, 'fence');
    box(-14.94, 0, 0.12, 22, 0.15, 2.4, 'fence');
    box(14.94, 0, 0.12, 22, 0.15, 2.4, 'fence');
    box(-9.5, -10.9, 11, 0.12, 0.15, 2.4, 'fence');
    box(7.5, -10.9, 15, 0.12, 0.15, 2.4, 'fence');
    // control / switchgear building
    box(-10, 4.5, 8, 9, 0.15, 4.2, 'building');
    box(-10, 4.5, 8.4, 9.4, 4.35, 0.35, 'roof');
    // two transformers
    for (const tx of [-1, 7]) {
      box(tx, -4, 5.2, 4.4, 0.15, 0.4, 'plinth');
      box(tx, -4, 3.6, 2.6, 0.55, 3.3, 'tank');
      for (const s of [-1, 1]) for (const r of [0, 1, 2]) box(tx + s * 2.15, -4.9 + r * 0.9, 0.7, 0.18, 0.75, 2.6, 'radiator');
      box(tx - 0.6, -2.4, 0.18, 0.18, 3.85, 0.9, 'steel');
      box(tx - 0.6, -3.1, 2.8, 0.75, 4.75, 0.75, 'tank'); // conservator
      for (const b of [-1, 0, 1]) box(tx + b * 1.0, -4.6, 0.26, 0.26, 3.85, 1.5, 'bushing'); // HV
      for (const b of [-1, 0, 1]) box(tx + b * 0.8, -3.2, 0.2, 0.2, 3.85, 0.8, 'bushing'); // LV
      // breaker + disconnector poles feeding this transformer from the busbar
      for (const b of [-1, 0, 1]) {
        box(tx + b * 1.4, 1.2, 0.3, 0.3, 0.15, 2.2, 'steel');
        box(tx + b * 1.4, 1.2, 0.34, 0.34, 2.35, 1.4, 'insulator');
        box(tx + b * 1.4, 3.4, 0.3, 0.3, 0.15, 2.6, 'steel');
        box(tx + b * 1.4, 3.4, 0.3, 0.3, 2.75, 1.1, 'insulator');
      }
    }
    box(3, -4, 0.35, 6, 0.15, 5, 'wall'); // fire wall between the transformers
    // gantry: three portal frames across the yard, busbars strung between them
    for (const gx of [-4.5, 3, 10.5]) {
      for (const gy of [2.5, 8.5]) box(gx, gy, 0.45, 0.45, 0.15, 8, 'steel');
      box(gx, 5.5, 0.4, 6.4, 7.6, 0.5, 'steel');
    }
    for (const gy of [4.3, 5.5, 6.7]) {
      box(3, gy, 15, 0.1, 6.9, 0.1, 'conductor');
      for (const gx of [-4.5, 3, 10.5]) box(gx, gy, 0.22, 0.22, 7.0, 0.6, 'insulator');
    }
    // incoming line terminal pole on the far side
    box(13.2, 5.5, 0.6, 0.6, 0.15, 10, 'steel');
    box(13.2, 5.5, 0.4, 5, 9.6, 0.4, 'steel');
  }
  const bat = toLocal(campus.batterySite);
  {
    // containerised BESS yard (42 x 30 m): fenced gravel pad, 20 container slots (4 rows of 5) on concrete plinths,
    // and at the far end the power-conversion skids, the step-up transformer and the MV switchgear kiosk.
    const bbox = (lx: number, ly: number, w: number, d: number, z: number, h: number, k: BattPart): Box3<BattPart> => ({
      polygon: lon(rect(bat[0] + lx * ca - ly * sa, bat[1] + lx * sa + ly * ca, w, d, axis)),
      z,
      h,
      k,
    });
    const parts: Box3<BattPart>[] = [bbox(0, 0, 42, 30, 0, 0.15, 'yard')];
    parts.push(bbox(0, 14.94, 42, 0.12, 0.15, 2.4, 'fence'), bbox(0, -14.94, 42, 0.12, 0.15, 2.4, 'fence'));
    parts.push(bbox(20.94, 0, 0.12, 30, 0.15, 2.4, 'fence'), bbox(-20.94, 8.5, 0.12, 13, 0.15, 2.4, 'fence'), bbox(-20.94, -8.5, 0.12, 13, 0.15, 2.4, 'fence'));
    // power conversion skids (one per two rows)
    for (const py of [-6.7, 6.7]) {
      parts.push(bbox(17.6, py, 3.4, 2.6, 0.15, 0.25, 'plinth'), bbox(17.6, py, 3, 2.2, 0.4, 2.3, 'pcs'), bbox(17.6, py, 3.1, 2.3, 2.7, 0.1, 'roofgrey'));
      for (const fx of [-0.8, 0.8]) parts.push(bbox(17.6 + fx, py, 0.9, 0.9, 2.8, 0.25, 'hvac'));
    }
    // step-up transformer with radiators and bushings
    parts.push(bbox(17.4, 0, 4.2, 3.6, 0.15, 0.35, 'plinth'), bbox(17.4, 0, 2.8, 2.2, 0.5, 2.4, 'tank'));
    for (const s of [-1, 1]) for (const r of [-0.6, 0, 0.6]) parts.push(bbox(17.4 + s * 1.65, r, 0.5, 0.14, 0.7, 1.9, 'radiator'));
    for (const b of [-0.7, 0, 0.7]) parts.push(bbox(17.4 + b, -0.5, 0.2, 0.2, 2.9, 0.9, 'bushing'));
    // MV switchgear kiosk + fire-water point
    parts.push(bbox(17.6, 12, 3.2, 2.2, 0.15, 2.6, 'kiosk'), bbox(17.6, 12, 3.4, 2.4, 2.75, 0.12, 'roofgrey'));
    parts.push(bbox(-19.6, 13.6, 0.5, 0.5, 0.15, 1.1, 'hydrant'));
    // cable trench along the row ends towards the conversion skids
    parts.push(bbox(14.6, 0, 0.8, 26, 0.15, 0.04, 'trench'));
    const containers: Box3<BattPart>[][] = Array.from({ length: 20 }, (_, i) => {
      const lx = -15.4 + (i % 5) * 6.6;
      const ly = (Math.floor(i / 5) - 1.5) * 6.7;
      return [
        bbox(lx, ly, 5.8, 3, 0.15, 0.25, 'plinth'),
        bbox(lx - 0.25, ly, 5.0, 2.4, 0.4, 2.5, 'body'),
        bbox(lx - 0.25, ly, 5.1, 2.5, 2.9, 0.12, 'roof'),
        bbox(lx + 2.55, ly, 0.55, 1.8, 0.7, 1.6, 'hvac'), // end-wall HVAC unit
        bbox(lx - 1.6, ly - 1.22, 1.1, 0.06, 0.55, 2.1, 'door'),
        bbox(lx + 0.6, ly - 1.22, 1.1, 0.06, 0.55, 2.1, 'door'),
      ];
    });
    M.battery = { center: toLonLat(bat), pad: lon(rect(bat[0], bat[1], 42, 30, axis)), containers, parts };
  }
  worldRef.current = M;
  return M;
}

/** Heat normalisation: the hungriest building over the whole week (cached per week), so colours move with the clock. */
export function weekPeakKw(M: MiniWorld): number {
  const d = derived.current;
  if (d && M.peakWeek !== d.week.start) {
    M.peakWeek = d.week.start;
    let m = 1;
    const n = M.ids.length;
    for (let b = 0; b < n; b++) for (let h = 0; h < 168; h++) m = Math.max(m, d.shares[b * 168 + h] * d.week.load[h]);
    M.peakKw = m;
  }
  return M.peakKw;
}

/** 0..1 heat of each building now (log scale: the data centre draws ~10x a teaching building). */
export function heatOf(M: MiniWorld, snap: Snapshot | null): number[] {
  const peak = weekPeakKw(M);
  return M.ids.map((id) => Math.log1p(Math.max(0, snap?.perB[id]?.loadKw ?? 0) / 5) / Math.log1p(peak / 5));
}

/* -------------------------------------------------------------- frame ---- */

export interface MiniFrame {
  snap: Snapshot | null;
  /** store version (week / config / forecast / faults changes) */
  version: number;
  hoverId: string | null;
  selection: string | null;
  /** camera centred on the selection and orbiting: only then the other buildings turn into wireframes */
  orbiting: boolean;
  mode3d: boolean;
  dark: boolean;
  layers: Record<LayerId, boolean>;
  /** 0..1 animation phase (alarm rings) */
  phase: number;
  /** wall-clock seconds (cable dots move at a real speed in m/s) */
  clock: number;
  /** battery units in the yard (container count from capacity), with fault / simulated flags */
  units: Array<{ id: string; kwh: number; fault: boolean; sim: boolean }>;
  faultRoofs: string[];
  /** roofs whose solar differs from the real plant (drawn in the "simulated" colour) */
  simRoofs: string[];
  outage: boolean;
  /** map targets with an active alarm -> colour */
  alarmTargets: Array<{ target: string; critical: boolean }>;
  /** individual PV panels to highlight (hovered in the list; a selected panel gets no overlay) */
  panelHi: string[];
}

interface Memo {
  flowKey: string;
  flows: Float64Array;
  shadowKey: string;
  shadows: Array<{ polygon: number[][] }>;
}
const memo: Memo = { flowKey: '', flows: new Float64Array(0), shadowKey: '', shadows: [] };
/** power on cable segment i at the last rendered hour (kW, + towards the buildings) */
export const cableFlow = (i: number) => memo.flows[i] ?? 0;

/** per-building slices of the world for the x-ray view, memoised so deck does not re-ingest the data every frame */
let xrayMemo: { M: MiniWorld; selB: number; out: { others: MiniWorld['buildings']; selected: MiniWorld['buildings']; roofs: MiniWorld['roofs']; floors: MiniWorld['floors']; equip: MiniWorld['equip'] } } | null = null;
function xrayData(M: MiniWorld, selB: number) {
  if (xrayMemo && xrayMemo.M === M && xrayMemo.selB === selB) return xrayMemo.out;
  const out = {
    others: M.buildings.filter((x) => x.b !== selB),
    selected: M.buildings.filter((x) => x.b === selB),
    roofs: M.roofs.filter((x) => x.b === selB),
    floors: M.floors.filter((x) => x.b === selB),
    equip: M.equip.filter((x) => x.b === selB),
  };
  xrayMemo = { M, selB, out };
  return out;
}

const FLAT ={ depthCompare: 'always', depthWriteEnabled: false } as never;
const MAT = { ambient: 0.62, diffuse: 0.5, shininess: 16, specularColor: [140, 140, 140] } as never;

const majorCache = new WeakMap<object, MiniWorld['roads']>();
/** major roads, computed once per world (a fresh array every frame would re-upload the layer's buffers) */
function majorRoads(M: MiniWorld) {
  let r = majorCache.get(M);
  if (!r) majorCache.set(M, (r = M.roads.filter((x) => x.major)));
  return r;
}

export function buildMinimalLayers(
  M: MiniWorld,
  f: MiniFrame,
  onHover: (id: string | null, x: number, y: number) => void,
  onClick: (id: string | null) => void,
) {
  const snap = f.snap;
  const L = f.layers;
  const t = heatOf(M, snap);
  const hourKey = `${f.version}:${snap?.hour ?? -1}`;
  const sel = f.selection;
  const hov = f.hoverId;
  const e3 = f.mode3d;

  // ---- palette, with a day/night blend on the light theme when the sun layer is on
  const elev = snap?.sunElev ?? 40;
  const day = L.sun ? dayLevel(elev) : 1;
  const night = 1 - day;
  const base = f.dark ? DARK : LIGHT;
  const P = (k: keyof Palette): RGB => {
    const c = base[k] as number[];
    if (f.dark || night <= 0) return [c[0], c[1], c[2]];
    const n = NIGHT[k] as number[];
    return mix([c[0], c[1], c[2]], [n[0], n[1], n[2]], night * 0.75);
  };
  const tone = `${f.dark ? 'd' : 'l'}${Math.round(night * 20)}`;

  const layers: unknown[] = [];

  /* ---------- ground ---------- */
  const [bx0, by0, bx1, by1] = M.bbox;
  layers.push(
    new SolidPolygonLayer({
      id: 'land',
      data: [{ polygon: [[bx0 - (bx1 - bx0) * 4, by0 - (by1 - by0) * 4], [bx1 + (bx1 - bx0) * 4, by0 - (by1 - by0) * 4], [bx1 + (bx1 - bx0) * 4, by1 + (by1 - by0) * 4], [bx0 - (bx1 - bx0) * 4, by1 + (by1 - by0) * 4]] }],
      getPolygon: (g: { polygon: number[][] }) => g.polygon as never,
      getFillColor: rgba(P('land')) as never,
      parameters: FLAT,
      updateTriggers: { getFillColor: [tone] },
    }),
    new SolidPolygonLayer({
      id: 'water',
      data: M.water,
      getPolygon: (g: MiniWorld['water'][number]) => g.polygon as never,
      getFillColor: rgba(P('water')) as never,
      parameters: FLAT,
      updateTriggers: { getFillColor: [tone] },
    }),
    new SolidPolygonLayer({
      id: 'greens',
      data: M.greens,
      getPolygon: (g: MiniWorld['greens'][number]) => g.polygon as never,
      getFillColor: (g: MiniWorld['greens'][number]) => rgba(g.k === 'pitch' ? P('pitch') : g.k === 'parking' ? P('parking') : P('green')) as never,
      parameters: FLAT,
      updateTriggers: { getFillColor: [tone] },
    }),
    new PathLayer({
      id: 'road-edge',
      data: majorRoads(M),
      getPath: (r: MiniWorld['roads'][number]) => r.path as never,
      getWidth: (r: MiniWorld['roads'][number]) => r.w + 2,
      getColor: rgba(P('roadEdge')) as never,
      widthUnits: 'meters',
      capRounded: true,
      jointRounded: true,
      parameters: FLAT,
      updateTriggers: { getColor: [tone] },
    }),
    new PathLayer({
      id: 'roads',
      data: M.roads,
      getPath: (r: MiniWorld['roads'][number]) => r.path as never,
      getWidth: (r: MiniWorld['roads'][number]) => (r.major ? r.w : Math.max(1.5, r.w)),
      getColor: (r: MiniWorld['roads'][number]) => rgba(r.major ? P('road') : P('path')) as never,
      widthUnits: 'meters',
      capRounded: true,
      jointRounded: true,
      parameters: FLAT,
      updateTriggers: { getColor: [tone] },
    }),
  );

  /* ---------- projected shadows (real sun position) ---------- */
  if (L.shadows && L.sun && elev > 2.5) {
    const az = snap?.sunAz ?? 180;
    const key = `${Math.round(az)}:${Math.round(elev)}`;
    if (memo.shadowKey !== key) {
      memo.shadowKey = key;
      const azr = (az * Math.PI) / 180;
      const k = 1 / Math.tan((Math.max(elev, 6) * Math.PI) / 180);
      const dx = -Math.sin(azr) * k;
      const dy = -Math.cos(azr) * k;
      memo.shadows = M.shadowSrc.map((s) => {
        const len = Math.min(s.h, 70);
        const pts = s.ring.concat(s.ring.map(([x, y]): P2 => [x + dx * len, y + dy * len]));
        return { polygon: hull(pts).map((q) => toLonLat(q)) };
      });
    }
    const sh = base.shadow;
    layers.push(
      new SolidPolygonLayer({
        id: 'shadows',
        data: memo.shadows,
        getPolygon: (d: { polygon: number[][] }) => d.polygon as never,
        getFillColor: [sh[0], sh[1], sh[2], Math.round(sh[3] * Math.min(1, elev / 12))] as never,
        parameters: FLAT,
        updateTriggers: { getFillColor: [memo.shadowKey, f.dark] },
      }),
    );
  }

  /* ---------- trees ---------- */
  if (L.trees) {
    layers.push(
      new ScatterplotLayer({
        id: 'trees',
        data: M.trees,
        getPosition: (d: MiniWorld['trees'][number]) => d.pos as never,
        getRadius: (d: MiniWorld['trees'][number]) => d.r,
        radiusUnits: 'meters',
        getFillColor: rgba(P('tree'), 230) as never,
        parameters: FLAT,
        updateTriggers: { getFillColor: [tone] },
      }),
    );
  }

  /* ---------- heat glow ---------- */
  if (L.heat && L.glow) {
    const glow: Array<{ pos: number[]; r: number; c: RGBA }> = [];
    M.centers.forEach((c, b) => {
      const v = t[b];
      if (v < 0.35) return;
      const col = heatColor(v);
      const r0 = 8 + 48 * Math.pow(v, 3);
      const a = f.dark ? 1.4 : 1;
      glow.push({ pos: c, r: r0 * 1.7, c: rgba(col, (14 + 20 * v) * a) });
      glow.push({ pos: c, r: r0 * 1.15, c: rgba(col, (20 + 30 * v) * a) });
      glow.push({ pos: c, r: r0 * 0.7, c: rgba(col, (26 + 40 * v) * a) });
    });
    layers.push(
      new ScatterplotLayer({
        id: 'heat-glow',
        data: glow,
        getPosition: (g: (typeof glow)[number]) => g.pos as never,
        getRadius: (g: (typeof glow)[number]) => g.r,
        getFillColor: (g: (typeof glow)[number]) => g.c as never,
        radiusUnits: 'meters',
        parameters: FLAT,
        updateTriggers: { getRadius: [hourKey], getFillColor: [hourKey, f.dark] },
      }),
    );
  }

  /* ---------- underground cables with flow pulses ---------- */
  if (L.cables && M.net && snap) {
    const net = M.net;
    const fk = `${hourKey}:${snap.battKw.toFixed(0)}`;
    if (memo.flowKey !== fk) {
      memo.flowKey = fk;
      const nn = new Float64Array(net.nodes.length);
      net.nodes.forEach((nd, i) => {
        if (nd.kind === 'bld') {
          const pt = snap.perB[M.ids[nd.b]];
          nn[i] = pt ? pt.loadKw - pt.solarKw : 0;
        } else if (nd.kind === 'batt') nn[i] = snap.battKw;
      });
      memo.flows = edgeFlows(net, nn);
    }
    const flows = memo.flows;
    const colorOf = (i: number): RGB => (net.edges[i].to === 1 || net.nodes[net.edges[i].to]?.kind === 'batt' ? C_BATT : flows[i] >= 0 ? C_IMPORT : C_EXPORT);
    const idx = net.edges.map((_, i) => i);
    const cid = (i: number) => `cable:${i}`;
    layers.push(
      new PathLayer({
        id: 'cables',
        data: idx,
        pickable: true,
        getPath: (i: number) => M.edgePaths[i] as never,
        // every cable is drawn in its flow colour; conductor size follows how many buildings it feeds (trunks thicker)
        getWidth: (i: number) => (cid(i) === sel || cid(i) === hov ? 3 : 0.7 + Math.min(1.6, (net.edges[i].down ?? 1) * 0.06)),
        getColor: (i: number) => (cid(i) === sel || cid(i) === hov ? rgba(ACCENT[f.dark ? 'dark' : 'light']) : rgba(colorOf(i), f.dark ? 210 : 185)) as never,
        widthUnits: 'meters',
        widthMinPixels: 1.2,
        capRounded: true,
        jointRounded: true,
        parameters: FLAT,
        onHover: (i: { object?: number; x: number; y: number }) => onHover(i.object != null ? cid(i.object) : null, i.x, i.y),
        onClick: (i: { object?: number }) => onClick(i.object != null ? cid(i.object) : null),
        updateTriggers: { getWidth: [sel, hov, memo.flowKey], getColor: [memo.flowKey, f.dark, sel, hov] },
      }),
    );
    // moving dots on every cable, in the flow direction. DENSITY = power (1 dot per 100 m per ~120 kW, up to 10);
    // SPEED grows smoothly with power: almost still on near-idle cables (0.3 m/s), at most ~12 m/s on the busiest
    const pulses: Array<{ pos: number[]; c: RGB; r: number }> = [];
    net.edges.forEach((e, i) => {
      const a = Math.abs(flows[i] ?? 0);
      const perHundred = Math.min(10, Math.max(1, a / 120));
      const reps = Math.max(1, Math.round((e.len / 100) * perHundred));
      const speedMs = 0.3 + 11.4 * Math.sqrt(Math.min(1, a / 1500)); // metres per second along the cable
      const r = 1.1 + Math.min(1.4, a / 900);
      for (let k = 0; k < reps; k++) {
        // continuous position from wall-clock time, so any speed is smooth (no jump at the end of a loop)
        let u = (((f.clock * speedMs) / Math.max(1, e.len) + k / reps) % 1 + 1) % 1;
        if ((flows[i] ?? 0) < 0) u = 1 - u;
        pulses.push({ pos: toLonLat(along(e.path, e.len, u)), c: colorOf(i), r });
      }
    });
    layers.push(
      new ScatterplotLayer({
        id: 'pulses',
        data: pulses,
        getPosition: (d: (typeof pulses)[number]) => d.pos as never,
        getRadius: (d: (typeof pulses)[number]) => d.r,
        radiusUnits: 'meters',
        radiusMinPixels: 1.5,
        getFillColor: (d: (typeof pulses)[number]) => rgba(mix(d.c, [255, 255, 255], 0.35)) as never,
        parameters: FLAT,
      }),
    );
  }

  /* ---------- context buildings: always flat footprints, only the campus stands up in 3D ---------- */
  layers.push(
    new SolidPolygonLayer({
      id: 'context',
      data: M.context,
      getPolygon: (c: MiniWorld['context'][number]) => c.polygon as never,
      getFillColor: rgba(P('context')) as never,
      parameters: FLAT,
      updateTriggers: { getFillColor: [tone] },
    }),
  );

  /* ---------- campus buildings ---------- */
  const fillOf = (b: number): RGBA => {
    const id = M.ids[b];
    let c: RGB = L.heat ? heatColor(0.06 + 0.94 * t[b]) : P('building');
    if (L.heat && night > 0 && !f.dark) c = mix(c, [c[0] * 0.75, c[1] * 0.75, c[2] * 0.8], night * 0.6);
    if (id === sel || id === hov) c = mix(c, f.dark ? [255, 255, 255] : [0, 0, 0], 0.08);
    return rgba(c);
  };
  // X-ray: while the camera orbits a selected building or cable in 3D the others turn into see-through wireframes so the selection stands out
  const selB = sel ? M.ids.indexOf(sel.startsWith('pv:') ? sel.slice(3) : sel) : -1;
  const cableSel = !!sel && (sel.startsWith('cable:') || sel === 'battery' || sel === 'substation'); // a focused cable, the battery or the grid substation: every building turns to wireframe so it reads clearly
  const xray = e3 && f.orbiting && (selB >= 0 || cableSel);
  const xr = xrayData(M, xray ? selB : -1);
  if (xray) {
    layers.push(
      new SolidPolygonLayer({
        id: 'buildings-xray',
        data: xr.others,
        extruded: true,
        wireframe: true,
        pickable: true,
        getPolygon: (x: MiniWorld['buildings'][number]) => x.polygon as never,
        getElevation: (x: MiniWorld['buildings'][number]) => M.heights[x.b],
        getFillColor: (x: MiniWorld['buildings'][number]) => {
          const c = fillOf(x.b);
          return [c[0], c[1], c[2], f.dark ? 46 : 58] as never;
        },
        getLineColor: (f.dark ? [190, 205, 235, 170] : [60, 90, 140, 170]) as never,
        lineWidthMinPixels: 1,
        material: false as never,
        parameters: { depthWriteEnabled: false } as never,
        onHover: (i: { object?: MiniWorld['buildings'][number]; x: number; y: number }) => onHover(i.object ? M.ids[i.object.b] : null, i.x, i.y),
        onClick: (i: { object?: MiniWorld['buildings'][number] }) => onClick(i.object ? M.ids[i.object.b] : null),
        updateTriggers: { getFillColor: [hourKey, L.heat, tone, f.dark], getLineColor: [f.dark] },
      } as never),
    );
  }
  layers.push(
    new SolidPolygonLayer({
      id: 'buildings',
      data: xray ? xr.selected : M.buildings,
      extruded: e3,
      pickable: true,
      getPolygon: (x: MiniWorld['buildings'][number]) => x.polygon as never,
      getElevation: (x: MiniWorld['buildings'][number]) => M.heights[x.b],
      getFillColor: (x: MiniWorld['buildings'][number]) => fillOf(x.b) as never,
      material: MAT,
      onHover: (i: { object?: MiniWorld['buildings'][number]; x: number; y: number }) => onHover(i.object ? M.ids[i.object.b] : null, i.x, i.y),
      onClick: (i: { object?: MiniWorld['buildings'][number] }) => onClick(i.object ? M.ids[i.object.b] : null),
      updateTriggers: { getFillColor: [hourKey, sel, hov, L.heat, tone] },
    }),
  );

  /* ---------- building detail: roof deck (parapet edge), floor slabs, rooftop plant ---------- */
  const roofTint = (b: number): RGBA => {
    const c = fillOf(b);
    const k: RGB = f.dark ? [0, 0, 0] : [255, 255, 255];
    return rgba(mix([c[0], c[1], c[2]], k, f.dark ? 0.22 : 0.28));
  };
  layers.push(
    new SolidPolygonLayer({
      id: 'roofs',
      data: xray ? xr.roofs : M.roofs,
      getPolygon: (x: MiniWorld['roofs'][number]) => (e3 ? x.polygon.map((q) => [q[0], q[1], M.heights[x.b] + 0.08]) : x.polygon) as never,
      getFillColor: (x: MiniWorld['roofs'][number]) => roofTint(x.b) as never,
      ...(e3 ? {} : { parameters: FLAT }),
      updateTriggers: { getFillColor: [hourKey, sel, hov, L.heat, tone], getPolygon: [e3] },
    } as never),
  );
  if (e3) {
    layers.push(
      new PathLayer({
        id: 'floors',
        data: xray ? xr.floors : M.floors,
        getPath: (x: MiniWorld['floors'][number]) => x.path as never,
        getWidth: 0.35,
        widthUnits: 'meters',
        getColor: (f.dark ? [0, 0, 0, 90] : [80, 40, 30, 55]) as never,
        updateTriggers: { getColor: [f.dark] },
      }),
      // parapet: a crisp rim around each roof deck, and a thin plinth line at the ground
      new PathLayer({
        id: 'parapet',
        data: xray ? xr.roofs : M.roofs,
        getPath: (x: MiniWorld['roofs'][number]) => [...x.polygon, x.polygon[0]].map((q) => [q[0], q[1], M.heights[x.b] + 0.25]) as never,
        getWidth: 0.55,
        widthUnits: 'meters',
        getColor: (f.dark ? [210, 216, 230, 120] : [255, 255, 255, 190]) as never,
        updateTriggers: { getColor: [f.dark] },
      }),
      new PathLayer({
        id: 'plinth',
        data: xray ? xr.selected : M.buildings,
        getPath: (x: MiniWorld['buildings'][number]) => [...x.polygon[0], x.polygon[0][0]].map((q) => [q[0], q[1], 0.6]) as never,
        getWidth: 0.7,
        widthUnits: 'meters',
        getColor: (f.dark ? [0, 0, 0, 110] : [90, 60, 50, 80]) as never,
        updateTriggers: { getColor: [f.dark] },
      }),
      new SolidPolygonLayer({
        id: 'equip',
        data: xray ? xr.equip : M.equip,
        extruded: true,
        getPolygon: (x: MiniWorld['equip'][number]) => x.polygon.map((q) => [q[0], q[1], M.heights[x.b] + 0.1]) as never,
        getElevation: (x: MiniWorld['equip'][number]) => x.h,
        getFillColor: (f.dark ? [96, 104, 120, 255] : [196, 200, 208, 255]) as never,
        material: MAT,
        updateTriggers: { getFillColor: [f.dark] },
      }),
    );
  } else {
    layers.push(
      new SolidPolygonLayer({
        id: 'equip',
        data: M.equip,
        getPolygon: (x: MiniWorld['equip'][number]) => x.polygon as never,
        getFillColor: (f.dark ? [0, 0, 0, 60] : [255, 255, 255, 120]) as never,
        parameters: FLAT,
        updateTriggers: { getFillColor: [f.dark] },
      }),
    );
  }

  /* ---------- PV arrays ---------- */
  if (L.solar) {
    const sun = Math.min(1, (snap?.solarKw ?? 0) / 60);
    const pv = M.pv.filter((x) => panelVisible(M, x));
    const pvBase = (b: number): RGB => (f.simRoofs.includes(M.ids[b]) ? mix(C_SIM, [200, 190, 255], sun * 0.5) : mix([28, 52, 108], [80, 160, 255], sun * 0.8));
    layers.push(
      new SolidPolygonLayer({
        id: 'pv',
        data: pv,
        pickable: true,
        // 3D: a low raised slab (panel on its mount) with a glassy specular glint
        extruded: e3,
        getElevation: 0.3,
        material: MAT,
        getPolygon: (x: MiniWorld['pv'][number]) => (e3 ? x.polygon.map((q) => [q[0], q[1], x.h + 0.15]) : x.polygon) as never,
        getFillColor: (x: MiniWorld['pv'][number]) => (f.faultRoofs.includes(M.ids[x.b]) ? rgba(C_FAULT, 170) : rgba(pvBase(x.b), 225)) as never,
        parameters: e3 ? undefined : FLAT,
        onHover: (i: { object?: MiniWorld['pv'][number]; x: number; y: number }) => onHover(i.object ? panelId(M.ids[i.object.b], i.object.j) : null, i.x, i.y),
        onClick: (i: { object?: MiniWorld['pv'][number] }) => onClick(i.object ? panelId(M.ids[i.object.b], i.object.j) : null),
        updateTriggers: { getFillColor: [Math.round(sun * 10), f.faultRoofs.join(','), f.simRoofs.join(',')], getPolygon: [e3] },
      } as never),
    );
    // module detail: aluminium frame, the 4 module joints and the cell rows — visible once you zoom in
    {
      const cells: Array<{ path: number[][]; z: number }> = [];
      const frame: Array<{ path: number[][]; z: number }> = [];
      const lerp = (a: number[], b: number[], t: number) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      for (const x of pv) {
        const [p0, p1, p2, p3] = x.polygon;
        const z = e3 ? x.h + 0.46 : 0;
        frame.push({ path: [p0, p1, p2, p3, p0], z });
        for (const t of [0.25, 0.5, 0.75]) cells.push({ path: [lerp(p0, p1, t), lerp(p3, p2, t)], z });
        cells.push({ path: [lerp(p0, p3, 0.5), lerp(p1, p2, 0.5)], z });
      }
      const at = (d: { path: number[][]; z: number }) => d.path.map((q) => [q[0], q[1], d.z]) as never;
      layers.push(
        new PathLayer({ id: 'pv-cells', data: cells, getPath: at, getWidth: 0.07, widthUnits: 'meters', widthMinPixels: 0.4, getColor: [170, 200, 255, 130] as never, parameters: e3 ? undefined : FLAT, updateTriggers: { getPath: [e3] } } as never),
        new PathLayer({ id: 'pv-frame', data: frame, getPath: at, getWidth: 0.12, widthUnits: 'meters', widthMinPixels: 0.6, getColor: (f.dark ? [190, 200, 215, 200] : [226, 232, 240, 230]) as never, parameters: e3 ? undefined : FLAT, updateTriggers: { getPath: [e3], getColor: [f.dark] } } as never),
      );
    }
    // individual panels highlighted from the sidebar (hover)
    if (f.panelHi.length) {
      const hi = pv.filter((x) => f.panelHi.includes(panelId(M.ids[x.b], x.j)));
      const acc = ACCENT[f.dark ? 'dark' : 'light'];
      layers.push(
        new SolidPolygonLayer({
          id: 'pv-hi-fill',
          data: hi,
          getPolygon: (x: MiniWorld['pv'][number]) => (e3 ? x.polygon.map((q) => [q[0], q[1], x.h + 0.5]) : x.polygon) as never,
          getFillColor: rgba(mix(acc, [255, 255, 255], 0.35), 255) as never,
          parameters: FLAT,
        } as never),
        new PathLayer({
          id: 'pv-hi',
          data: hi,
          getPath: (x: MiniWorld['pv'][number]) => [...x.polygon, x.polygon[0]].map((q) => [q[0], q[1], e3 ? x.h + 0.55 : 0]) as never,
          getWidth: 3,
          widthUnits: 'pixels',
          getColor: rgba(f.dark ? [255, 255, 255] : [10, 20, 40]) as never,
          parameters: FLAT,
        }),
      );
    }
  }

  /* ---------- outlines: hover, selection, broken arrays, simulated solar ---------- */
  const accent = ACCENT[f.dark ? 'dark' : 'light'];
  const outl = M.buildings.filter((x) => {
    const id = M.ids[x.b];
    return id === sel || id === hov || f.faultRoofs.includes(id) || f.simRoofs.includes(id) || sel === `pv:${id}`;
  });
  const outlColor = (id: string): RGB => (id === sel || id === hov || sel === `pv:${id}` ? accent : f.faultRoofs.includes(id) ? C_FAULT : C_SIM);
  layers.push(
    new PathLayer({
      id: 'outlines-all',
      data: M.buildings,
      getPath: (x: MiniWorld['buildings'][number]) => x.polygon[0].map((q) => [q[0], q[1], e3 ? M.heights[x.b] + 0.05 : 0]) as never,
      getWidth: 0.5,
      getColor: base.outline as never,
      widthUnits: 'meters',
      widthMinPixels: 0.5,
      ...(e3 ? {} : { parameters: FLAT }),
      updateTriggers: { getPath: [e3], getColor: [f.dark] },
    } as never),
    new PathLayer({
      id: 'outlines-hi',
      data: outl,
      getPath: (x: MiniWorld['buildings'][number]) => x.polygon[0].map((q) => [q[0], q[1], e3 ? M.heights[x.b] + 0.1 : 0]) as never,
      getWidth: (x: MiniWorld['buildings'][number]) => (M.ids[x.b] === sel ? 2.2 : 1.6),
      getColor: (x: MiniWorld['buildings'][number]) => rgba(outlColor(M.ids[x.b])) as never,
      widthUnits: 'meters',
      widthMinPixels: 1.5,
      jointRounded: true,
      ...(e3 ? {} : { parameters: FLAT }),
    } as never),
  );

  /* ---------- substation + battery yard ---------- */
  if (L.assets) {
    // stations stand out by being filled with their own colour (no halo): substation = UPC blue, yard = teal
    const acc = ACCENT[f.dark ? 'dark' : 'light'];
    const yardCol: RGB = f.units.some((u) => u.fault) ? C_FAULT : C_BATT;
    const act = snap?.battKw ?? 0;
    // state colour of a working real unit: charging / discharging / idle
    const stateCol: RGB = act > 5 ? C_BATT : act < -5 ? C_IMPORT : C_EXPORT;
    const white: RGB = [255, 255, 255];
    const battMat: Record<BattPart, RGB> = {
      yard: mix(yardCol, f.dark ? [40, 46, 56] : white, f.dark ? 0.55 : 0.72),
      fence: f.dark ? [150, 158, 170] : [120, 128, 140],
      plinth: [196, 192, 184],
      body: f.dark ? [178, 186, 194] : [232, 235, 238],
      roof: stateCol,
      roofgrey: [150, 158, 168],
      hvac: [120, 130, 142],
      door: [104, 116, 130],
      pcs: [214, 218, 222],
      tank: [92, 104, 118],
      radiator: [70, 80, 92],
      bushing: [214, 206, 194],
      kiosk: mix(C_BATT, [0, 0, 0], 0.2),
      hydrant: C_FAULT,
      trench: [96, 100, 106],
    };
    // each unit gets its own containers (one per ~400 kWh), real units first; the roof carries the unit's state
    // (simulated units violet, faulty red); unused slots show as empty plinths = room to expand
    const battItems: Array<{ id: string; polygon: number[][]; h: number; color: RGB }> = [];
    const put = (b: Box3<BattPart>, color: RGB) => battItems.push({ id: 'battery', polygon: b.polygon.map((q) => [q[0], q[1], e3 ? b.z : 0]), h: b.h, color });
    for (const b of M.battery.parts) put(b, battMat[b.k]);
    // one container per ~400 kWh in the 20 ground slots; once those are full, containers are stacked on top
    // (level 2, 3, ...) so every installed unit stays visible
    const slots = M.battery.containers.length;
    const STACK = 3.05; // plinth-free height of one container level
    let slot = 0;
    for (const u of f.units) {
      const n = Math.max(1, Math.min(8, Math.round(u.kwh / 400)));
      const roof: RGB = u.fault ? C_FAULT : u.sim ? C_SIM : stateCol;
      for (let k = 0; k < n; k++, slot++) {
        const lift = Math.floor(slot / slots) * STACK;
        for (const b of M.battery.containers[slot % slots]) {
          if (lift && b.k === 'plinth') continue;
          put({ ...b, z: b.z + lift }, b.k === 'roof' ? roof : b.k === 'body' && (u.fault || u.sim) ? mix(battMat.body, roof, 0.25) : battMat[b.k]);
        }
      }
    }
    for (let s = slot; s < slots; s++) put(M.battery.containers[s][0], mix(battMat.plinth, battMat.yard, 0.5));
    const subCol: RGB = f.outage ? C_FAULT : acc;
    // substation plant: the building and the yard carry the station colour, the rest is real material colours
    const subMat: Record<SubPart, RGB> = {
      yard: mix(subCol, f.dark ? [40, 46, 56] : white, f.dark ? 0.55 : 0.72),
      fence: f.dark ? [150, 158, 170] : [120, 128, 140],
      building: subCol,
      roof: mix(subCol, [0, 0, 0], 0.3),
      plinth: [196, 192, 184],
      tank: f.outage ? mix(C_FAULT, [90, 98, 110], 0.5) : [92, 104, 118],
      radiator: [70, 80, 92],
      bushing: [214, 206, 194],
      steel: [160, 168, 178],
      wall: [184, 180, 172],
      conductor: [70, 74, 80],
      insulator: [206, 120, 80],
    };
    const subItems = M.substation.parts.map((p) => ({ id: 'substation', polygon: p.polygon.map((q) => [q[0], q[1], e3 ? p.z : 0]), h: p.h, color: subMat[p.k] }));
    layers.push(
      new SolidPolygonLayer({
        id: 'substation-plant',
        data: subItems,
        extruded: e3,
        pickable: true,
        getPolygon: (d: (typeof subItems)[number]) => d.polygon as never,
        getElevation: (d: (typeof subItems)[number]) => d.h,
        getFillColor: (d: (typeof subItems)[number]) => rgba(d.id === sel ? mix(d.color, accent, 0.3) : d.id === hov ? mix(d.color, white, 0.15) : d.color, 255) as never,
        material: MAT,
        ...(e3 ? {} : { parameters: FLAT }),
        onHover: (i: { object?: (typeof subItems)[number]; x: number; y: number }) => onHover(i.object ? i.object.id : null, i.x, i.y),
        onClick: (i: { object?: (typeof subItems)[number] }) => onClick(i.object ? i.object.id : null),
        updateTriggers: { getFillColor: [f.outage, f.dark, hov, sel], getPolygon: [e3] },
      } as never),
    );
    const assetItems = battItems;
    // crisp double outline (contrasting casing + darker station edge) so both compounds read at any zoom
    const rings = [
      { id: 'substation', path: [...M.substation.polygon, M.substation.polygon[0]], z: 0.15, c: subCol },
      { id: 'battery', path: [...M.battery.pad, M.battery.pad[0]], z: 0.15, c: yardCol },
    ];
    const casing: RGB = f.dark ? [12, 16, 22] : [255, 255, 255];
    const unitKey = f.units.map((u) => `${u.id}${u.kwh}${u.fault}${u.sim}`).join(',');
    layers.push(
      new SolidPolygonLayer({
        id: 'assets',
        data: assetItems,
        extruded: e3,
        pickable: true,
        getPolygon: (d: (typeof assetItems)[number]) => d.polygon as never,
        getElevation: (d: (typeof assetItems)[number]) => d.h,
        getFillColor: (d: (typeof assetItems)[number]) => rgba(d.id === sel ? mix(d.color, accent, 0.3) : d.id === hov ? mix(d.color, white, 0.15) : d.color, 255) as never,
        material: MAT,
        ...(e3 ? {} : { parameters: FLAT }),
        onHover: (i: { object?: (typeof assetItems)[number]; x: number; y: number }) => onHover(i.object ? i.object.id : null, i.x, i.y),
        onClick: (i: { object?: (typeof assetItems)[number] }) => onClick(i.object ? i.object.id : null),
        updateTriggers: { getFillColor: [unitKey, Math.sign(Math.round(act / 5)), f.outage, f.dark, hov, sel], getPolygon: [e3, unitKey] },
      } as never),
      new PathLayer({
        id: 'station-casing',
        data: rings,
        getPath: (r: (typeof rings)[number]) => r.path.map((q) => [q[0], q[1], e3 ? r.z + 0.05 : 0]) as never,
        getWidth: (r: (typeof rings)[number]) => (r.id === hov || r.id === sel ? 9 : 7),
        widthUnits: 'pixels',
        getColor: rgba(casing) as never,
        jointRounded: true,
        ...(e3 ? {} : { parameters: FLAT }),
        updateTriggers: { getWidth: [hov, sel], getColor: [f.dark], getPath: [e3] },
      } as never),
      new PathLayer({
        id: 'station-edge',
        data: rings,
        getPath: (r: (typeof rings)[number]) => r.path.map((q) => [q[0], q[1], e3 ? r.z + 0.1 : 0]) as never,
        getWidth: (r: (typeof rings)[number]) => (r.id === hov || r.id === sel ? 4 : 3),
        widthUnits: 'pixels',
        getColor: (r: (typeof rings)[number]) => rgba(mix(r.c, [0, 0, 0], 0.25)) as never,
        jointRounded: true,
        ...(e3 ? {} : { parameters: FLAT }),
        updateTriggers: { getWidth: [hov, sel], getColor: [f.outage, f.dark, unitKey], getPath: [e3] },
      } as never),
    );
  }

  /* ---------- people ---------- */
  if (L.people && snap && derived.current) {
    const dd = new Date(weekMsAt(derived.current.week.ms, snap.tMin));
    const hod = dd.getUTCHours();
    const dow = (dd.getUTCDay() + 6) % 7;
    const dots: number[][] = [];
    M.people.forEach((spots, b) => {
      const n = Math.round(spots.length * occupancy(M.categories[b], hod, dow));
      for (let i = 0; i < n; i++) dots.push(spots[i]);
    });
    layers.push(
      new ScatterplotLayer({
        id: 'people',
        data: dots,
        getPosition: (d: number[]) => d as never,
        getRadius: 0.9,
        radiusUnits: 'meters',
        radiusMinPixels: 1,
        getFillColor: (f.dark ? [190, 220, 255, 220] : [40, 70, 120, 200]) as never,
        parameters: FLAT,
      }),
    );
  }

  /* ---------- weather: clouds from the station irradiance ---------- */
  if (L.weather && snap && snap.cloud > 0.05) {
    const drift = snap.tMin * 0.25 + f.phase * 6;
    const azr = (snap.sunAz * Math.PI) / 180;
    const sh = elev > 6 ? 150 / Math.tan((elev * Math.PI) / 180) : 0;
    const discs: Array<{ pos: number[]; r: number; sh: number[] }> = [];
    for (const c of M.clouds) {
      if (c.k > snap.cloud * 0.95) continue;
      const cx = ((((c.pos[0] + drift + 700) % 1400) + 1400) % 1400) - 700;
      for (const part of c.parts) {
        const x = cx + part.dx;
        const y = c.pos[1] + part.dy;
        discs.push({ pos: [...toLonLat([x, y]), e3 ? 150 : 0], r: part.r, sh: toLonLat([x - Math.sin(azr) * sh, y - Math.cos(azr) * sh]) });
      }
    }
    if (elev > 2) {
      layers.push(
        new ScatterplotLayer({
          id: 'cloud-shadows',
          data: discs,
          getPosition: (d: (typeof discs)[number]) => d.sh as never,
          getRadius: (d: (typeof discs)[number]) => d.r,
          radiusUnits: 'meters',
          getFillColor: [20, 30, 60, Math.round(9 * Math.min(1, elev / 12))] as never,
          parameters: FLAT,
        }),
      );
    }
    layers.push(
      new ScatterplotLayer({
        id: 'clouds',
        data: discs,
        getPosition: (d: (typeof discs)[number]) => d.pos as never,
        getRadius: (d: (typeof discs)[number]) => d.r,
        radiusUnits: 'meters',
        getFillColor: (f.dark ? [200, 210, 230, Math.round(6 + 14 * day)] : [255, 255, 255, Math.round(10 + 45 * day)]) as never,
        parameters: { depthWriteEnabled: false } as never,
      }),
    );
  }
  return layers;
}
