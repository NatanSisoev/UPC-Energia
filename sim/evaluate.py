"""python -m sim.evaluate [agent_path] [--weeks]  -> score an agent on data/train (or synthetic)."""
import argparse
import time

from sim.data import data_available, load_campus_hourly, synthetic_campus, week_blocks
from sim.simulator import load_agent_class, simulate


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("agent", nargs="?", default="agent/agent.py")
    ap.add_argument("--weeks", action="store_true", help="also score each whole week separately")
    a = ap.parse_args()

    if data_available():
        df = load_campus_hourly()
        print(f"data: real train set, {len(df)} h")
    else:
        df = synthetic_campus()
        print(f"data: SYNTHETIC ({len(df)} h) - put the official CSVs in data/train/ (see data/README.md)")

    cls = load_agent_class(a.agent)
    t0 = time.time()
    res = simulate(cls(), df)
    print("FULL:", res.summary(), f"({time.time() - t0:.1f}s)")
    if a.weeks:
        for k, wk in enumerate(week_blocks(df)):
            print(f"  week {k:02d} {wk.index[0].date()}:", simulate(cls(), wk).summary())


if __name__ == "__main__":
    main()
