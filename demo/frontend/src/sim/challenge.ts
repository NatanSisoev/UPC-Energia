/**
 * Challenge-exact battery physics, scoring and agents (pure TypeScript, no imports).
 *
 * This file is a line-by-line port of
 *   - sim/simulator.py      (physics, clamp/violations, metric, score)
 *   - agent/agent.py        (exact 24 h MPC: dynamic programme on the marginal value of stored energy)
 *   - experiments/baseline/template_agent.py (the organisers' template heuristic)
 * so that the demo tells exactly the same story as the leaderboard model.
 * `scripts/validate.mts` re-runs it on the real weeks and diffs it against the Python results
 * stored in public/data/replay.json (they agree to ~1e-9).
 *
 * Units (identical to the challenge): kW, kWh, EUR/kWh, kg CO2/kWh, 1 h steps.
 * Sign: setpoint > 0 charges the battery, < 0 discharges it.
 */

// ---------------------------------------------------------------- spec ---

export interface BatterySpec {
  capacityKwh: number;
  powerKw: number;
  /** one-way efficiency = sqrt(round-trip) */
  eta: number;
}

/** Official battery_spec.json: 2,000 kWh, +-500 kW, 90 % round trip, SOC0 = 50 %. */
export const CHALLENGE_SPEC: BatterySpec = { capacityKwh: 2000, powerKw: 500, eta: Math.sqrt(0.9) };
export const SOC_INIT_FRACTION = 0.5;
/** Score weights and per-infraction penalty (percent units), from sim/simulator.py. */
export const W_CO2 = 0.7;
export const W_COST = 0.3;
export const VIOLATION_PENALTY = 0.2;
/** Export is worth nothing and has no CO2 credit (official environment.py export_price = 0). */
export const EXPORT_PRICE = 0;
const TOL = 1e-3;
const EPS = 1e-4;

export type AgentKind = 'mpc' | 'template' | 'none';

export interface WeekInput {
  /** naive local wall time "YYYY-MM-DDTHH:MM" of hour 0 */
  start: string;
  /** optional per-row naive local time (epoch-ms); needed when the week has data gaps */
  ms?: ArrayLike<number>;
  load: ArrayLike<number>;
  pv: ArrayLike<number>;
  price: ArrayLike<number>;
  co2: ArrayLike<number>;
}

// -------------------------------------------------------------- helpers ---

function startMs(start: string): number {
  const m = /^(\d+)-(\d+)-(\d+)T(\d+):(\d+)/.exec(start)!;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
}

/** Safety clamp of agent/agent.py::_clamp: guarantees 0 infractions. */
export function clampSetpoint(sp: number, socKwh: number, spec: BatterySpec): number {
  if (!Number.isFinite(sp)) sp = 0;
  const maxCharge = Math.max(0, Math.min(spec.powerKw, Math.max(0, spec.capacityKwh - socKwh) / spec.eta - EPS));
  const maxDischarge = Math.max(0, Math.min(spec.powerKw, Math.max(0, socKwh) * spec.eta - EPS));
  return Math.max(-maxDischarge, Math.min(maxCharge, sp));
}

/** Why the agent chose what it chose (for the on-screen narrator). */
export interface Reason {
  action: 'charge' | 'discharge' | 'hold';
  /** rank of the current hour's blended grid "dirtiness" inside the known 24 h window: 0 = best hour, 1 = worst */
  rank: number;
  /** current hour vs 24 h window mean, relative: -0.3 = 30 % better than average */
  priceVsMean: number;
  co2VsMean: number;
  /** was the export guard (don't discharge above campus demand) limiting the discharge? */
  guard: boolean;
}

interface Obs {
  hourIndex: number;
  month: number; // 0..11
  hour: number;
  socKwh: number;
  priceNow: number;
  co2Now: number;
  prices: Float64Array; // starts at the CURRENT hour, truncated at the end of the data
  co2s: Float64Array;
  lastLoad: number;
  lastPv: number;
}

// ------------------------------------------------------------ MPC agent ---

const CO2_RATE = [93.56, 54.34, 71.65, 65.98, 74.95, 89.2, 130.55, 93.42, 95.56, 126.17, 94.96, 114.56];
const COST_RATE = [162.86, 127.67, 156.79, 121.46, 123.8, 161.47, 230.73, 155.91, 157.77, 169.0, 148.64, 167.68];
const HOURS_PER_MONTH = 168;
const ALPHA_CO2 = 0.7;
const BETA_COST = 0.3;
const NET_MARGIN_KW = 50;

