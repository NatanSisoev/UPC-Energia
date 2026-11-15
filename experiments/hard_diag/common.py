"""Shared helpers of the month diagnosis (hold-out twin of H10, stripped of wmult)."""
import json
from pathlib import Path

import numpy as np

import agent_hard.agent as ah
from experiments.hard.validate import OracleAgent
from sim.data import load_campus_hourly
from sim.simulator import HARD, simulate

ROOT = Path(__file__).resolve().parents[2]
MODEL = ROOT / "experiments" / "hard" / "model_holdout_lgb_cal.json"


def twin_params():
    p = json.loads(MODEL.read_text(encoding="utf-8"))
    p.pop("wmult", None)
    p.pop("wmult_pow", None)
    return p


def blocks():
    """{ 'YYYY-MM': 168 h dataframe } = last 7 train days of each month with load/solar (11 months)."""
    df = load_campus_hourly(hard=True)
    out = {}
    for (y, m), g in df.groupby([df.index.year, df.index.month]):
        if len(g) >= 168:
            out[f"{y}-{m:02d}"] = g.iloc[-168:]
    return df, out


class Rec(ah.BatteryAgent):
    """Twin that records its forecasts of load/pv/price/co2 at every step (24 leads)."""

    def __init__(self, model):
        super().__init__(model=model)
        self.rec = []

    def _forecast(self, i, n, cal, known):
        out = super()._forecast(i, n, cal, known)
        self.rec.append(tuple(np.array(x, dtype=float) for x in out))
        return out
