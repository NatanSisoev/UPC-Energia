"""Hold-out effect of every knob probe (same overrides as experiments/hard/make_probe.py, applied in memory).

Twin of H10: experiments/hard/model_holdout_lgb_cal.json (models fitted without the last 7 train days of each month),
baseline = twin with co2_mult 1.8. Every simulation is one run over the 1,848 hold-out hours, sequential.
Also prints the per-month table (no-battery CO2/cost, avoided by the baseline run, perfect-foresight avoided).

Run: PYTHONPATH=. .venv/Scripts/python -m experiments.hard.probe_holdout [--model path] [--only p01,p05] [--months]
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
from sim.simulator import HARD, _grid_metrics, simulate

HERE = Path(__file__).parent

# name -> (overrides of the model dict, lgb_scale or None); mirrors the make_probe calls
PROBES = {
    "p01_price_expand05": ({"price_expand": 0.5}, None),
    "p02_price_expand00": ({"price_expand": 0.0}, None),
    "p03_tilt10_pexp05": ({"co2_mult": 1.0, "price_expand": 0.5}, None),
    "p04_co2_expand13": ({"co2_expand": 1.3}, None),
    "p05_horizon12": ({"horizon": 12}, None),
    "p06_horizon36": ({"horizon": 36}, None),
    "p06b_horizon36_grid81": ({"horizon": 36, "n_grid": 81}, None),
    "p07_spread06": ({"spread_scale": 0.6}, None),
    "p08_spread14": ({"spread_scale": 1.4}, None),
    "p09_no_lgb": ({"lgb": False}, None),
    "p10_lgb_x15": ({}, 1.5),
    "p11_lgb_x05": ({}, 0.5),
}


def make_model(base, over, scale):
    m = dict(base)
    m.update(over)
    if scale is not None:
        w = m.get("lgb_w") or {}
        m["lgb_w"] = {s: [float(x) * scale for x in w.get(s, [1.0] * 48)] for s in ("price", "co2", "load", "pv")}
    return m


def run(label, model, df):
    t0 = time.perf_counter()
    res = simulate(ah.BatteryAgent(model=model), df, spec=HARD)
    ms = 1000 * (time.perf_counter() - t0) / len(df)
    print(f"{label:26s} score={res.score:7.3f}  CO2 {res.d_co2_pct:6.2f}%  cost {res.d_cost_pct:6.2f}%  "
          f"viol={res.violations}  {ms:5.1f} ms/step", flush=True)
    return res, ms


def month_table(df, res):
    sp = res.trace["setpoint_kw"].values
    load, pv = df["load_kw"].values, df["pv_kw"].values
    price, co2 = df["precio_eur_per_kwh"].values, df["co2_kg_per_kwh"].values
    print("\nper-month (hold-out, baseline run; oracle = perfect foresight on that month's 168 h alone, SOC0 50 %)")
    print("month | noBat CO2 kg | CO2 avoided kg | oracle CO2 avoided kg | noBat cost EUR | cost avoided EUR | oracle cost avoided EUR")
    mon = df.index.month.values
    for m in sorted(set(mon)):
        s = np.where(mon == m)[0]
        z = np.zeros(len(s))
        cb, kb = _grid_metrics(load[s], pv[s], z, price[s], co2[s])
        ca, ka = _grid_metrics(load[s], pv[s], sp[s], price[s], co2[s])
        o = oracle_run(df.iloc[s], HARD)
        print(f"{m:5d} | {cb:12.0f} | {cb - ca:14.0f} | {cb * o[1] / 100:21.0f} | {kb:14.1f} | {kb - ka:16.1f} | "
              f"{kb * o[2] / 100:23.1f}", flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default=str(HERE / "model_holdout_lgb_cal.json"))
    ap.add_argument("--only", default="", help="comma list of probe name prefixes")
    ap.add_argument("--months", action="store_true", help="per-month table from the baseline run")
    ap.add_argument("--base-mult", type=float, default=1.8)
    a = ap.parse_args()
    twin = json.loads(Path(a.model).read_text(encoding="utf-8"))
    df = monthly_blocks(load_campus_hourly(hard=True), "last")
    print(f"twin = {a.model}  keys: lgb={twin.get('lgb')} calendar={twin.get('calendar')} lgb_dir={twin.get('lgb_dir')}")
    print(f"hold-out {len(df)} h, bound {oracle_run(df, HARD)[0]:.2f}\n", flush=True)
    only = [x for x in a.only.split(",") if x]
    rows = []
    r10, _ = run("twin co2_mult=1.0", {**twin, "co2_mult": 1.0}, df)
    rb, msb = run("BASELINE co2_mult=1.8", {**twin, "co2_mult": a.base_mult}, df)
    for name, (over, scale) in PROBES.items():
        if only and not any(name.startswith(o) for o in only):
            continue
        base = {**twin, "co2_mult": a.base_mult}
        res, ms = run(name, make_model(base, over, scale), df)
        rows.append((name, res, ms))
    print("\nprobe | hold-out score | delta vs baseline | CO2 % | cost % | ms/step")
    print(f"baseline (co2_mult {a.base_mult}) | {rb.score:.3f} | 0 | {rb.d_co2_pct:.2f} | {rb.d_cost_pct:.2f} | {msb:.1f}")
    for name, res, ms in rows:
        print(f"{name} | {res.score:.3f} | {res.score - rb.score:+.3f} | {res.d_co2_pct:.2f} | {res.d_cost_pct:.2f} | {ms:.1f}")
    if a.months:
        month_table(df, rb)


if __name__ == "__main__":
    main()