/** Optional strategy knobs for what-if studies. Defaults reproduce agent/agent.py exactly. */
export interface MpcOptions {
  /** weight of CO2 vs cost inside the optimiser (challenge score is 0.7/0.3) */
  alphaCo2?: number;
  betaCost?: number;
  /** look-ahead hours of price/CO2 the agent may use (the challenge provides 24) */
  horizon?: number;
}

export class MpcAgent {
  private readonly grid: Float64Array;
  private readonly step: number;
  private errNow = 0;
  private errNext = 0;
  private lastHead: [number, number] | null = null;
  private prev: [number, number, number] | null = null;
  private seen = new Array<number>(12).fill(0);
  private co2Obs = new Array<number>(12).fill(0);
  private costObs = new Array<number>(12).fill(0);
  lastReason: Reason = { action: 'hold', rank: 0.5, priceVsMean: 0, co2VsMean: 0, guard: false };

  private readonly spec: BatterySpec;
  private readonly alpha: number;
  private readonly beta: number;

  constructor(spec: BatterySpec, opts: MpcOptions = {}) {
    this.alpha = opts.alphaCo2 ?? ALPHA_CO2;
    this.beta = opts.betaCost ?? BETA_COST;
    this.spec = spec;
    // Python uses a 1 kWh grid for 2,000 kWh; keep ~2,000 nodes for any other size.
    this.step = Math.max(spec.capacityKwh / 2000, 0.05);
    const n = Math.round(spec.capacityKwh / this.step) + 1;
    this.grid = new Float64Array(n);
    for (let i = 0; i < n; i++) this.grid[i] = i * this.step;
  }

  act(obs: Obs): number {
    const soc = Math.min(Math.max(obs.socKwh, 0), this.spec.capacityKwh);
    let sp = 0;
    try {
      sp = this.decide(obs, soc);
    } catch {
      sp = 0;
    }
    return clampSetpoint(sp, obs.socKwh, this.spec);
  }

  private decide(obs: Obs, soc: number): number {
    let prices = obs.prices;
    let co2s = obs.co2s;
    const n0 = Math.min(prices.length, co2s.length);
    prices = prices.subarray(0, n0);
    co2s = co2s.subarray(0, n0);

    if (!this.listsStartNow(prices, co2s, obs.priceNow, obs.co2Now) || n0 === 0) {
      const p2 = new Float64Array(n0 + 1);
      const c2 = new Float64Array(n0 + 1);
      p2[0] = obs.priceNow;
      c2[0] = obs.co2Now;
      p2.set(prices, 1);
      c2.set(co2s, 1);
      prices = p2;
      co2s = c2;
    }
    const netLast = this.learn(obs);
    const [kCo2, kCost] = this.weights();
    const n = prices.length;
    const w = new Float64Array(n);
    let mean = 0;
    for (let i = 0; i < n; i++) {
      w[i] = kCo2 * co2s[i] + kCost * prices[i];
      mean += Math.abs(w[i]);
    }
    mean = Math.max(mean / n, 1e-300);
    for (let i = 0; i < n; i++) w[i] = Math.max(w[i] / mean, 1e-9);

    const disCap = Math.min(Math.max(netLast - NET_MARGIN_KW, 0), this.spec.powerKw);
    const sp = this.plan(w, soc, disCap);

    // narrator data
    let better = 0;
    let mp = 0;
    let mc = 0;
    for (let i = 0; i < n; i++) {
      if (w[i] < w[0]) better++;
      mp += prices[i];
      mc += co2s[i];
    }
    mp /= n;
    mc /= n;
    this.lastReason = {
      action: sp > 1 ? 'charge' : sp < -1 ? 'discharge' : 'hold',
      rank: n > 1 ? better / (n - 1) : 0.5,
      priceVsMean: mp > 0 ? prices[0] / mp - 1 : 0,
      co2VsMean: mc > 0 ? co2s[0] / mc - 1 : 0,
      guard: sp < -1 && disCap < this.spec.powerKw - 1e-9 && -sp >= disCap - 1,
    };
    return sp;
  }

