#!/usr/bin/env node
/**
 * build-campus-data.mjs
 * ---------------------
 * Builds `public/data/campus.json` from the raw OpenStreetMap extract in
 * `data-raw/campus-overpass.json`.
 *
 * Pipeline:
 *   1. Select the UPC Campus Nord buildings from the raw Overpass response
 *      (ways + multipolygon relations) using a curated name list.
 *   2. Assemble rings (outer + inner) into proper Polygons / MultiPolygons.
 *   3. Normalize properties: display name, school, usage category, height,
 *      footprint area, solar-roof potential and an electrical "overdrive"
 *      factor used by the demo simulator.
 *   4. Emit one GeoJSON FeatureCollection plus static site metadata
 *      (substation / battery site, campus bounding box).
 *
 * Data source: (c) OpenStreetMap contributors, ODbL 1.0. Attribution is
 * required when the map is displayed and is set in MapView.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const RAW = join(HERE, '..', 'data-raw', 'campus-overpass.json');
const OUT = join(HERE, '..', 'public', 'data', 'campus.json');

// ---------------------------------------------------------------- helpers ---

const EARTH_M_PER_DEG = 111_320; // good enough for a campus-scale projection

/** Project lon/lat to local meters around an origin latitude. */
function toMeters([lon, lat], originLat) {
  const x = lon * EARTH_M_PER_DEG * Math.cos((originLat * Math.PI) / 180);
  const y = lat * EARTH_M_PER_DEG;
  return [x, y];
}

/** Shoelace area in m^2 of a lon/lat ring, projected around its own latitude. */
function ringArea(ring) {
  if (!ring || ring.length < 3) return 0;
  const originLat = ring[0][1];
  const pts = ring.map(([lon, lat]) => toMeters([lon, lat], originLat));
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

/** Area-weighted centroid (lon/lat) of a ring. */
function ringCentroid(ring) {
  if (!ring || ring.length === 0) return null;
  let x = 0, y = 0, w = 0;
  const originLat = ring[0][1];
  const pts = ring.map(([lon, lat]) => toMeters([lon, lat], originLat));
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[i + 1];
    const cross = x1 * y2 - x2 * y1;
    x += (x1 + x2) * cross;
    y += (y1 + y2) * cross;
    w += cross;
  }
  if (Math.abs(w) < 1e-9) {
    // tiny / degenerate: fallback to mean
    for (const [lon, lat] of ring) { x += lon; y += lat; }
    return [x / ring.length, y / ring.length];
  }
  return [x / (3 * w) / (EARTH_M_PER_DEG * Math.cos((originLat * Math.PI) / 180)), y / (3 * w) / EARTH_M_PER_DEG];
}

