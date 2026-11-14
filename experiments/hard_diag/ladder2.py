"""Extra rungs: perfect CO2 only / perfect price only; and market-variability stats per month."""
import numpy as np
import pandas as pd

import agent_hard.agent as ah
from experiments.hard_diag.common import twin_params, blocks
from experiments.hard.validate import OracleAgent
from sim.simulator import HARD, simulate


class Part(OracleAgent):
    def __init__(self, model, df, which):
        super().__init__(model, df, False, False)
        self.which = which

    def _forecast(self, i, n, cal, known):
        self._sim_step += 1
        price, co2, load, pv = ah.BatteryAgent._forecast(self, i, n, cal, known)
        s0, total = self._sim_step, len(self.df)
        nn = max(0, min(n, total - s0))
        if nn == 0:
            return price, co2, load, pv
        sl = slice(s0, s0 + nn)
        pad = lambda a, tail: np.concatenate([a, np.full(n - nn, tail)]) if nn < n else a
        if self.which == "co2":
            co2 = pad(self.df["co2_kg_per_kwh"].values[sl], float(co2[-1]))
        else:
            price = pad(self.df["precio_eur_per_kwh"].values[sl], float(price[-1]))
        return price, co2, load, pv


if __name__ == "__main__":
    params = twin_params()
    df, bl = blocks()
    p = twin_params()
    pp, cp = np.array(p["price_prof"]), np.array(p["co2_prof"])
    print("month   twin  coP   prP   | CO2 daily-mean cv(week)  intraday CO2 cv  | co2 12-23h ratio forecast-mean/actual-mean")
    for mo, d in bl.items():
        base = simulate(ah.BatteryAgent(model=params), d, spec=HARD).score
        a = simulate(Part(params, d, "co2"), d, spec=HARD).score
        b = simulate(Part(params, d, "price"), d, spec=HARD).score
        co2 = d["co2_kg_per_kwh"]
        dm = co2.groupby(co2.index.date).mean()
        intra = (co2.groupby(co2.index.date).std() / dm).mean()
        print(f"{mo}  {base:5.2f} {a:5.2f} {b:5.2f}  | {dm.std() / dm.mean():.2f}  {intra:.2f}")
    # month-level variability over the whole train year (all days with 24 h)
    from experiments.hard.build_model import load_signals
    sig = load_signals()
    dd = sig.groupby(sig.index.normalize()).mean()
    dd["m"] = dd.index.month
    print("\nwithin-month CV of the daily-mean CO2 and price over ALL train days:")
    print(dd.groupby("m").agg(co2_mean=("co2", "mean"), co2_cv=("co2", lambda x: x.std() / x.mean()), price_cv=("price", lambda x: x.std() / x.mean()), n=("co2", "size")).round(3))
