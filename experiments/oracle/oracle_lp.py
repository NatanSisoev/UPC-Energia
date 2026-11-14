"""Perfect-foresight upper bound (knows true load & solar) per whole week, via LP (scipy HiGHS).

Score ~ 0.7*dCO2% + 0.3*dCost% -> linear in grid import g_t:
  minimise sum_t g_t * (0.7*100*co2_t/CO2_base + 0.3*100*price_t/COST_base)
  s.t. g_t >= load_t - pv_t + c_t - d_t, g_t >= 0, soc dynamics with eta, |c|,|d| <= 500, 0 <= soc <= 2000.
Run: python -m experiments.oracle.oracle_lp
"""
import numpy as np
from scipy.optimize import linprog

from sim.data import load_campus_hourly, week_blocks
from sim.simulator import ETA, CAPACITY, P_MAX, SOC_INIT, load_agent_class, simulate


def oracle_week(wk):
    n = len(wk)
    load, pv = wk["load_kw"].values, wk["pv_kw"].values
    price, co2 = wk["precio_eur_per_kwh"].values, wk["co2_kg_per_kwh"].values
    net = load - pv
    base = np.clip(net, 0, None)
    co2_b, cost_b = (base * co2).sum(), (base * price).sum()
    w = 0.7 * 100 * co2 / co2_b + 0.3 * 100 * price / cost_b
    # variables: c[0:n], d[n:2n], g[2n:3n]
    cvec = np.concatenate([np.zeros(2 * n), w])
    A_ub = np.zeros((n, 3 * n))
    b_ub = -net
    for t in range(n):                     # net + c - d <= g
        A_ub[t, t], A_ub[t, n + t], A_ub[t, 2 * n + t] = 1, -1, -1
    # soc_t = SOC_INIT + sum_{k<=t}(ETA*c_k - d_k/ETA) in [0, CAP]
    L = np.tril(np.ones((n, n)))
    S = np.hstack([ETA * L, -L / ETA, np.zeros((n, n))])
    A_ub = np.vstack([A_ub, S, -S])
    b_ub = np.concatenate([b_ub, np.full(n, CAPACITY - SOC_INIT), np.full(n, SOC_INIT)])
    bounds = [(0, P_MAX)] * (2 * n) + [(0, None)] * n
    res = linprog(cvec, A_ub=A_ub, b_ub=b_ub, bounds=bounds, method="highs")
    c, d, g = res.x[:n], res.x[n:2 * n], res.x[2 * n:]
    d_co2 = 100 * (co2_b - (g * co2).sum()) / co2_b
    d_cost = 100 * (cost_b - (g * price).sum()) / cost_b
    return 0.7 * d_co2 + 0.3 * d_cost, d_co2, d_cost


if __name__ == "__main__":
    df = load_campus_hourly()
    cls = load_agent_class("agent/agent.py")
    rows = []
    for wk in week_blocks(df):
        o = oracle_week(wk)
        b = simulate(cls(), wk)
        rows.append((o[0], b.score))
        print(f"{wk.index[0].date()}  oracle={o[0]:.2f} (CO2 {o[1]:.2f}%, cost {o[2]:.2f}%)  template={b.score:.2f}")
    r = np.array(rows)
    print(f"MEAN oracle={r[:, 0].mean():.2f}  template={r[:, 1].mean():.2f}  | oracle range {r[:, 0].min():.2f}-{r[:, 0].max():.2f}")
