"""Grid search of the planner knobs on the hold-out sample (last 7 train days of each month).

Knobs, in the order docs/HARD_MODE_HANDOFF.md 5.2 lists them: scenario spread (scale, lead-dependent vs flat),
terminal value of stored energy, planning horizon, and the SOC-grid resolution (241 -> 121 points halves the
planner's cost; the first-hour candidates stay exact, only the cost-to-go curve is coarser).

All cells share ONE process, so per-step timings are distorted by whatever the machine is doing; scores are
comparable, timings are only indicative. Timing of the chosen config is measured separately, fresh process.

Run: python -m experiments.hard.tune [--model experiments/hard/model_holdout.json]
"""
import argparse
import json
import time
from pathlib import Path

import numpy as np

import agent_hard.agent as ah
from experiments.mpc.validate import monthly_blocks
from experiments.oracle.oracle_lp import oracle_run
from sim.data import load_campus_hourly
from sim.simulator import HARD, simulate

HERE = Path(__file__).parent


def run_cell(label, params, df, bound, spread_scale=None, spread_mode=None, terminal_value=None,
             horizon=None, grid=None):
    p = dict(params)
    if spread_scale is not None:
        p["spread_scale"] = spread_scale
    if spread_mode is not None:
        p["spread_mode"] = spread_mode
    if terminal_value is not None:
        p["terminal_value"] = terminal_value
    old = (ah.HORIZON, ah.N_GRID)
    if horizon is not None:
        ah.HORIZON = horizon
    if grid is not None:
        ah.N_GRID = grid
    try:
        t0 = time.perf_counter()
        res = simulate(ah.BatteryAgent(model=p), df, spec=HARD)
        ms = 1000 * (time.perf_counter() - t0) / len(df)
    finally:
        ah.HORIZON, ah.N_GRID = old
    print(f"{label:44s} score={res.score:6.3f}  ({100 * res.score / bound:5.1f} % of bound)  viol={res.violations}"
          f"  ~{ms:5.1f} ms/step", flush=True)
    return res.score


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default=str(HERE / "model_holdout.json"))
    a = ap.parse_args()
    params = json.loads(Path(a.model).read_text(encoding="utf-8"))
    df = monthly_blocks(load_campus_hourly(hard=True), "last")
    bound = oracle_run(df, HARD)[0]
    print(f"hold-out: {len(df)} h   bound = {bound:.3f}\n")

    best = {"scale": 1.0, "mode": "lead"}
    scores = {}
    for s in (1.0, 0.5, 0.0):
        scores[f"lead s={s}"] = run_cell(f"spread lead scale={s}", params, df, bound, spread_scale=s)
    for s in (1.0, 0.5):
        scores[f"flat s={s}"] = run_cell(f"spread flat scale={s}", params, df, bound, spread_scale=s, spread_mode="flat")
    key = max(scores, key=scores.get)
    best["scale"] = float(key.split("s=")[1])
    best["mode"] = key.split(" ")[0]
    print(f"--> best spread: {key}  ({scores[key]:.3f})\n")

    kw = {"spread_scale": best["scale"], "spread_mode": best["mode"]}
    for tv in (1e-5, 5e-5):
        run_cell(f"terminal_value={tv:g} at best spread", params, df, bound, terminal_value=tv, **kw)
    for h in (24, 36):
        run_cell(f"HORIZON={h} at best spread", params, df, bound, horizon=h, **kw)
    run_cell("N_GRID=121 (fast planner)", params, df, bound, grid=121, **kw)
    run_cell("N_GRID=121 + HORIZON=36", params, df, bound, grid=121, horizon=36, **kw)


if __name__ == "__main__":
    main()
