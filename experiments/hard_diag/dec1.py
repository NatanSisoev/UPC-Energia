"""December / March / September deep dive part 1: forecast errors by lead, per day, per month."""
import pickle
import sys

import numpy as np
import pandas as pd

from experiments.hard_diag.common import blocks

out, traces = pickle.load(open("experiments/hard_diag/ladder.pkl", "rb"))
df, bl = blocks()
pd.set_option("display.width", 250)


def err_tables(mo):
    d = bl[mo]
    tr, rec = traces[mo]
    n = len(d)
    price, co2, load, pv = (d["precio_eur_per_kwh"].values, d["co2_kg_per_kwh"].values, d["load_kw"].values, d["pv_kw"].values)
    act = {"price": price, "co2": co2, "load": load, "pv": pv}
    res = {}
    for j, s in enumerate(("price", "co2", "load", "pv")):
        a = act[s]
        e = {}
        for lead in (0, 3, 12):
            vals = []
            for i in range(n):
                if i + lead < n and len(rec[i][j]) > lead:
                    vals.append((i, rec[i][j][lead], a[i + lead]))
            e[lead] = np.array(vals)
        res[s] = e
    return res


def summary_mae(mo):
    d = bl[mo]
    tr, rec = traces[mo]
    n = len(d)
    row = {}
    for j, s, col in ((0, "price", "precio_eur_per_kwh"), (1, "co2", "co2_kg_per_kwh"), (2, "load", "load_kw"), (3, "pv", "pv_kw")):
        a = d[col].values
        for name, rng in (("3-11", range(3, 12)), ("12-23", range(12, 24))):
            errs = []
            for i in range(n):
                for L in rng:
                    if i + L < n and len(rec[i][j]) > L:
                        errs.append(rec[i][j][L] - a[i + L])
            errs = np.array(errs)
            row[f"{s}_{name}_mae"] = np.abs(errs).mean()
            row[f"{s}_{name}_bias"] = errs.mean()
        row[f"{s}_mean"] = a.mean()
    return row


rows = {mo: summary_mae(mo) for mo in bl}
t = pd.DataFrame(rows).T
t["price_mae_rel_3-11"] = t["price_3-11_mae"] / t["price_mean"]
t["co2_mae_rel_3-11"] = t["co2_3-11_mae"] / t["co2_mean"]
t["price_mae_rel_12-23"] = t["price_12-23_mae"] / t["price_mean"]
t["co2_mae_rel_12-23"] = t["co2_12-23_mae"] / t["co2_mean"]
print(t[["price_mean", "price_3-11_mae", "price_3-11_bias", "price_12-23_mae", "price_12-23_bias",
         "price_mae_rel_3-11", "price_mae_rel_12-23"]].round(4))
print(t[["co2_mean", "co2_3-11_mae", "co2_3-11_bias", "co2_12-23_mae", "co2_12-23_bias",
         "co2_mae_rel_3-11", "co2_mae_rel_12-23"]].round(4))
print(t[["load_mean", "load_3-11_mae", "load_3-11_bias", "load_12-23_mae", "load_12-23_bias",
         "pv_mean", "pv_3-11_mae", "pv_3-11_bias", "pv_12-23_mae", "pv_12-23_bias"]].round(1))
others = [m for m in bl if m not in ("2025-12",)]
print("\nAVERAGE of others:")
print(t.loc[others].mean().round(4))
print("\nDEC:")
print(t.loc["2025-12"].round(4))
print(bl["2025-12"].index[0], bl["2025-12"].index[-1])
for mo in bl:
    print(mo, bl[mo].index[0], bl[mo].index[-1])
