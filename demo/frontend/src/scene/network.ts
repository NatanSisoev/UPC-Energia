/**
 * Underground medium-voltage cable network: a minimum spanning tree over the substation, the battery and one
 * service entrance per building, routed as orthogonal runs aligned with the campus street grid (so cables
 * follow trenches along the streets instead of flying as arcs). Edge flows are the true subtree sums of the
 * building net loads, so a cable's width/colour/pulse direction is the power it really carries.
 */
import type { BuildingFeature } from '../types';
import { inside, toLocal, type P2 } from './geo';

export interface NetNode {
  kind: 'sub' | 'batt' | 'bld';
  pos: P2;
  /** index into campus.features for buildings */
  b: number;
}

export interface NetEdge {
  from: number;
  to: number;
  path: P2[];
  len: number;
}

export interface Network {
  nodes: NetNode[];
  edges: NetEdge[];
  /** edge index entering node i (or -1 for the root) */
  parentEdge: number[];
  /** node indices, parents before children */
  order: number[];
  /** campus street-grid angle (rad) */
  axis: number;
  manholes: P2[];
}

export interface BuildingGeo {
  rings: P2[][]; // outer rings only (local metres)
  holes: P2[][][];
}

/** dominant orientation of the building footprint edges, mod 90 degrees */
export function streetAxis(geos: BuildingGeo[]): number {
  let c = 0;
  let s = 0;
  for (const g of geos)
    for (const r of g.rings)
      for (let i = 0; i < r.length; i++) {
        const a = r[i];
        const b = r[(i + 1) % r.length];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
        c += len * Math.cos(4 * ang);
        s += len * Math.sin(4 * ang);
      }
  return Math.atan2(s, c) / 4;
}

const rot = (p: P2, a: number): P2 => [p[0] * Math.cos(a) - p[1] * Math.sin(a), p[0] * Math.sin(a) + p[1] * Math.cos(a)];

