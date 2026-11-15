/**
 * Street-following cable network (built offline by scripts/build-network-data.mjs).
 *
 * Cables run in trenches beside the real streets and footpaths: a road graph is built from the OSM ways, every
 * asset is attached to its nearest road, and the shortest-path tree from the substation over that graph is the
 * cable tree. Straight chains are merged into long polylines and drawn offset to one side of the street, so
 * parallel runs line up neatly; each building gets a short service drop from the street to its nearest wall.
 */
import type { BuildingFeature } from '../types';
import { toLocal, type P2 } from './geo';
import { along, streetAxis, type BuildingGeo, type NetEdge, type NetNode, type Network } from './network';

interface RoadIn {
  c: string;
  w: number;
  p: [number, number][];
}

/** routing cost per metre by street class (prefer service roads and paths, avoid big roads) */
const COST: Record<string, number> = {
  footway: 1.15,
  path: 1.3,
  steps: 3,
  cycleway: 1.15,
  pedestrian: 1,
  service: 1,
  residential: 1.05,
  unclassified: 1.05,
  living_street: 1,
  tertiary: 1.1,
  secondary: 1.25,
  primary: 1.4,
  primary_link: 1.3,
};
/** cables sit this far from the street centreline (m) */
const OFF = 3;

const segPoint = (p: P2, A: P2, B: P2): { q: P2; d: number } => {
  const dx = B[0] - A[0];
  const dy = B[1] - A[1];
  const L2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - A[0]) * dx + (p[1] - A[1]) * dy) / L2));
  const q: P2 = [A[0] + dx * t, A[1] + dy * t];
  return { q, d: Math.hypot(p[0] - q[0], p[1] - q[1]) };
};

