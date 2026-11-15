"""Planner gap: all-perfect oracle with different horizons / terminal values vs the LP bound, per month."""
import numpy as np

from experiments.hard_diag.common import twin_params, blocks
from experiments.hard.validate import OracleAgent
from sim.simulator import HARD, simulate

params = twin_params()
df, bl = blocks()
rows = {}
for mo, d in bl.items():
    r = []
    for h in (24, 48, 96):
        r.append(simulate(OracleAgent({**params, "horizon": h}, d, True, True), d, spec=HARD).score)
    rows[mo] = r
    print(mo, " ".join(f"h{h}={x:5.2f}" for h, x in zip((24, 48, 96), r)), flush=True)
print("mean", np.round(np.mean(list(rows.values()), axis=0), 2))