export function buildNetwork(features: BuildingFeature[], geos: BuildingGeo[], substation: number[], battery: number[]): Network {
  const axis = streetAxis(geos);
  const sub = toLocal(substation);
  const bat = toLocal(battery);
  const nodes: NetNode[] = [
    { kind: 'sub', pos: sub, b: -1 },
    { kind: 'batt', pos: bat, b: -1 },
  ];
  // service entrance: boundary point of the footprint closest to the substation, nudged 1.2 m outside
  features.forEach((_, i) => {
    const ring = geos[i].rings.reduce((a, r) => (r.length > a.length ? r : a), geos[i].rings[0]);
    let best: P2 = ring[0];
    let bd = Infinity;
    for (let k = 0; k < ring.length; k++) {
      const a = ring[k];
      const b = ring[(k + 1) % ring.length];
      for (let t = 0; t <= 1; t += 0.25) {
        const p: P2 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        const d = Math.hypot(p[0] - sub[0], p[1] - sub[1]);
        if (d < bd) {
          bd = d;
          best = p;
        }
      }
    }
    const dx = sub[0] - best[0];
    const dy = sub[1] - best[1];
    const l = Math.hypot(dx, dy) || 1;
    nodes.push({ kind: 'bld', pos: [best[0] + (dx / l) * 1.4, best[1] + (dy / l) * 1.4], b: i });
  });

  const crossings = (path: P2[], skipA: number, skipB: number): number => {
    let n = 0;
    for (let k = 0; k < path.length - 1; k++) {
      const a = path[k];
      const b = path[k + 1];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const steps = Math.max(1, Math.floor(L / 3));
      for (let s = 1; s < steps; s++) {
        const p: P2 = [a[0] + ((b[0] - a[0]) * s) / steps, a[1] + ((b[1] - a[1]) * s) / steps];
        for (let g = 0; g < geos.length; g++) {
          if (g === skipA || g === skipB) continue;
          if (geos[g].rings.some((r) => inside(p, r))) {
            n++;
            break;
          }
        }
      }
    }
    return n;
  };

  const route = (ia: number, ib: number): { path: P2[]; cost: number; len: number } => {
    const A = nodes[ia].pos;
    const B = nodes[ib].pos;
    const ra = rot(A, -axis);
    const rb = rot(B, -axis);
    const c1 = rot([rb[0], ra[1]], axis);
    const c2 = rot([ra[0], rb[1]], axis);
    const p1: P2[] = [A, c1, B];
    const p2: P2[] = [A, c2, B];
    const sa = nodes[ia].b;
    const sb = nodes[ib].b;
    const x1 = crossings(p1, sa, sb);
    const x2 = crossings(p2, sa, sb);
    const path = x1 <= x2 ? p1 : p2;
    const len = Math.abs(ra[0] - rb[0]) + Math.abs(ra[1] - rb[1]);
    return { path, cost: len + 45 * Math.min(x1, x2), len };
  };

  const n = nodes.length;
  const inTree = new Array<boolean>(n).fill(false);
  const edges: NetEdge[] = [];
  const parentEdge = new Array<number>(n).fill(-1);
  const order: number[] = [0];
  inTree[0] = true;
  // battery hangs directly off the substation busbar
  {
    const r = route(0, 1);
    edges.push({ from: 0, to: 1, path: r.path, len: r.len });
    parentEdge[1] = 0;
    inTree[1] = true;
    order.push(1);
  }
  const best = new Array<{ cost: number; from: number }>(n).fill({ cost: Infinity, from: -1 });
  const cache = new Map<string, ReturnType<typeof route>>();
  const getRoute = (a: number, b: number) => {
    const k = `${a}-${b}`;
    let r = cache.get(k);
    if (!r) {
      r = route(a, b);
      cache.set(k, r);
    }
    return r;
  };
  const relax = (from: number) => {
    for (let j = 2; j < n; j++) {
      if (inTree[j]) continue;
      const c = getRoute(from, j).cost;
      if (c < best[j].cost) best[j] = { cost: c, from };
    }
  };
  relax(0);
  for (let it = 2; it < n; it++) {
    let j = -1;
    for (let k = 2; k < n; k++) if (!inTree[k] && (j < 0 || best[k].cost < best[j].cost)) j = k;
    const from = best[j].from;
    const r = getRoute(from, j);
    edges.push({ from, to: j, path: r.path, len: r.len });
    parentEdge[j] = edges.length - 1;
    inTree[j] = true;
    order.push(j);
    relax(j);
  }

  // manholes at every junction + every ~55 m along a run
  const manholes: P2[] = nodes.map((nd) => nd.pos);
  for (const e of edges) {
    const k = Math.floor(e.len / 55);
    for (let s = 1; s <= k; s++) {
      let want = (e.len * s) / (k + 1);
      for (let i = 0; i < e.path.length - 1; i++) {
        const a = e.path[i];
        const b = e.path[i + 1];
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (want <= L) {
          manholes.push([a[0] + ((b[0] - a[0]) * want) / L, a[1] + ((b[1] - a[1]) * want) / L]);
          break;
        }
        want -= L;
      }
    }
  }
  return { nodes, edges, parentEdge, order, axis, manholes };
}

/** Power carried by every edge (kW, + = from -> to i.e. away from the substation). */
export function edgeFlows(net: Network, nodeNetKw: Float64Array): Float64Array {
  const acc = Float64Array.from(nodeNetKw);
  const flows = new Float64Array(net.edges.length);
  for (let i = net.order.length - 1; i > 0; i--) {
    const node = net.order[i];
    const e = net.parentEdge[node];
    flows[e] = acc[node];
    acc[net.edges[e].from] += acc[node];
  }
  return flows;
}

/** Point `t` in [0,1) along a polyline. */
export function along(path: P2[], len: number, t: number): P2 {
  let want = t * len;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (want <= L || i === path.length - 2) {
      const u = L > 0 ? Math.min(1, want / L) : 0;
      return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
    }
    want -= L;
  }
  return path[path.length - 1];
}
