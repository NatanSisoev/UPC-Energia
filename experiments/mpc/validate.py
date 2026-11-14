"""Final validation of an agent with the OFFICIAL environment (starter_kit/environment.py), experiments only.

Three data sets, each run as ONE simulation (SOC carried across the month jumps, like the hidden test):
  * test-like : the last 7 available days of every train month glued together (same shape as the hidden test:
                one 168 h block per month, time jumps between blocks, forecast lists crossing the jumps)
  * first-week: the first 7 days of every train month (a second, disjoint sample of the same shape)
  * full train: all 5,993 h
For each: official score, the perfect-foresight bound (experiments/oracle) and the time per decision.

Run:  python -m experiments.mpc.validate [agent path]
"""
import sys
import time
from pathlib import Path

import pandas as pd

from experiments.oracle.oracle_lp import oracle_run
from sim.data import load_campus_hourly
from sim.simulator import load_agent_class

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "starter_kit"))
from environment import run_agent_simulation  # noqa: E402  (official kit, git-ignored: scripts/fetch_kit.py)


def monthly_blocks(df: pd.DataFrame, which: str) -> pd.DataFrame:
    parts = []
    for _, month in df.groupby([df.index.year, df.index.month]):
        if len(month) >= 168:
            parts.append(month.iloc[-168:] if which == "last" else month.iloc[:168])
    return pd.concat(parts)


if __name__ == "__main__":
    agent_path = sys.argv[1] if len(sys.argv) > 1 else "agent/agent.py"
    cls = load_agent_class(agent_path)
    df = load_campus_hourly()
    for name, data in [("test-like (last 7 d of each month)", monthly_blocks(df, "last")),
                       ("first 7 d of each month", monthly_blocks(df, "first")),
                       ("full train set", df)]:
        data = data.rename_axis("Fecha")
        t0 = time.perf_counter()
        res = run_agent_simulation(cls(), data)
        dt = time.perf_counter() - t0
        bound = oracle_run(data)[0]
        print(f"{name:36s} {len(data):5d} h | official score {res['score']:.2f}  (CO2 {res['co2_estalviat_pct']:.2f} %, "
              f"cost {res['cost_estalviat_pct']:.2f} %, infractions {res['infraccions']}) | bound {bound:.3f} "
              f"-> {100 * res['score'] / bound:.1f} % | {1000 * dt / len(data):.1f} ms/step, "
              f"{dt * 2016 / len(data):.0f} s per 2,016 h")
