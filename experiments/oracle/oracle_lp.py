"""Perfect-foresight upper bound (knows the true load & solar of every hour) via LP (scipy HiGHS).

Score = 0.7*dCO2% + 0.3*dCost% is linear in the grid import g_t:
  minimise sum_t g_t * (0.7*100*co2_t/CO2_base + 0.3*100*price_t/COST_base)
  s.t. g_t >= load_t - pv_t + c_t - d_t, g_t >= 0, soc dynamics with eta, 0 <= c,d <= 500, 0 <= soc <= 2000.

`oracle_run(df)` treats df as ONE simulation (SOC starts at 50 % and is carried across the month jumps, exactly
like the official environment). No causal agent can beat it on that data.

Run: python -m experiments.oracle.oracle_lp [agent path]     -> oracle vs agent, whole train set and per week
"""
import sys

import numpy as np
from scipy.optimize import linprog
from scipy.sparse import diags, eye, hstack, vstack

from sim.data import load_campus_hourly, week_blocks
from sim.simulator import ETA, HARD, STANDARD, load_agent_class, simulate


def oracle_run(df, spec=STANDARD):
    """Returns (score, dCO2 %, dCost %) of the best possible schedule for the whole dataframe."""
    CAPACITY, P_MAX, SOC_INIT = spec.capacity, spec.power, spec.soc_init
    n = len(df)
    load, pv = df["load_kw"].values, df["pv_kw"].values
    price, co2 = df["precio_eur_per_kwh"].values, df["co2_kg_per_kwh"].values
    net = load - pv
    base = np.clip(net, 0, None)
    co2_b, cost_b = (base * co2).sum(), (base * price).sum()
    w = 0.7 * co2 / co2_b + 0.3 * price / cost_b
    w = w / w.mean()                                   # O(1) costs: keeps HiGHS' tolerances meaningful
    # variables: c (n), d (n), g (n), s (n)
    I = eye(n, format="csr")
    Z = I * 0.0
    D = I - diags([np.ones(n - 1)], [-1], format="csr")                 # s_t - s_{t-1}
    A_eq = hstack([-ETA * I, I / ETA, Z, D], format="csr")              # s_t - s_{t-1} = eta c_t - d_t / eta
    b_eq = np.zeros(n)
    b_eq[0] = SOC_INIT
    A_ub = hstack([I, -I, -I, Z], format="csr")                         # net + c - d <= g
    bounds = [(0, P_MAX)] * (2 * n) + [(0, None)] * n + [(0, CAPACITY)] * n
    res = linprog(np.concatenate([np.zeros(2 * n), w, np.zeros(n)]), A_ub=A_ub, b_ub=-net, A_eq=A_eq, b_eq=b_eq,
                  bounds=bounds, method="highs")
    assert res.status == 0, res.message
    g = res.x[2 * n:3 * n]
    d_co2 = 100 * (co2_b - (g * co2).sum()) / co2_b
    d_cost = 100 * (cost_b - (g * price).sum()) / cost_b
    return 0.7 * d_co2 + 0.3 * d_cost, d_co2, d_cost


oracle_week = oracle_run                               # backwards-compatible name (a week is just a short run)


if __name__ == "__main__":
    hard = "--hard" in sys.argv
    spec = HARD if hard else STANDARD
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    agent_path = args[0] if args else ("agent_hard/agent.py" if hard else "agent/agent.py")
    df = load_campus_hourly(hard=hard)
    cls = load_agent_class(agent_path)
    o, a = oracle_run(df, spec), simulate(cls(), df, spec=spec)
    print(f"WHOLE TRAIN SET ({len(df)} h, one run): oracle={o[0]:.3f} (CO2 {o[1]:.2f}%, cost {o[2]:.2f}%)  "
          f"agent={a.score:.3f} (CO2 {a.d_co2_pct:.2f}%, cost {a.d_cost_pct:.2f}%)  -> {100 * a.score / o[0]:.2f} % "
          f"of the bound, violations={a.violations}")
    rows = []
    for wk in week_blocks(df):
        o, a = oracle_run(wk, spec), simulate(cls(), wk, spec=spec)
        rows.append((o[0], a.score, a.violations))
        print(f"{wk.index[0].date()}  oracle={o[0]:6.2f}  agent={a.score:6.2f}  ({100 * a.score / o[0]:5.1f} %)")
    r = np.array(rows)
    print(f"WEEKLY MEAN oracle={r[:, 0].mean():.3f}  agent={r[:, 1].mean():.3f}  "
          f"({100 * r[:, 1].mean() / r[:, 0].mean():.2f} %)  violations={int(r[:, 2].sum())}")