/** Ray-casting point-in-polygon (lon/lat ring). */
function pointInRing([lon, lat], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// ------------------------------------------------- curation of the campus ---

/** Buildings we explicitly want, mapped to demo metadata. */
const NAMED = {
  "Escola Tècnica Superior d'Enginyeria Industrial de Barcelona": { short: 'ETSEIB', school: 'Industrial Engineering', category: 'teaching', levels: 12, overdrive: 1.2, pv: 0.45 },
  "Escola Tècnica Superior d'Enginyeria de Telecomunicació de Barcelona": { short: 'ETSETB', school: 'Telecom Engineering', category: 'teaching', levels: 3, overdrive: 1.25, pv: 0.5 },
  "Escola Tècnica Superior d'Arquitectura de Barcelona": { short: 'ETSAB', school: 'Architecture', category: 'teaching', levels: 5, overdrive: 0.9, pv: 0.4 },
  "Escola Politècnica Superior d'Edificació de Barcelona": { short: 'EPSEB', school: 'Building Engineering', category: 'teaching', levels: 7, overdrive: 1.0, pv: 0.45 },
  'Facultat d\'Economia i Empresa': { short: 'FEE', school: 'Economy & Business', category: 'teaching', levels: 5, overdrive: 0.8, pv: 0.4 },
  'Edifici Vèrtex': { short: 'Vèrtex', school: 'UPC innovation hub', category: 'mixed', levels: 7, overdrive: 1.5, pv: 0.35 },
  'Nexus 1': { short: 'Nexus I', school: 'BSC-CNS', category: 'research', levels: 4, overdrive: 2.2, pv: 0.4 },
  'Nexus 2': { short: 'Nexus II', school: 'BSC-CNS', category: 'research', levels: 4, overdrive: 2.2, pv: 0.4 },
  'Edifici BSC-Repsol': { short: 'BSC-Repsol', school: 'BSC-CNS', category: 'research', levels: 4, overdrive: 2.0, pv: 0.4 },
  'Edifici Omega': { short: 'Omega', school: 'UPC research', category: 'research', levels: 5, overdrive: 1.6, pv: 0.4 },
  'Edifici Capella': { short: 'MareNostrum', school: 'BSC-CNS · HPC data center', category: 'data_center', levels: 1, overdrive: 4, pv: 0.0 },
  'Edifici Til·lers': { short: 'Til·lers', school: 'Facilities', category: 'aux', levels: 3, overdrive: 1.0, pv: 0.5 },
  'Biblioteca Rector Gabriel Ferraté': { short: 'Library RGF', school: 'Library', category: 'library', levels: 4, overdrive: 1.0, pv: 0.6 },
  'Biblioteca Oriol Bohigas': { short: 'Library OB', school: 'Library', category: 'library', levels: 2, overdrive: 0.9, pv: 0.6 },
  'Poliesportiu UPC': { short: 'Sports Centre', school: 'Sports', category: 'sports', levels: 2, overdrive: 1.1, pv: 0.8 },
  'Residència universitària Aleu': { short: 'Res. Aleu', school: 'Housing', category: 'residence', levels: 5, overdrive: 0.9, pv: 0.5 },
  'Residencia Universitaria Torre Girona': { short: 'Res. Torre Girona', school: 'Housing', category: 'residence', levels: 6, overdrive: 0.9, pv: 0.5 },
};

/** Lettered aulari blocks A/B/C/D -> school + category. */
function letteredMeta(id) {
  const block = id[0];
  const map = {
    A: { short: `Edifici ${id}`, school: 'ETSEIB aulari', category: 'teaching', levels: 5, overdrive: 1.1, pv: 0.5 },
    B: { short: `Edifici ${id}`, school: 'ETSETB aulari', category: 'lab', levels: 3, overdrive: 1.4, pv: 0.45 },
    C: { short: `Edifici ${id}`, school: 'FIB · Informatics', category: 'lab', levels: 3, overdrive: 1.5, pv: 0.45 },
    D: { short: `Edifici ${id}`, school: 'Departments & labs', category: 'lab', levels: 3, overdrive: 1.3, pv: 0.4 },
  };
  if (id === 'B0') return { ...map.B, category: 'aux', pv: 0.3 };
  if (id === 'C6') return { ...map.C, overdrive: 2.0 }; // UPC server room wing
  return map[block] ?? null;
}

/** Buildings that must never enter the demo (adjacent, non-campus). */
const BLACKLIST = /Palau Reial|INSST|Censors|Abertis/i;

const source = JSON.parse(readFileSync(RAW, 'utf8'));
const ways = source.elements.filter((e) => e.type === 'way' && e.geometry && e.geometry.length > 3);
const rels = source.elements.filter((e) => e.type === 'relation' && Array.isArray(e.members));

function ringOfMember(m) {
  const g = (m.geometry || []).filter((p) => p);
  if (g.length < 4) return null;
  const closed = g[0].lat === g[g.length - 1].lat && g[0].lon === g[g.length - 1].lon;
  if (!closed) return null;
  return g.map((p) => [p.lon, p.lat]);
}

// name candidates -> metadata
function nameMeta(name) {
  if (!name) return null;
  if (BLACKLIST.test(name)) return null;
  const m1 = NAMED[name];
  if (m1) return m1;
  if (/^[A-D][0-6]$/.test(name)) return letteredMeta(name);
  return null;
}

const features = [];
const usedMemberWays = new Set();

// 1) relations (multipolygon buildings)
for (const rel of rels) {
  const meta = nameMeta(rel.tags?.name);
  if (!meta) continue;
  const outers = [];
  const inners = [];
  for (const m of rel.members) {
    if (m.type !== 'way') continue;
    usedMemberWays.add(m.ref);
    const ring = ringOfMember(m);
    if (!ring) continue;
    (m.role === 'inner' ? inners : outers).push(ring);
  }
  if (outers.length === 0) continue;
  // attach each inner ring to the outer polygon containing its first vertex
  const polygons = outers.map((outer) => ({ outer, holes: [] }));
  for (const hole of inners) {
    const host = polygons.find((p) => pointInRing(hole[0], p.outer));
    if (host) host.holes.push(hole); else polygons.push({ outer: hole, holes: [] });
  }
  const area = polygons.reduce((s, p) => s + ringArea(p.outer), 0);
  // label point: centroid of the *largest* outer ring so labels never fall in courtyard holes
  const largest = Math.max(...polygons.map((p) => ringArea(p.outer)));
  const centroid = (polygons.find((p) => Math.abs(ringArea(p.outer) - largest) < 1e-9) ?? polygons[0]).outer;
  features.push({
    type: 'Feature',
    geometry: {
      type: 'MultiPolygon',
      coordinates: polygons.map((p) => [[...p.outer], ...p.holes]),
    },
    properties: {
      osmId: `r${rel.id}`,
      ...meta,
      name: rel.tags?.name,
      area_m2: Math.round(area),
      height_m: Math.round(meta.levels * 3.4),
      pv_fraction: meta.pv,
    },
    _centroid: ringCentroid(centroid),
  });
}

// 2) standalone ways
for (const w of ways) {
  if (usedMemberWays.has(w.id)) continue;
  const meta = nameMeta(w.tags?.name);
  if (!meta) continue; // unnamed structures are omitted for clarity
  const ring = w.geometry.filter(Boolean).map((p) => [p.lon, p.lat]);
  if (ring.length < 4) continue;
  const closed = ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1];
  if (!closed) continue;
  const area = ringArea(ring);
  if (area < 250) continue; // skip kiosks / small structures
  features.push({
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [ring] },
    properties: {
      osmId: `w${w.id}`,
      ...meta,
      name: w.tags?.name,
      area_m2: Math.round(area),
      height_m: Math.round(meta.levels * 3.4),
      pv_fraction: meta.pv,
    },
    _centroid: ringCentroid(ring),
  });
}

