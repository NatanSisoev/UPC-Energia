"""December deep dive part 2: per-day forecasts, calendar assignment, where the points go. Args: month (default 2025-12)."""
import pickle
import sys
from datetime import date, timedelta

import numpy as np
import pandas as pd

import agent_hard.agent as ah
from experiments.hard_diag.common import blocks, twin_params

mo = sys.argv[1] if len(sys.argv) > 1 else "2025-12"
out, traces = pickle.load(open("experiments/hard_diag/ladder.pkl", "rb"))
df, bl = blocks()
d = bl[mo]
tr, rec = traces[mo]
n = len(d)
pd.set_option("display.width", 250)
pd.set_option("display.max_columns", 50)

# ---------- per-day actual vs forecast at leads 0,3,12
cols = {"load": (2, "load_kw"), "pv": (3, "pv_kw"), "price": (0, "precio_eur_per_kwh"), "co2": (1, "co2_kg_per_kwh")}
days = sorted(set(d.index.date))
rows = []
for day in days:
    r = {"day": day}
    idx = [i for i, t in enumerate(d.index) if t.date() == day]
    for s, (j, col) in cols.items():
        a = d[col].values
        r[f"{s}_act"] = a[idx].mean()
        for lead in (0, 3, 12):
            # forecast made `lead` hours earlier for hours of this day
            f = [rec[i - lead][j][lead] for i in idx if i - lead >= 0]
            aa = [a[i] for i in idx if i - lead >= 0]
            r[f"{s}_f{lead}"] = np.mean(f) if f else np.nan
            r[f"{s}_mae{lead}"] = np.mean(np.abs(np.array(f) - np.array(aa))) if f else np.nan
    rows.append(r)
t = pd.DataFrame(rows).set_index("day")
for s, dec in (("load", 1), ("pv", 1), ("price", 4), ("co2", 4)):
    print(f"--- {s}: daily mean actual, mean forecast at lead 0/3/12 (made lead hours before), MAE at lead 0/3/12")
    print(t[[f"{s}_act", f"{s}_f0", f"{s}_f3", f"{s}_f12", f"{s}_mae0", f"{s}_mae3", f"{s}_mae12"]].round(dec if s in ("load", "pv") else 4))

# ---------- calendar of the surrounding dates
print("--- calendar classes (loadtype lt, market type mt, hol class hc, bridge, to_off, since_off, closure)")
ds = [date(2025, 12, 15) + timedelta(days=k) for k in range(0, 24)]
full = df  # train with load
prof = twin_params()
ld = full["load_kw"].resample("D").mean()
for x in ds:
    lt, mt, hc = ah.day_info(x)
    cf = ah.calendar_features(x)
    ts = pd.Timestamp(x)
    a = ld.get(ts, np.nan)
    print(x, x.strftime("%a"), "lt", lt, "mt", mt, "hc", hc, "bridge", cf[1], "to_off", cf[2], "since_off", cf[3], ah.closure_period(x),
          "mean load", None if np.isnan(a) else round(float(a)), "profile", round(float(np.mean(np.array(prof["load_prof"])[x.month - 1, lt])), 0))

# class counts in train
print("--- train days per load type (days with load data)")
cnt = {}
for ts in ld.dropna().index:
    lt = ah.day_info(ts.date())[0]
    cnt.setdefault(lt, []).append(ts.date())
for lt, l in sorted(cnt.items()):
    print(lt, len(l), "mean daily load", round(float(np.mean([ld[pd.Timestamp(x)] for x in l])), 0))
print("closure-weekday (lt=3) train days:", [str(x) for x in cnt.get(3, [])])
print("Dec working (lt 0) days with load data:", [(str(x), round(float(ld[pd.Timestamp(x)]))) for x in cnt.get(0, []) if x.month == 12])