  private listsStartNow(prices: Float64Array, co2s: Float64Array, priceNow: number, co2Now: number): boolean {
    const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-9);
    if (prices.length) this.errNow += Math.max(rel(prices[0], priceNow), rel(co2s[0], co2Now));
    if (this.lastHead) this.errNext += Math.max(rel(this.lastHead[0], priceNow), rel(this.lastHead[1], co2Now));
    this.lastHead = prices.length ? [prices[0], co2s[0]] : null;
    return this.errNow <= this.errNext + 1e-3;
  }

  private learn(obs: Obs): number {
    const netLast = obs.lastLoad - obs.lastPv;
    if (this.prev) {
      const [m, pPrev, cPrev] = this.prev;
      const base = Math.max(netLast, 0);
      this.seen[m] += 1;
      this.co2Obs[m] += base * cPrev;
      this.costObs[m] += base * pPrev;
    }
    this.prev = [obs.month, obs.priceNow, obs.co2Now];
    return netLast;
  }

  private weights(): [number, number] {
    let co2Base = 0;
    let costBase = 0;
    for (let m = 0; m < 12; m++) {
      const left = Math.max(HOURS_PER_MONTH - this.seen[m], 0);
      co2Base += this.co2Obs[m] + left * CO2_RATE[m];
      costBase += this.costObs[m] + left * COST_RATE[m];
    }
    return [this.alpha / Math.max(co2Base, 1e-9), this.beta / Math.max(costBase, 1e-9)];
  }

  /** np.interp on the uniform SOC grid with explicit out-of-range values. */
  private interp(q: Float64Array, x: number, left: number, right: number): number {
    const g = this.grid;
    const last = g.length - 1;
    if (x < g[0]) return left;
    if (x > g[last]) return right;
    const f = (x - g[0]) / this.step;
    const i = Math.min(Math.floor(f), last - 1);
    if (i >= last) return q[last];
    const t = x - g[i];
    return q[i] + ((q[i + 1] - q[i]) * t) / this.step;
  }

  /** Optimal first setpoint of the 24 h LP, by DP on the marginal value of stored energy (see agent/agent.py). */
  private plan(w: Float64Array, soc: number, disCap: number): number {
    const { eta, powerKw } = this.spec;
    const g = this.grid;
    const N = g.length;
    const up = powerKw * eta;
    const down = powerKw / eta;
    let q = new Float64Array(N);
    let nq = new Float64Array(N);
    for (let t = w.length - 1; t > 0; t--) {
      const lo = w[t] * eta;
      const hi = w[t] / eta;
      for (let i = 0; i < N; i++) {
        const qUp = this.interp(q, g[i] + up, q[0], -Infinity);
        const qDown = this.interp(q, g[i] - down, Infinity, q[N - 1]);
        const clipped = Math.min(Math.max(q[i], lo), hi);
        nq[i] = Math.min(qDown, Math.max(qUp, clipped));
      }
      const tmp = q;
      q = nq;
      nq = tmp;
    }
    const buyUntil = crossing(g, q, w[0] / eta);
    const sellUntil = crossing(g, q, w[0] * eta);
    if (buyUntil > soc) return (Math.min(buyUntil, soc + up) - soc) / eta;
    if (sellUntil < soc) return (Math.max(sellUntil, soc - Math.min(disCap, powerKw) / eta) - soc) * eta;
    return 0;
  }
}

function crossing(g: Float64Array, q: Float64Array, level: number): number {
  let k = 0;
  for (let i = 0; i < q.length; i++) if (q[i] > level) k++; // q is non-increasing; count like np.count_nonzero
  if (k === 0) return g[0];
  if (k === q.length) return g[g.length - 1];
  return g[k - 1] + ((g[k] - g[k - 1]) * (q[k - 1] - level)) / (q[k - 1] - q[k]);
}

// ------------------------------------------------------ template agent ---

function templateAct(obs: Obs, spec: BatterySpec): [number, Reason] {
  const soc = obs.socKwh / spec.capacityKwh;
  const h = obs.hour;
  const p = obs.priceNow;
  let sp = 0;
  if (h >= 1 && h <= 6 && p < 0.08 && soc < 0.85) sp = 350;
  else if (h >= 11 && h <= 15 && p < 0.1 && soc < 0.95) sp = 250;
  else if (h >= 18 && h <= 22 && (p > 0.16 || obs.co2Now > 0.1) && soc > 0.15) sp = -450;
  const reason: Reason = {
    action: sp > 0 ? 'charge' : sp < 0 ? 'discharge' : 'hold',
    rank: 0.5,
    priceVsMean: 0,
    co2VsMean: 0,
    guard: false,
  };
  return [clampSetpoint(sp, obs.socKwh, spec), reason];
}

// -------------------------------------------------------------- sim ---

export interface Metrics {
  score: number;
  dCo2Pct: number;
  dCostPct: number;
  violations: number;
  co2Base: number;
  co2Agent: number;
  costBase: number;
  costAgent: number;
}