if (features.length === 0) throw new Error('No buildings matched — check the raw extract.');

// ---------------------------------------------------------- site metadata ---

const allRings = features.map((f) => (f.geometry.type === 'Polygon' ? f.geometry.coordinates[0] : f.geometry.coordinates[0][0]));
let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
for (const ring of allRings) {
  for (const [lon, lat] of ring) {
    minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
    minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon);
  }
}
// Grid substation + battery site: the open south-east plaza of the campus
// (between the residences and Carrer del Gran Capità), picked from a clearance
// scan so the pins never overlap a rooftop.
const substation = [2.11755, 41.3856];
const batterySite = [2.117, 41.3852];

const out = {
  type: 'FeatureCollection',
  attribution: '© OpenStreetMap contributors (ODbL)',
  bbox: [minLon, minLat, maxLon, maxLat],
  batterySite,
  substation,
  features: features.map((f) => ({
    type: 'Feature',
    geometry: f.geometry,
    properties: { ...f.properties, centroid: f._centroid },
  })),
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(out));
console.log(`✓ ${features.length} buildings -> ${OUT}`);
console.log(`  categories:`, features.reduce((acc, f) => { acc[f.properties.category] = (acc[f.properties.category] || 0) + 1; return acc; }, {}));
console.log(`  substation @ ${substation.map((n) => n.toFixed(5)).join(', ')} · battery @ ${batterySite.map((n) => n.toFixed(5)).join(', ')}`);
