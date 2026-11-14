"""Hold-out effect of the "trust recent data" probes (r01..r06, s01) on the _base_v2 agent.

Twin of H10: experiments/hard/model_holdout_lgb_cal.json (fitted without the last 7 train days of each month) with the
keys "wmult" / "wmult_pow" deleted in memory (H10 does not use them). Local baseline = co2_mult 1.0 (the leaderboard
probes use 1.8). Sequential runs over the 1,848 hold-out hours.

Run: PYTHONPATH=. .venv/Scripts/python experiments/hard/probe_holdout_v2.py [--only r01,s01] [--equiv]
  --equiv  checks that _base_v2 (no new knobs) and _base_h10_knobs give identical setpoints.
"""
import argparse
import importlib.util
import json
import time
from pathlib import Path

import numpy as np

from experiments.mpc.validate import monthly_blocks
from sim.data import load_campus_hourly
from sim.simulator import HARD, simulate

HERE = Path(__file__).parent
ROOT = HERE.parents[1]


def load_agent(path):
    spec = importlib.util.spec_from_file_location("agent_" + path.parent.name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


V2 = load_agent(ROOT / "submissions/hard/_base_v2/agent.py")
KN = load_agent(ROOT / "submissions/hard/_base_h10_knobs/agent.py")

E13 = {"co2_expand": 1.3}
PROBES = {
    "co2_expand13_only": E13,
    "r01_corr_co2_13": {**E13, "corr_scale": {"co2": 1.3}},
    "r02_corr_price_13": {**E13, "corr_scale": {"price": 1.3}},
    "r03_corr_mkt_13": {**E13, "corr_scale": {"co2": 1.3, "price": 1.3}},
    "r04_corr_mkt_16": {**E13, "corr_scale": {"co2": 1.6, "price": 1.6}},
    "r05_corr_net_13": {**E13, "corr_scale": {"load": 1.3, "pv": 1.3}},
    "r06_corr_mkt_13_noexp": {"corr_scale": {"co2": 1.3, "price": 1.3}},
    "s01_dst": {**E13, "dst_continuous": 1},
}


def run(label, mod, model, df):
    t0 = time.perf_counter()
    res = simulate(mod.BatteryAgent(model=model), df, spec=HARD)
    ms = 1000 * (time.perf_counter() - t0) / len(df)
    print(f"{label:26s} score={res.score:7.3f}  CO2 {res.d_co2_pct:6.2f}%  cost {res.d_cost_pct:6.2f}%  "
          f"viol={res.violations}  {ms:5.1f} ms/step", flush=True)
    return res, ms


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default=str(HERE / "model_holdout_lgb_cal.json"))
    ap.add_argument("--only", default="", help="comma list of probe name prefixes")
    ap.add_argument("--equiv", action="store_true")
    a = ap.parse_args()
    twin = json.loads(Path(a.model).read_text(encoding="utf-8"))
    twin.pop("wmult", None)
    twin.pop("wmult_pow", None)
    twin["co2_mult"] = 1.0
    df = monthly_blocks(load_campus_hourly(hard=True), "last")
    print(f"hold-out {len(df)} h\n", flush=True)
    rb, msb = run("BASELINE co2_mult=1.0", V2, twin, df)
    if a.equiv:
        rk, _ = run("knobs agent (reference)", KN, twin, df)
        d = np.abs(rb.trace["setpoint_kw"].values - rk.trace["setpoint_kw"].values)
        print(f"EQUIV max abs setpoint difference v2 vs h10_knobs: {d.max()!r}", flush=True)
    only = [x for x in a.only.split(",") if x]
    rows = []
    for name, over in PROBES.items():
        if only and not any(name.startswith(o) for o in only):
            continue
        res, ms = run(name, V2, {**twin, **over}, df)
        rows.append((name, res, ms))
    print("\nprobe | score | delta vs baseline | CO2 % | cost % | ms/step")
    print(f"baseline (co2_mult 1.0) | {rb.score:.3f} | 0 | {rb.d_co2_pct:.2f} | {rb.d_cost_pct:.2f} | {msb:.1f}")
    for name, res, ms in rows:
        print(f"{name} | {res.score:.3f} | {res.score - rb.score:+.3f} | {res.d_co2_pct:.2f} | {res.d_cost_pct:.2f} | {ms:.1f}")


if __name__ == "__main__":
    main()