export interface SimResult {
  n: number;
  /** battery setpoint per hour, kW (+ charge) */
  sp: Float64Array;
  /** SOC at the start / end of each hour, kWh */
  socStart: Float64Array;
  socEnd: Float64Array;
  /** campus grid exchange with the battery / without it, kW (+ import, - export) */
  grid: Float64Array;
  baseGrid: Float64Array;
  /** prefix sums (length n+1) of agent / no-battery cost [EUR] and CO2 [kg] */
  cumCost: Float64Array;
  cumBaseCost: Float64Array;
  cumCo2: Float64Array;
  cumBaseCo2: Float64Array;
  reasons: Reason[];
  metrics: Metrics;
}

/** Re-implementation of sim.simulator.simulate() for one whole-week block. */
export function simulateWeek(week: WeekInput, spec: BatterySpec, kind: AgentKind, opts: MpcOptions = {}): SimResult {
  const n = week.load.length;
  const t0 = startMs(week.start);
  const price = Float64Array.from(week.price as ArrayLike<number>);
  const co2 = Float64Array.from(week.co2 as ArrayLike<number>);
  const mpc = kind === 'mpc' ? new MpcAgent(spec, opts) : null;
  const look = opts.horizon ?? 24;

  const sp = new Float64Array(n);
  const socStart = new Float64Array(n);
  const socEnd = new Float64Array(n);
  const reasons: Reason[] = [];
  let soc = SOC_INIT_FRACTION * spec.capacityKwh;
  let viol = 0;

  for (let i = 0; i < n; i++) {
    const d = new Date(week.ms ? week.ms[i] : t0 + i * 3_600_000);
    const prevI = i > 0 ? i - 1 : i;
    const obs: Obs = {
      hourIndex: i,
      month: d.getUTCMonth(),
      hour: d.getUTCHours(),
      socKwh: soc,
      priceNow: price[i],
      co2Now: co2[i],
      prices: price.subarray(i, i + look),
      co2s: co2.subarray(i, i + look),
      lastLoad: week.load[prevI],
      lastPv: week.pv[prevI],
    };
    let req = 0;
    let reason: Reason = { action: 'hold', rank: 0.5, priceVsMean: 0, co2VsMean: 0, guard: false };
    if (mpc) {
      req = mpc.act(obs);
      reason = mpc.lastReason;
    } else if (kind === 'template') {
      [req, reason] = templateAct(obs, spec);
    }
    const maxC = Math.min(spec.powerKw, (spec.capacityKwh - soc) / spec.eta);
    const maxD = Math.min(spec.powerKw, soc * spec.eta);
    if (!Number.isFinite(req)) {
      viol++;
      req = 0;
    } else if (req > maxC + TOL || req < -maxD - TOL) {
      viol++;
      req = Math.min(Math.max(req, -maxD), maxC);
    }
    sp[i] = req;
    socStart[i] = soc;
    soc += req >= 0 ? req * spec.eta : req / spec.eta;
    soc = Math.min(Math.max(soc, 0), spec.capacityKwh);
    socEnd[i] = soc;
    reasons.push(reason);
  }

  const grid = new Float64Array(n);
  const baseGrid = new Float64Array(n);
  const cumCost = new Float64Array(n + 1);
  const cumBaseCost = new Float64Array(n + 1);
  const cumCo2 = new Float64Array(n + 1);
  const cumBaseCo2 = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    const net = week.load[i] - week.pv[i];
    baseGrid[i] = net;
    grid[i] = net + sp[i];
    cumBaseCo2[i + 1] = cumBaseCo2[i] + Math.max(net, 0) * co2[i];
    cumBaseCost[i + 1] = cumBaseCost[i] + Math.max(net, 0) * price[i] - Math.max(-net, 0) * EXPORT_PRICE;
    cumCo2[i + 1] = cumCo2[i] + Math.max(grid[i], 0) * co2[i];
    cumCost[i + 1] = cumCost[i] + Math.max(grid[i], 0) * price[i] - Math.max(-grid[i], 0) * EXPORT_PRICE;
  }
  const co2Base = cumBaseCo2[n];
  const co2Agent = cumCo2[n];
  const costBase = cumBaseCost[n];
  const costAgent = cumCost[n];
  const dCo2Pct = co2Base ? (100 * (co2Base - co2Agent)) / co2Base : 0;
  const dCostPct = costBase ? (100 * (costBase - costAgent)) / costBase : 0;
  const score = Math.max(0, W_CO2 * dCo2Pct + W_COST * dCostPct - VIOLATION_PENALTY * viol);
  return {
    n,
    sp,
    socStart,
    socEnd,
    grid,
    baseGrid,
    cumCost,
    cumBaseCost,
    cumCo2,
    cumBaseCo2,
    reasons,
    metrics: { score, dCo2Pct, dCostPct, violations: viol, co2Base, co2Agent, costBase, costAgent },
  };
}
