#!/usr/bin/env node
/**
 * build-network-data.mjs — precomputes the underground cable network (scene/streetNetwork.ts: shortest-path
 * tree from the substation along the real streets and footpaths, drawn beside them) into public/data/network.json.
 * Routing takes ~1 s, so doing it at build time keeps the app start fast. Re-run after campus.json changes:
 *   npm run build:network
 */
import { createServer } from 'vite';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const vs = await createServer({ root: ROOT, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
  const N = await vs.ssrLoadModule('/src/scene/streetNetwork.ts');
  const G = await vs.ssrLoadModule('/src/scene/geo.ts');
  const campus = JSON.parse(readFileSync(join(ROOT, 'public/data/campus.json'), 'utf8'));
  const ground = JSON.parse(readFileSync(join(ROOT, 'public/data/ground.json'), 'utf8'));
  const geos = campus.features.map((f) => {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    return {
      rings: polys.map((p) => G.normRing(p[0].map((c) => G.toLocal(c)))),
      holes: polys.map((p) => p.slice(1).map((r) => G.normRing(r.map((c) => G.toLocal(c))).reverse())),
    };
  });
  // cables follow the streets of the campus area (scene/streetNetwork.ts)
  const net = N.buildStreetNetwork(campus.features, geos, ground.roads, campus.substation, campus.batterySite, campus.bbox);
  const r2 = (v) => Math.round(v * 100) / 100;
  const pt = (p) => [r2(p[0]), r2(p[1])];
  const out = {
    nodes: net.nodes.map((n) => ({ ...n, pos: pt(n.pos) })),
    edges: net.edges.map((e) => ({ ...e, path: e.path.map(pt), len: r2(e.len) })),
    parentEdge: net.parentEdge,
    order: net.order,
    axis: net.axis,
    manholes: net.manholes.map(pt),
  };
  writeFileSync(join(ROOT, 'public/data/network.json'), JSON.stringify(out));
  console.log({ nodes: out.nodes.length, edges: out.edges.length, manholes: out.manholes.length });
} finally {
  await vs.close();
}
