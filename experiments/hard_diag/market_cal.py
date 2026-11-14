"""Does the market (price, CO2) of closure / regional-holiday weekdays differ from the weekday profile of the month?
Ratio actual daily mean / profile weekday mean (hold-out twin profile = model fitted on days 1-17ish, so only days it saw are fair;
we list all)."""
import numpy as np
import pandas as pd

import agent_hard.agent as ah
from experiments.hard.build_model import load_signals
from experiments.hard_diag.common import twin_params

sig = load_signals()
p = twin_params()
pp, cp = np.array(p["price_prof"]), np.array(p["co2_prof"])
df = pd.DataFrame({"price": sig["price"], "co2": sig["co2"]})
df["day"] = df.index.normalize()
daily = df.groupby("day").agg(price=("price", "mean"), co2=("co2", "mean"), n=("price", "size"))
daily = daily[daily.n == 24]
rows = []
for day, r in daily.iterrows():
    d = day.date()
    lt, mt, hc = ah.day_info(d)
    m = d.month - 1
    rows.append(dict(day=d, dow=day.strftime("%a"), lt=lt, mt=mt, hc=hc, price=r.price, co2=r.co2,
                     p_prof=pp[m, mt].mean(), c_prof=cp[m, mt].mean(), p_wd=pp[m, 0].mean(), c_wd=cp[m, 0].mean(),
                     p_sun=pp[m, 2].mean(), c_sun=cp[m, 2].mean()))
t = pd.DataFrame(rows)
t["p_ratio"] = t.price / t.p_prof
t["c_ratio"] = t.co2 / t.c_prof
pd.set_option("display.width", 250)
pd.set_option("display.max_rows", 200)
sel = t[(t.hc.isin([2, 3, 4])) | (t.day.astype(str).isin(["2025-12-18", "2025-12-19", "2025-12-22", "2025-12-23"]))]
print(sel.round(3).to_string())
print("\nmean ratio by holiday class (hc) over all days:")
print(t.groupby("hc")[["p_ratio", "c_ratio"]].agg(["mean", "std", "count"]).round(3))
print("\nratio vs the weekday profile (instead of the assigned) for hc 3/4 days:")
x = t[t.hc.isin([3, 4])]
print((x.price / x.p_wd).mean().round(3), (x.co2 / x.c_wd).mean().round(3), len(x))
print("\nratio vs SUNDAY profile for hc 3/4 days:", (x.price / x.p_sun).mean().round(3), (x.co2 / x.c_sun).mean().round(3))
print("\ncountry-wide christmas days in train? Jan 1-6 (daily mean vs profile):")
print(t[(t.day >= pd.Timestamp("2026-01-01").date()) & (t.day <= pd.Timestamp("2026-01-07").date())].round(3).to_string())
