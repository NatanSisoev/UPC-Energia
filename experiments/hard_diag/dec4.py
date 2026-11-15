"""Hour-by-hour view of a window: actual vs what the agent believed (CO2/price at hour t seen from now and from 12 h earlier)."""
import pickle
import sys

import numpy as np
import pandas as pd

from experiments.hard_diag.common import blocks
from experiments.hard_diag.dec3 import lp_setpoint

mo, a, b = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
out, traces = pickle.load(open("experiments/hard_diag/ladder.pkl", "rb"))
df, bl = blocks()
d = bl[mo]
tr, rec = traces[mo]
lp = lp_setpoint(d)
net = (d["load_kw"] - d["pv_kw"]).values
print("t   | co2 act | co2 fc(from 6h before)  fc(24-step mean seen NOW for next 12h) | price act | net | twin sp | soc_before | LP sp")
for i in range(a, b):
    f_now_mean_co2 = rec[i][1][3:12].mean() if len(rec[i][1]) > 12 else np.nan
    act_next = d["co2_kg_per_kwh"].values[i + 3:i + 12].mean() if i + 12 <= len(d) else np.nan
    f6 = rec[i - 6][1][6] if i >= 6 else np.nan
    soc_before = tr["soc_kwh"].values[i - 1] if i else 3000
    print(f"{d.index[i]:%d %H}h co2 {d['co2_kg_per_kwh'].values[i]:.3f} fc6h {f6:.3f} | next3-11h: fc {f_now_mean_co2:.3f} act {act_next:.3f} | p {d['precio_eur_per_kwh'].values[i]:.3f} net {net[i]:5.0f} | twin {tr['setpoint_kw'].values[i]:6.0f} soc {soc_before:5.0f} | LP {lp[i]:6.0f}")
