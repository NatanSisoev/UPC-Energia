"""Equivalence test: agent_hard_nn without an "nn" key must give EXACTLY the setpoints of agent_hard (H10 twin, hold-out run).
Run: PYTHONPATH=. .venv/Scripts/python -m experiments.nn.equiv_test"""
import json
from pathlib import Path

import numpy as np

import agent_hard.agent as orig
import agent_hard_nn.agent as new
from experiments.mpc.validate import monthly_blocks
from sim.data import load_campus_hourly
from sim.simulator import HARD, simulate

TWIN = Path(__file__).resolve().parents[1] / "hard" / "model_holdout_lgb_cal.json"


def main():
    params = json.loads(TWIN.read_text(encoding="utf-8"))
    params.pop("wmult", None)                      # the true H10 twin has no price-uncertainty planner
    params.pop("wmult_pow", None)
    data = monthly_blocks(load_campus_hourly(hard=True), "last")
    a = simulate(orig.BatteryAgent(model=params), data, spec=HARD)
    b = simulate(new.BatteryAgent(model=params), data, spec=HARD)
    diff = float(np.max(np.abs(a.trace["setpoint_kw"].values - b.trace["setpoint_kw"].values)))
    print(f"orig score {a.score:.4f}  nn-agent (no nn key) score {b.score:.4f}  max |setpoint diff| = {diff!r}")
    assert diff == 0.0, "NOT identical"
    print("IDENTICAL")


if __name__ == "__main__":
    main()
