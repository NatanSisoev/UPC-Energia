"""Glued 11-block run (SOC carried, like the hidden test): per-month contribution (global weights) of twin / perfect market /
perfect load+solar / all perfect / LP. Contribution = 100 * sum_t w_t (g0 - g) over the month's hours, w from the whole run."""
import numpy as np
import pandas as pd

import agent_hard.agent as ah
from experiments.hard_diag.common import twin_params, blocks
from experiments.hard_diag.dec3 import lp_setpoint
from experiments.hard.validate import OracleAgent
from sim.simulator import HARD, simulate

params = twin_params()
df, bl = blocks()
data = pd.concat(list(bl.values()))
net = (data["load_kw"] - data["pv_kw"]).values
base = np.clip(net, 0, None)
co2, price = data["co2_kg_per_kwh"].values, data["precio_eur_per_kwh"].values
w = 0.7 * co2 / (base * co2).sum() + 0.3 * price / (base * price).sum()
mon = np.array([f"{t.year}-{t.month:02d}" for t in data.index])
runs = {}
for k, mk in (("twin", lambda: ah.BatteryAgent(model=params)), ("mkt", lambda: OracleAgent(params, data, True, False)),
              ("net", lambda: OracleAgent(params, data, False, True)), ("all", lambda: OracleAgent(params, data, True, True))):
    r = simulate(mk(), data, spec=HARD)
    runs[k] = r.trace["setpoint_kw"].values
    print(k, "total score", round(r.score, 3), flush=True)
runs["LP"] = lp_setpoint(data)
rows = {}
for k, sp in runs.items():
    g = np.clip(net + sp, 0, None)
    rows[k] = pd.Series(100 * w * (base - g)).groupby(mon).sum()
t = pd.DataFrame(rows)
t.loc["TOTAL"] = t.sum()
t["twin/LP %"] = 100 * t["twin"] / t["LP"]
print(t.round(2).to_string())

# raw CO2 (kg) and cost (EUR) avoided per month in the glued run
for name, v in (("CO2 avoided kg", co2), ("cost avoided EUR", price)):
    rows = {}
    for k, sp in runs.items():
        g = np.clip(net + sp, 0, None)
        rows[k] = pd.Series((base - g) * v).groupby(mon).sum()
    t2 = pd.DataFrame(rows)
    t2["twin/LP %"] = 100 * t2["twin"] / t2["LP"]
    print("\n" + name)
    print(t2.round(1).to_string())
