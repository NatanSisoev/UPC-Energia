/**
 * Hourly power through every cable segment over the shown week (measured before "now", forecast after).
 * Each building's net draw (its share of the campus demand minus its own roof solar) and the battery setpoint
 * are pushed through the cable tree (scene/network.ts edgeFlows), hour by hour. Cached per derived/config.
 */
import { derived, useSim } from '../store/useSim';
import { edgeFlows } from '../scene/network';
import { buildingSolarKw, DEFAULT_TILT, PV_ASBUILT_KWP } from '../sim/engine';

let cache: { key: unknown; flows: Float64Array[]; solarOut: Float64Array } = { key: null, flows: [], solarOut: new Float64Array(0) };

/** flows[h][edge] in kW (+ towards the buildings, − back towards the substation) */
export function weekCableFlows(): Float64Array[] {
  const d = derived.current;
  const s = useSim.getState();
  const net = s.network;
  if (!d || !net || !s.campus) return [];
  const key = d; // a new derived object is built on every week / config / forecast / fault change
  if (cache.key === key) return cache.flows;
  const props = s.campus.features.map((f) => f.properties);
  const n = d.week.load.length;
  const out: Float64Array[] = [];
  const solarOut = new Float64Array(n);
  const nn = new Float64Array(net.nodes.length);
  for (let h = 0; h < n; h++) {
    const yieldKw = d.week.pv[h] / PV_ASBUILT_KWP;
    nn.fill(0);
    net.nodes.forEach((nd, i) => {
      if (nd.kind === 'bld') {
        const p = props[nd.b];
        const cfg = s.solar[p.osmId] ?? { on: false, fraction: 0, tilt: DEFAULT_TILT };
        const pv = s.faults.roofs.includes(p.osmId) ? 0 : buildingSolarKw(p, cfg, s.panelModel, yieldKw);
        nn[i] = d.shares[nd.b * 168 + h] * d.week.load[h] - pv;
        if (nn[i] < 0) solarOut[h] -= nn[i];
      } else if (nd.kind === 'batt') nn[i] = d.chosen.sp[h];
    });
    out.push(edgeFlows(net, nn));
  }
  cache = { key, flows: out, solarOut };
  return out;
}

/**
 * Where the power in cable i comes from at hour h (kW per source, summing to |flow|). The cable network is shared,
 * so a feeder carries the network's mix of that hour: grid import, battery discharge and the rooftop solar that
 * other buildings push back into the network. The battery's own cable: charging = solar surplus first, then grid;
 * discharging = all battery.
 */
export function cableMixAt(i: number, h: number): { grid: number; battery: number; solar: number; load: number } {
  const flows = weekCableFlows();
  const d = derived.current;
  const s = useSim.getState();
  const e = s.network?.edges[i];
  const f = flows[h]?.[i] ?? 0;
  const a = Math.abs(f);
  if (!d || !e || a < 1e-6) return { grid: 0, battery: 0, solar: 0, load: a };
  const solar = cache.solarOut[h] ?? 0;
  const sp = d.chosen.sp[h];
  if (s.network!.nodes[e.to].kind === 'batt') {
    if (f < 0) return { grid: 0, battery: a, solar: 0, load: a };
    const sol = Math.min(a, solar);
    return { grid: a - sol, battery: 0, solar: sol, load: a };
  }
  const grid = Math.max(0, d.chosen.grid[h]);
  const batt = sp < 0 ? -sp : 0;
  const t = grid + batt + solar;
  if (t < 1e-9) return { grid: a, battery: 0, solar: 0, load: a };
  return { grid: (a * grid) / t, battery: (a * batt) / t, solar: (a * solar) / t, load: a };
}

/** one cable's hourly series */
export function cableSeries(i: number): Float64Array {
  const f = weekCableFlows();
  return Float64Array.from(f, (row) => row[i] ?? 0);
}
