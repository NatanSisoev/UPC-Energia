"""Per-month ladder on the hold-out: twin, perfect market, perfect load+solar, all perfect, LP bound."""
import pickle
import sys
import time

import numpy as np

import agent_hard.agent as ah
from experiments.hard_diag.common import twin_params, blocks, Rec
from experiments.hard.validate import OracleAgent
from experiments.oracle.oracle_lp import oracle_run
from sim.simulator import HARD, simulate

if __name__ == "__main__":
    params = twin_params()
    df, bl = blocks()
    rows, traces = {}, {}
    for mo, d in bl.items():
        t0 = time.time()
        r = {}
        a = Rec(params)
        res = simulate(a, d, spec=HARD)
        traces[mo] = (res.trace, a.rec)
        r["twin"] = res
        r["mkt"] = simulate(OracleAgent(params, d, True, False), d, spec=HARD)
        r["net"] = simulate(OracleAgent(params, d, False, True), d, spec=HARD)
        r["all"] = simulate(OracleAgent(params, d, True, True), d, spec=HARD)
        b = oracle_run(d, HARD)
        rows[mo] = (r, b)
        co2b, costb = r["twin"].co2_base, r["twin"].cost_base
        f = lambda k: f"{r[k].score:5.2f} {r[k].co2_base - r[k].co2_agent:7.0f}kg {r[k].cost_base - r[k].cost_agent:6.0f}E"
        print(mo, "twin", f("twin"), "| mkt", f("mkt"), "| net", f("net"), "| all", f("all"),
              f"| LP {b[0]:5.2f} {co2b * b[1] / 100:7.0f}kg {costb * b[2] / 100:6.0f}E  [{time.time() - t0:.0f}s]", flush=True)
    out = {mo: ({k: (v.score, v.co2_base - v.co2_agent, v.cost_base - v.cost_agent, v.co2_base, v.cost_base)
                 for k, v in r.items()}, b) for mo, (r, b) in rows.items()}
    pickle.dump((out, traces), open("experiments/hard_diag/ladder.pkl", "wb"))
    tot = lambda k: np.mean([out[m][0][k][0] for m in out])
    print("mean per-month", {k: round(tot(k), 2) for k in ("twin", "mkt", "net", "all")}, "LP", round(np.mean([out[m][1][0] for m in out]), 2))
