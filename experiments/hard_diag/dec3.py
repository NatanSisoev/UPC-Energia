"""Where the points go: per-day CO2 avoided twin vs LP, wasted energy, grid charging at bad prices. Args: month."""
import pickle
import sys

import numpy as np
import pandas as pd
from scipy.optimize import linprog
from scipy.sparse import diags, eye, hstack

from experiments.hard_diag.common import blocks
from sim.simulator import ETA, HARD

pd.set_option("display.width", 250)
pd.set_option("display.max_columns", 50)
out, traces = pickle.load(open("experiments/hard_diag/ladder.pkl", "rb"))
df, bl = blocks()


def lp_setpoint(d, spec=HARD):
    n = len(d)
    load, pv = d["load_kw"].values, d["pv_kw"].values
    price, co2 = d["precio_eur_per_kwh"].values, d["co2_kg_per_kwh"].values
    net = load - pv
    base = np.clip(net, 0, None)
    w = 0.7 * co2 / (base * co2).sum() + 0.3 * price / (base * price).sum()
    w = w / w.mean()
    I = eye(n, format="csr")
    Z = I * 0.0
    D = I - diags([np.ones(n - 1)], [-1], format="csr")
    A_eq = hstack([-ETA * I, I / ETA, Z, D], format="csr")
    b_eq = np.zeros(n)
    b_eq[0] = spec.soc_init
    A_ub = hstack([I, -I, -I, Z], format="csr")
    bounds = [(0, spec.power)] * (2 * n) + [(0, None)] * n + [(0, spec.capacity)] * n
    res = linprog(np.concatenate([np.zeros(2 * n), w, np.zeros(n)]), A_ub=A_ub, b_ub=-net, A_eq=A_eq, b_eq=b_eq, bounds=bounds, method="highs")
    return res.x[:n] - res.x[n:2 * n]


def analyse(mo):
    d = bl[mo]
    tr, rec = traces[mo]
    sp = tr["setpoint_kw"].values
    lp = lp_setpoint(d)
    load, pv = d["load_kw"].values, d["pv_kw"].values
    price, co2 = d["precio_eur_per_kwh"].values, d["co2_kg_per_kwh"].values
    net = load - pv
    base = np.clip(net, 0, None)
    co2_b, cost_b = (base * co2).sum(), (base * price).sum()
    w = 0.7 * co2 / co2_b + 0.3 * price / cost_b          # score weight per imported kWh (fractions of 1)
    w_rel = w / w.mean()

    def grid(s):
        return np.clip(net + s, 0, None)

    g_t, g_l, g_0 = grid(sp), grid(lp), base
    pts = lambda g: 100 * (w * (g_0 - g)).sum()           # score points (0.7*dCO2% + 0.3*dCost%) = 100 * sum w*saved
    print(f"\n===== {mo}  twin {pts(g_t):.2f}  LP {pts(g_l):.2f}  (gap {pts(g_l) - pts(g_t):.2f} pts)")
    rows = []
    for day in sorted(set(d.index.date)):
        idx = np.array([k for k, t in enumerate(d.index) if t.date() == day])
        rows.append({"day": day, "co2_mean": co2[idx].mean(), "price_mean": price[idx].mean(),
                     "twin_pts": 100 * (w[idx] * (g_0[idx] - g_t[idx])).sum(), "LP_pts": 100 * (w[idx] * (g_0[idx] - g_l[idx])).sum(),
                     "twin_chg_kWh": sp[idx][sp[idx] > 0].sum(), "twin_dis_kWh": -sp[idx][sp[idx] < 0].sum(),
                     "LP_chg_kWh": lp[idx][lp[idx] > 0].sum(), "LP_dis_kWh": -lp[idx][lp[idx] < 0].sum()})
    print(pd.DataFrame(rows).set_index("day").round(2))
    # wasted: discharge beyond the real net load (exported, worth 0)
    waste = np.clip(-(net + sp), 0, None)                   # kW exported
    dis = np.clip(-sp, 0, None)
    print(f"exported energy: {waste.sum():.0f} kWh in {int((waste > 1).sum())} h  (twin discharge {dis.sum():.0f} kWh; LP exports {np.clip(-(net + lp), 0, None).sum():.0f})")
    # charging while net load positive: energy charged from the grid in hours where w_rel < 1 (below-mean weight) is normal;
    # list expensive ones: charged at w_rel above the median of the discharge hours
    chg = np.clip(sp, 0, None)
    charged_from_grid = np.minimum(chg, np.clip(net + chg, 0, None))
    w_dis = (w_rel * dis).sum() / max(dis.sum(), 1e-9)
    w_chg = (w_rel * chg).sum() / max(chg.sum(), 1e-9)
    print(f"weighted mean w_rel of charge hours {w_chg:.2f} / discharge hours {w_dis:.2f} (twin);  LP: "
          f"{(w_rel * np.clip(lp, 0, None)).sum() / max(np.clip(lp, 0, None).sum(), 1e-9):.2f} / {(w_rel * np.clip(-lp, 0, None)).sum() / max(np.clip(-lp, 0, None).sum(), 1e-9):.2f}")
    # hours where twin and LP differ most (points)
    hp = 100 * w * ((g_0 - g_t) - (g_0 - g_l))
    order = np.argsort(hp)[:10]
    print("10 worst hours vs LP (pts lost): time, w_rel, co2, price, net, twin sp, LP sp, soc_twin")
    for k in sorted(order):
        print(f"  {d.index[k]}  loss {hp[k]:.3f}  w_rel {w_rel[k]:.2f} co2 {co2[k]:.3f} p {price[k]:.3f} net {net[k]:.0f}  twin {sp[k]:7.0f}  LP {lp[k]:7.0f}  soc {tr['soc_kwh'].values[k]:.0f}")
    # loss by hour-of-day: sum
    # check: points lost in hours twin discharges and LP charges etc.
    both = {"twin dis & LP not": (sp < -1) & (lp > -1), "twin chg & LP not": (sp > 1) & (lp < 1), "twin idle & LP dis": (abs(sp) < 1) & (lp < -1), "twin idle & LP chg": (abs(sp) < 1) & (lp > 1)}
    for k, m in both.items():
        print(f"  {k}: {m.sum()} h, net pts {hp[m].sum():.2f}")
    return d, sp, lp


if __name__ == "__main__":
    for mo in sys.argv[1:] or ["2025-12"]:
        analyse(mo)