export function buildStreetNetwork(
  features: BuildingFeature[],
  geos: BuildingGeo[],
  roads: RoadIn[],
  substation: number[],
  battery: number[],
  bbox: [number, number, number, number],
): Network {
  const axis = streetAxis(geos);
  const margin = 0.0012;
  const inBox = ([x, y]: number[]) => x > bbox[0] - margin && x < bbox[2] + margin && y > bbox[1] - margin && y < bbox[3] + margin;

  /* ---- road graph (vertices merged on a 0.5 m grid) */
  const vid = new Map<string, number>();
  const V: P2[] = [];
  const adj: Array<Array<{ to: number; w: number }>> = [];
  const vtx = (p: P2) => {
    const k = `${Math.round(p[0] * 2)}:${Math.round(p[1] * 2)}`;
    let i = vid.get(k);
    if (i == null) {
      i = V.length;
      vid.set(k, i);
      V.push(p);
      adj.push([]);
    }
    return i;
  };
  const segs: Array<[number, number, number]> = [];
  const link = (a: number, b: number, m: number) => {
    if (a === b) return;
    const w = Math.hypot(V[a][0] - V[b][0], V[a][1] - V[b][1]) * m;
    adj[a].push({ to: b, w });
    adj[b].push({ to: a, w });
    segs.push([a, b, m]);
  };
  for (const r of roads) {
    if (!(r.c in COST) || !r.p.some(inBox)) continue;
    const pts = r.p.map((q) => toLocal(q));
    for (let i = 0; i < pts.length - 1; i++) link(vtx(pts[i]), vtx(pts[i + 1]), COST[r.c]);
  }

  /** attach a point: project on the nearest street segment and split it there */
  const attach = (p: P2): number => {
    let best = -1;
    let bd = Infinity;
    let bq: P2 = p;
    segs.forEach(([a, b], i) => {
      const { q, d } = segPoint(p, V[a], V[b]);
      if (d < bd) {
        bd = d;
        best = i;
        bq = q;
      }
    });
    if (best < 0) return vtx(p);
    const [a, b, m] = segs[best];
    const n = vtx(bq);
    link(a, n, m);
    link(n, b, m);
    return n;
  };

  /* ---- assets */
  const sub = toLocal(substation);
  const bat = toLocal(battery);
  const subV = attach(sub);
  const batV = attach(bat);
  const entrances = geos.map((g) => {
    // the wall point (vertex or edge midpoint) closest to any street = service entrance
    const ring = g.rings.reduce((a, r) => (r.length > a.length ? r : a), g.rings[0]);
    let wall: P2 = ring[0];
    let bd = Infinity;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      for (const c of [a, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] as P2]) {
        for (const [sa, sb] of segs) {
          const { d } = segPoint(c, V[sa], V[sb]);
          if (d < bd) {
            bd = d;
            wall = c;
          }
        }
      }
    }
    return { wall, road: attach(wall) };
  });

  /* ---- shortest-path tree from the substation (Dijkstra with a binary heap) */
  const dist = new Float64Array(V.length).fill(Infinity);
  const prev = new Int32Array(V.length).fill(-1);
  const heap: Array<[number, number]> = [];
  const push = (x: [number, number]) => {
    heap.push(x);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = (): [number, number] => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  const dijkstra = () => {
    dist.fill(Infinity);
    prev.fill(-1);
    dist[subV] = 0;
    push([0, subV]);
    while (heap.length) {
      const [d, u] = pop();
      if (d > dist[u]) continue;
      for (const { to, w } of adj[u]) {
        if (d + w < dist[to]) {
          dist[to] = d + w;
          prev[to] = u;
          push([d + w, to]);
        }
      }
    }
  };
  dijkstra();
  // OSM street pieces are not always connected (paths ending a few metres from a road): bridge every target that
  // the substation cannot reach to the closest reached street vertex with a short trench, then route again
  const targetsAll = [batV, ...entrances.map((e) => e.road)];
  for (let guard = 0; guard < 40; guard++) {
    const lost = targetsAll.find((t) => !Number.isFinite(dist[t]));
    if (lost == null) break;
    // all vertices of the lost piece (flood fill), and the closest pair to the reached network
    const piece = new Set<number>([lost]);
    const q = [lost];
    while (q.length) for (const { to } of adj[q.pop()!]) if (!piece.has(to)) (piece.add(to), q.push(to));
    let best: [number, number] = [lost, subV];
    let bd = Infinity;
    for (const a of piece) {
      for (let v = 0; v < V.length; v++) {
        if (!Number.isFinite(dist[v])) continue;
        const dd = Math.hypot(V[a][0] - V[v][0], V[a][1] - V[v][1]);
        if (dd < bd) {
          bd = dd;
          best = [a, v];
        }
      }
    }
    link(best[0], best[1], 1.5);
    dijkstra();
  }

  /* ---- the street vertices actually used and their children in the tree */
  const used = new Set<number>([subV]);
  for (const t of [batV, ...entrances.map((e) => e.road)]) for (let u = t; u !== -1 && !used.has(u); u = prev[u]) used.add(u);
  const kids = new Map<number, number[]>();
  for (const u of used) {
    if (u === subV || prev[u] < 0) continue;
    if (!kids.has(prev[u])) kids.set(prev[u], []);
    kids.get(prev[u])!.push(u);
  }
  const hang = new Map<number, number[]>(); // street vertex -> asset nodes fed from it
  const hangOn = (v: number, n: number) => hang.set(v, [...(hang.get(v) ?? []), n]);
  hangOn(batV, 1);
  entrances.forEach((e, i) => hangOn(e.road, i + 2));

  /* ---- offsetting: every street segment's cable sits on the same side ("left" when oriented west->east) */
  const normal = (a: P2, b: P2): P2 => {
    let dx = b[0] - a[0];
    let dy = b[1] - a[1];
    if (dx < 0 || (dx === 0 && dy < 0)) {
      dx = -dx;
      dy = -dy;
    }
    const L = Math.hypot(dx, dy) || 1;
    return [-dy / L, dx / L];
  };
  const offsetPath = (pts: P2[]): P2[] =>
    pts.map((p, i) => {
      const ns: P2[] = [];
      if (i > 0) ns.push(normal(pts[i - 1], p));
      if (i < pts.length - 1) ns.push(normal(p, pts[i + 1]));
      let nx = ns.reduce((a, n) => a + n[0], 0);
      let ny = ns.reduce((a, n) => a + n[1], 0);
      const L = Math.hypot(nx, ny) || 1;
      nx /= L;
      ny /= L;
      const cos = ns.length === 2 ? Math.max(0.5, ns[0][0] * nx + ns[0][1] * ny) : 1;
      return [p[0] + (nx * OFF) / cos, p[1] + (ny * OFF) / cos];
    });
  const plen = (pts: P2[]) => pts.reduce((a, p, i) => (i ? a + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);

  /* ---- network nodes: 0 substation, 1 battery, 2.. buildings, then junctions */
  const nodes: NetNode[] = [
    { kind: 'sub', pos: sub, b: -1 },
    { kind: 'batt', pos: bat, b: -1 },
    ...features.map((_, i) => ({ kind: 'bld' as const, pos: entrances[i].wall, b: i })),
  ];
  const edges: NetEdge[] = [];
  // the trench position (offset) of a street vertex, given a neighbour for the direction
  const trenchAt = (v: number, nb: number): P2 => (v === nb ? V[v] : offsetPath([V[v], V[nb]])[0]);

  // substation compound -> its street
  const nodeOfV = new Map<number, number>();
  {
    const nb = kids.get(subV)?.[0] ?? subV;
    const jid = nodes.length;
    nodes.push({ kind: 'jct', pos: trenchAt(subV, nb), b: -1 });
    const path: P2[] = [sub, trenchAt(subV, nb)];
    edges.push({ from: 0, to: jid, path, len: plen(path) });
    nodeOfV.set(subV, jid);
  }
  const stack: number[] = [subV];
  while (stack.length) {
    const start = stack.pop()!;
    const from = nodeOfV.get(start)!;
    for (const k of kids.get(start) ?? []) {
      const chain: number[] = [start, k];
      let cur = k;
      while ((kids.get(cur)?.length ?? 0) === 1 && !hang.has(cur)) {
        cur = kids.get(cur)![0];
        chain.push(cur);
      }
      const path = offsetPath(chain.map((v) => V[v]));
      const nid = nodes.length;
      nodes.push({ kind: 'jct', pos: path[path.length - 1], b: -1 });
      nodeOfV.set(cur, nid);
      edges.push({ from, to: nid, path, len: plen(path) });
      stack.push(cur);
    }
    // service drops from the trench to the assets attached at this street vertex
    for (const a of hang.get(start) ?? []) {
      const nb = prev[start] >= 0 ? prev[start] : (kids.get(start)?.[0] ?? start);
      const path: P2[] = [trenchAt(start, nb), nodes[a].pos];
      edges.push({ from, to: a, path, len: plen(path) });
    }
  }

  /* ---- tree bookkeeping: parent edge per node, BFS order, buildings fed per edge */
  const parentEdge = new Array(nodes.length).fill(-1);
  edges.forEach((e, i) => (parentEdge[e.to] = i));
  const children = new Map<number, number[]>();
  edges.forEach((e) => children.set(e.from, [...(children.get(e.from) ?? []), e.to]));
  const order: number[] = [0];
  for (let i = 0; i < order.length; i++) order.push(...(children.get(order[i]) ?? []));
  const down = new Array(nodes.length).fill(0);
  for (let i = order.length - 1; i > 0; i--) {
    const n = order[i];
    if (nodes[n].kind === 'bld') down[n] += 1;
    const e = parentEdge[n];
    if (e >= 0) {
      edges[e].down = down[n];
      down[edges[e].from] += down[n];
    }
  }

  /* ---- manholes at branch points and every ~60 m */
  const manholes: P2[] = [];
  nodes.forEach((n, i) => {
    if (n.kind === 'jct' && (children.get(i)?.length ?? 0) > 1) manholes.push(n.pos);
  });
  for (const e of edges) for (let s = 60; s < e.len - 30; s += 60) manholes.push(along(e.path, e.len, s / e.len));

  return { nodes, edges, parentEdge, order, axis, manholes };
}
