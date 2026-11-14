/**
 * Minimal campus map: a clean, light, mostly-flat rendering of the OpenStreetMap footprints.
 * Only what tells the story: ground, roads, neighbourhood context, and the campus buildings coloured by how much
 * power they draw right now (heat ramp + soft glow + a floating kW tag).
 *
 * Much cheaper than scene/world.ts (no windows, trees, cars, cables, rooftop plant): it builds in a few ms,
 * which is what makes the app open fast.
 */
import { PathLayer, ScatterplotLayer, SolidPolygonLayer, TextLayer } from '@deck.gl/layers';
import type { CampusData, GroundData, Snapshot } from '../types';
import { type P2, centroid, normRing, toLocal, toLonLat } from './geo';
import { derived } from '../store/useSim';
import { fmtKw } from '../lib/format';

type RGB = [number, number, number];
type RGBA = [number, number, number, number];

/* light "map" palette */
const C_GREEN: RGB = [218, 236, 214];
const C_PITCH: RGB = [205, 230, 200];
const C_PARKING: RGB = [234, 235, 238];
const C_ROAD: RGB = [255, 255, 255];
const C_ROAD_EDGE: RGB = [221, 224, 229];
const C_PATH: RGB = [246, 246, 244];
const C_CONTEXT: RGB = [226, 228, 232];
const C_CONTEXT_EDGE: RGB = [206, 209, 214];
const C_OUTLINE: RGB = [120, 60, 40];
const C_SELECT: RGB = [0, 123, 192]; // UPC blue

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

const rgba = (c: RGB, a = 255): RGBA => [Math.round(c[0]), Math.round(c[1]), Math.round(c[2]), a];

export interface MiniWorld {
  ids: string[];
  /** short tag name per building ("C4", "ETSEIB") */
  tags: string[];
  heights: number[];
  /** lon/lat centre per building */
  centers: number[][];
  buildings: Array<{ polygon: number[][][]; b: number }>;
  context: Array<{ polygon: number[][]; h: number }>;
  greens: Array<{ polygon: number[][]; color: RGB }>;
  roads: Array<{ path: number[][]; w: number; major: boolean }>;
  /** max per-building kW over the current week (heat normalisation), cached per week */
  peakKw: number;
  peakWeek: string;
}

const shortTag = (s: string) => s.replace(/^Edifici\s+/i, '').replace(/^Res\.\s*/i, '');

