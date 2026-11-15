"""Run the full hold-out chain for one kernel setting and score it.

  PYTHONPATH=. .venv/Scripts/python -m experiments.hardk.scan --tag h_bw15 [--bw 15] [--cyclic] [--kernel tri]

profiles -> ridge (build_model --holdout) -> boosters + error tables (lgb_build --holdout --calendar --err4 --eval)
-> validate-style simulation at co2_mult 1.0 and 1.8.  Everything is written to experiments/hardk/out/<tag>/.
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

import numpy as np

import agent_hard.agent as ah
from experiments.mpc.validate import monthly_blocks
from experiments.oracle.oracle_lp import oracle_run
from sim.data import load_campus_hourly
from sim.simulator import HARD, simulate

ROOT = Path(__file__).resolve().parents[2]
PY = [sys.executable, "-m"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tag", required=True)
    ap.add_argument("--bw", type=float, default=None)
    ap.add_argument("--cyclic", action="store_true")
    ap.add_argument("--kernel", default="tri")
    a = ap.parse_args()
    out = ROOT / "experiments/hardk/out" / a.tag
    out.mkdir(parents=True, exist_ok=True)
    k = (["--bw", str(a.bw), "--kernel", a.kernel] if a.bw else []) + (["--cyclic"] if a.cyclic else [])
    env = {**__import__("os").environ, "PYTHONPATH": str(ROOT)}
    lin = out / "model_linear.json"
    subprocess.run(PY + ["experiments.hardk.build_model", "--holdout", "--spread-mode", "flat", "--out", str(lin)] + k,
                   check=True, env=env, cwd=ROOT, stdout=(out / "build_model.log").open("w"))
    subprocess.run(PY + ["experiments.hardk.lgb_build", "--holdout", "--calendar", "--err4", "--rounds", "250",
                         "--leaves", "7", "--min-leaf", "800", "--wm", "0", "--lin", str(lin), "--out-dir", str(out), "--eval"] + k,
                   check=True, env=env, cwd=ROOT, stdout=(out / "lgb_build.log").open("w"))
    model = json.loads((out / "model_lgb.json").read_text(encoding="utf-8"))
    assert "wmult" not in model and "wmult_pow" not in model
    df = load_campus_hourly(hard=True)
    data = monthly_blocks(df, "last")
    bound = oracle_run(data, HARD)[0]
    res = {"tag": a.tag, "bw": a.bw, "cyclic": a.cyclic, "bound": bound,
           "mae": json.loads((out / "holdout_mae.json").read_text())}
    for mult in (1.0, 1.8):
        r = simulate(ah.BatteryAgent(model={**model, "co2_mult": mult}), data, spec=HARD)
        res[f"m{mult}"] = dict(score=r.score, co2=r.d_co2_pct, cost=r.d_cost_pct, viol=r.violations)
        print(f"{a.tag} co2_mult={mult}: score {r.score:.3f} CO2 {r.d_co2_pct:.2f}% cost {r.d_cost_pct:.2f}% viol {r.violations}")
    (out / "result.json").write_text(json.dumps(res, indent=1), encoding="utf-8")
    print(json.dumps(res["mae"]))


if __name__ == "__main__":
    main()
