"""Validate the Hard Mode agent against the perfect-foresight bound on the hidden-test shape, and run the
value-of-information ladder: which forecast, if it were perfect, buys how much score?

Data: the last 7 train days of every month glued into one run (1,848 h) -- the same shape as the hidden test.
The model MUST be fitted without those days: `python -m experiments.hard.build_model --holdout` writes
experiments/hard/model_holdout.json, which this script loads by default.

Ladder rungs (subclass of the agent that overrides _forecast with the truth of the ACTUAL future rows of the
run, spread removed where the net load is already perfect):
  * all perfect      -> must sit near the LP bound: measures the planner, not the forecasts;
  * market only      -> perfect price/CO2, forecast load/solar;
  * load/solar only  -> perfect net load, forecast price/CO2.

Run: python -m experiments.hard.validate [--model path] [--data last|first|full] [--ladder] [--tune]
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


class OracleAgent(ah.BatteryAgent):
    """BatteryAgent whose forecasts (or part of them) are replaced by the truth of the actual future rows."""

    def __init__(self, model, df, perfect_market=False, perfect_net=False):
        super().__init__(model=model)
        self.df = df
        self.p_market, self.p_net = perfect_market, perfect_net
        self._sim_step = -1                              # one act() == one row of df, in order

    def _forecast(self, i, n, cal, known):
        self._sim_step += 1
        price, co2, load, pv = super()._forecast(i, n, cal, known)
        s0, total = self._sim_step, len(self.df)
        nn = max(0, min(n, total - s0))
        if nn == 0:
            return price, co2, load, pv
        sl = slice(s0, s0 + nn)

        def pad(arr, tail):
            return np.concatenate([arr, np.full(n - nn, tail)]) if nn < n else arr

        if self.p_market:
            price = pad(self.df["precio_eur_per_kwh"].values[sl], float(price[-1]))
            co2 = pad(self.df["co2_kg_per_kwh"].values[sl], float(co2[-1]))
        if self.p_net:
            load = pad(self.df["load_kw"].values[sl], float(load[-1]))
            pv = pad(self.df["pv_kw"].values[sl], float(pv[-1]))
        return price, co2, load, pv

    def _spread(self, n, cal):
        if self.p_net:                                   # perfect net load: no scenario spread needed
            return np.zeros((n, self.m["err"].shape[2]))
        return super()._spread(n, cal)


def run(make_agent, df, label, bound=None):
    t0 = time.perf_counter()
    res = simulate(make_agent(), df, spec=HARD)
    ms = 1000 * (time.perf_counter() - t0) / len(df)
    line = (f"{label:36s} score={res.score:6.3f}  (CO2 {res.d_co2_pct:5.2f}%  cost {res.d_cost_pct:5.2f}%)  "
            f"viol={res.violations}  {ms:5.1f} ms/step")
    if bound:
        line += f"  -> {100 * res.score / bound:5.1f}% of bound"
    print(line)
    return res


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default=str(Path(__file__).parent / "model_holdout.json"))
    ap.add_argument("--data", choices=("last", "first", "full"), default="last")
    ap.add_argument("--ladder", action="store_true", help="run the value-of-information ladder")
    ap.add_argument("--tune", action="store_true", help="grid over spread_scale / spread_mode / tv / horizon")
    a = ap.parse_args()

    df = load_campus_hourly(hard=True)
    data = df if a.data == "full" else monthly_blocks(df, a.data)
    params = json.loads(Path(a.model).read_text(encoding="utf-8"))
    bound = oracle_run(data, HARD)[0]
    print(f"data: {len(data)} h ({a.data})   perfect-foresight bound = {bound:.2f}")

    run(lambda: ah.BatteryAgent(model=params), data, "agent (model from json)", bound)
    if a.ladder:
        run(lambda: OracleAgent(params, data, True, True), data, "oracle: ALL forecasts perfect", bound)
        run(lambda: OracleAgent(params, data, True, False), data, "oracle: perfect market only", bound)
        run(lambda: OracleAgent(params, data, False, True), data, "oracle: perfect load/solar only", bound)
    if a.tune:
        print("\ntuning grid (each cell = one full run):")
        for s in (0.0, 0.5, 1.0):
            run(lambda: ah.BatteryAgent(model={**params, "spread_scale": s}), data, f"spread_scale={s}", bound)
        run(lambda: ah.BatteryAgent(model={**params, "spread_mode": "flat"}), data, "spread_mode=flat", bound)
        for tv in (1e-5, 5e-5):
            run(lambda: ah.BatteryAgent(model={**params, "terminal_value": tv}), data, f"terminal_value={tv}", bound)
        for h in (24, 36):
            old = ah.HORIZON
            ah.HORIZON = h
            try:
                run(lambda: ah.BatteryAgent(model=params), data, f"HORIZON={h}", bound)
            finally:
                ah.HORIZON = old


if __name__ == "__main__":
    main()