export function buildMinimal(campus: CampusData, ground: GroundData): MiniWorld {
  const M: MiniWorld = {
    ids: [],
    tags: [],
    heights: [],
    centers: [],
    buildings: [],
    context: [],
    greens: [],
    roads: [],
    peakKw: 1,
    peakWeek: '',
  };
  campus.features.forEach((f, b) => {
    const p = f.properties;
    const polys = (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates) as number[][][][];
    let biggest: P2[] = [];
    for (const pl of polys) {
      M.buildings.push({ polygon: pl.map((r) => r.map((q) => [q[0], q[1]])), b });
      const ring = normRing(pl[0].map((c) => toLocal(c)));
      if (ring.length > biggest.length) biggest = ring;
    }
    M.ids.push(p.osmId);
    M.tags.push(shortTag(p.short));
    M.heights.push(Math.max(4, p.height_m));
    M.centers.push(toLonLat(centroid(biggest)));
  });
  for (const g of ground.greens) {
    M.greens.push({ polygon: g.p.map((q) => [q[0], q[1]]), color: g.k === 'pitch' ? C_PITCH : g.k === 'parking' ? C_PARKING : C_GREEN });
  }
  for (const r of ground.roads) M.roads.push({ path: r.p.map((q) => [q[0], q[1]]), w: r.w, major: r.w >= 4 });
  for (const c of ground.context) if (c.p.length >= 3) M.context.push({ polygon: c.p.map((q) => [q[0], q[1]]), h: c.h });
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

export interface MiniFrame {
  snap: Snapshot | null;
  hoverId: string | null;
  selection: string | null;
  mode3d: boolean;
  /** how many buildings get a floating kW tag (biggest consumers first) */
  maxTags: number;
}

const FLAT = { depthCompare: 'always', depthWriteEnabled: false } as never;

export function buildMinimalLayers(
  M: MiniWorld,
  f: MiniFrame,
  onHover: (id: string | null, x: number, y: number) => void,
  onClick: (id: string | null) => void,
) {
  const snap = f.snap;
  weekPeakKw(M);
  const kw = M.ids.map((id) => snap?.perB[id]?.loadKw ?? 0);
  // log scale: the data centre draws ~10x a teaching building, a linear ramp would paint everything else pale
  const t = kw.map((v) => Math.log1p(Math.max(0, v) / 5) / Math.log1p(M.peakKw / 5));
  const hourKey = `${M.peakWeek}:${snap?.hour ?? -1}`;
  const sel = f.selection;
  const hov = f.hoverId;
  const e3 = f.mode3d;

  const layers: unknown[] = [];

  // ground
  layers.push(
    new SolidPolygonLayer({
      id: 'greens',
      data: M.greens,
      getPolygon: (g: MiniWorld['greens'][number]) => g.polygon as never,
      getFillColor: (g: MiniWorld['greens'][number]) => rgba(g.color) as never,
      parameters: FLAT,
    }),
    new PathLayer({
      id: 'road-edge',
      data: M.roads.filter((r) => r.major),
      getPath: (r: MiniWorld['roads'][number]) => r.path as never,
      getWidth: (r: MiniWorld['roads'][number]) => r.w + 2,
      getColor: rgba(C_ROAD_EDGE) as never,
      widthUnits: 'meters',
      capRounded: true,
      jointRounded: true,
      parameters: FLAT,
    }),
    new PathLayer({
      id: 'roads',
      data: M.roads,
      getPath: (r: MiniWorld['roads'][number]) => r.path as never,
      getWidth: (r: MiniWorld['roads'][number]) => (r.major ? r.w : Math.max(1.5, r.w)),
      getColor: (r: MiniWorld['roads'][number]) => rgba(r.major ? C_ROAD : C_PATH) as never,
      widthUnits: 'meters',
      capRounded: true,
      jointRounded: true,
      parameters: FLAT,
    }),
  );

  // heat glow under the buildings: three soft discs per building, radius and opacity grow with the draw
  const glow: Array<{ pos: number[]; r: number; c: RGBA }> = [];
  M.centers.forEach((c, b) => {
    const v = t[b];
    if (v < 0.04) return;
    const col = heatColor(v);
    const base = 10 + 50 * v * v;
    glow.push({ pos: c, r: base * 1.7, c: rgba(col, Math.round(22 * v + 8)) });
    glow.push({ pos: c, r: base * 1.2, c: rgba(col, Math.round(34 * v + 10)) });
    glow.push({ pos: c, r: base * 0.8, c: rgba(col, Math.round(46 * v + 12)) });
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
      updateTriggers: { getRadius: [hourKey], getFillColor: [hourKey] },
    }),
  );

  // neighbourhood context (neutral)
  layers.push(
    new SolidPolygonLayer({
      id: 'context',
      data: M.context,
      extruded: e3,
      getPolygon: (c: MiniWorld['context'][number]) => c.polygon as never,
      getElevation: (c: MiniWorld['context'][number]) => c.h,
      getFillColor: rgba(C_CONTEXT) as never,
      getLineColor: rgba(C_CONTEXT_EDGE) as never,
      material: { ambient: 0.75, diffuse: 0.35, shininess: 4, specularColor: [60, 60, 60] } as never,
    }),
  );

  // campus buildings, heat-coloured
  const fill = (b: number): RGBA => {
    const id = M.ids[b];
    const c = heatColor(0.08 + 0.92 * t[b]);
    if (id === sel) return rgba([c[0] * 0.92, c[1] * 0.92, c[2] * 0.92]);
    if (id === hov) return rgba([c[0] * 0.95, c[1] * 0.95, c[2] * 0.95]);
    return rgba(c);
  };
  layers.push(
    new SolidPolygonLayer({
      id: 'buildings',
      data: M.buildings,
      extruded: e3,
      pickable: true,
      getPolygon: (x: MiniWorld['buildings'][number]) => x.polygon as never,
      getElevation: (x: MiniWorld['buildings'][number]) => M.heights[x.b],
      getFillColor: (x: MiniWorld['buildings'][number]) => fill(x.b) as never,
      material: { ambient: 0.7, diffuse: 0.45, shininess: 12, specularColor: [120, 120, 120] } as never,
      onHover: (i: { object?: MiniWorld['buildings'][number]; x: number; y: number }) => onHover(i.object ? M.ids[i.object.b] : null, i.x, i.y),
      onClick: (i: { object?: MiniWorld['buildings'][number] }) => onClick(i.object ? M.ids[i.object.b] : null),
      updateTriggers: { getFillColor: [hourKey, sel, hov] },
    }),
    // crisp outlines (roof level in 3D)
    new PathLayer<MiniWorld['buildings'][number]>({
      id: 'outlines',
      data: M.buildings,
      getPath: (x: MiniWorld['buildings'][number]) => x.polygon[0].map((q) => [q[0], q[1], e3 ? M.heights[x.b] + 0.05 : 0]) as never,
      getWidth: (x: MiniWorld['buildings'][number]) => (M.ids[x.b] === sel ? 2.4 : 0.6),
      getColor: (x: MiniWorld['buildings'][number]) => (M.ids[x.b] === sel ? rgba(C_SELECT) : rgba(C_OUTLINE, 70)) as never,
      widthUnits: 'meters',
      widthMinPixels: 1,
      jointRounded: true,
      ...(e3 ? {} : { parameters: FLAT }),
      updateTriggers: { getWidth: [sel], getColor: [sel], getPath: [e3] },
    }),
  );

  // floating kW tags on the biggest consumers (+ the hovered / selected building)
  const order = kw.map((v, b) => [v, b] as const).sort((a, b) => b[0] - a[0]);
  const tagged = new Set(order.slice(0, f.maxTags).map(([, b]) => b));
  M.ids.forEach((id, b) => (id === sel || id === hov) && tagged.add(b));
  const tags = [...tagged].map((b) => ({
    pos: [M.centers[b][0], M.centers[b][1], e3 ? M.heights[b] + 4 : 0],
    text: `${M.tags[b]}  ${fmtKw(kw[b])}`,
    b,
  }));
  layers.push(
    new TextLayer({
      id: 'tags',
      data: tags,
      getPosition: (x: (typeof tags)[number]) => x.pos as never,
      getText: (x: (typeof tags)[number]) => x.text,
      getSize: 11.5,
      getColor: [29, 29, 27, 255] as never,
      background: true,
      getBackgroundColor: [255, 255, 255, 240] as never,
      getBorderColor: (x: (typeof tags)[number]) => (M.ids[x.b] === sel ? rgba(C_SELECT) : rgba(heatColor(t[x.b]), 255)) as never,
      getBorderWidth: 1.2,
      backgroundPadding: [6, 3, 6, 3],
      billboard: true,
      fontFamily: '"Helvetica Neue", Arial, system-ui, sans-serif',
      fontWeight: 600,
      characterSet: 'auto',
      getTextAnchor: 'middle',
      getAlignmentBaseline: 'center',
      getPixelOffset: [0, -2],
      parameters: { depthCompare: 'always' } as never,
      updateTriggers: { getText: [hourKey], getBorderColor: [hourKey, sel] },
    }),
  );
  return layers;
}
