"""python -m sim.export_trace [agent_path] [--name baseline]
Run an agent over the whole train set and write a columnar JSON for the demo (3D viewer):
  demo/data/trace_<name>.json = {meta, summary, weeks:[{start,end,score,...}], cols:{t,load_kw,pv_kw,price,co2,setpoint_kw,soc_kwh,grid_kw,grid_base_kw}}
Sign convention: setpoint_kw > 0 charging, < 0 discharging. grid_kw = max(load-pv+setpoint, 0) (import); grid_base_kw = no-battery import.
"""
import argparse
import json
from pathlib import Path

import numpy as np

from sim.data import data_available, load_campus_hourly, synthetic_campus, week_blocks
from sim.simulator import load_agent_class, simulate

OUT = Path(__file__).resolve().parent.parent / "demo" / "data"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("agent", nargs="?", default="agent/agent.py")
    ap.add_argument("--name", default="baseline")
    a = ap.parse_args()

    real = data_available()
    df = load_campus_hourly() if real else synthetic_campus()
    cls = load_agent_class(a.agent)
    res = simulate(cls(), df)
    tr = res.trace
    load, pv = df["load_kw"].values, df["pv_kw"].values
    sp = tr["setpoint_kw"].values

    weeks = []
    for wk in week_blocks(df):
        r = simulate(cls(), wk)
        weeks.append({"start": str(wk.index[0]), "end": str(wk.index[-1]), "score": round(r.score, 3),
                      "d_co2_pct": round(r.d_co2_pct, 3), "d_cost_pct": round(r.d_cost_pct, 3), "violations": r.violations})

    out = {
        "meta": {"name": a.name, "real_data": real, "hours": len(df), "capacity_kwh": 2000, "power_kw": 500},
        "summary": {"score": round(res.score, 3), "d_co2_pct": round(res.d_co2_pct, 3), "d_cost_pct": round(res.d_cost_pct, 3),
                    "violations": res.violations, "co2_saved_kg": round(res.co2_base - res.co2_agent, 1),
                    "cost_saved_eur": round(res.cost_base - res.cost_agent, 2)},
        "weeks": weeks,
        "cols": {
            "t": [str(t) for t in df.index],
            "load_kw": np.round(load, 1).tolist(),
            "pv_kw": np.round(pv, 1).tolist(),
            "price": np.round(df["precio_eur_per_kwh"].values, 5).tolist(),
            "co2": np.round(df["co2_kg_per_kwh"].values, 5).tolist(),
            "setpoint_kw": np.round(sp, 1).tolist(),
            "soc_kwh": np.round(tr["soc_kwh"].values, 1).tolist(),
            "grid_kw": np.round(np.clip(load - pv + sp, 0, None), 1).tolist(),
            "grid_base_kw": np.round(np.clip(load - pv, 0, None), 1).tolist(),
        },
    }
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"trace_{a.name}.json"
    path.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {path} ({path.stat().st_size / 1e3:.0f} kB) | {res.summary()}")


if __name__ == "__main__":
    main()
