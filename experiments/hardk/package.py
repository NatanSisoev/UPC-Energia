"""Package a final kernel model as a submission candidate: folder + zip with agent.py (unchanged copy) at the root.

  PYTHONPATH=. .venv/Scripts/python -m experiments.hardk.package --tag f_bw30 --name k01_bw30
"""
import argparse
import json
import shutil
import time
import zipfile
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
ap = argparse.ArgumentParser()
ap.add_argument("--tag", required=True)
ap.add_argument("--name", required=True)
a = ap.parse_args()
src = ROOT / "experiments/hardk/out" / a.tag
dst = ROOT / "submissions/hard/kernel" / a.name
assert not dst.exists(), "never overwrite"
dst.mkdir(parents=True)
shutil.copy(ROOT / "agent_hard/agent.py", dst / "agent.py")
m = json.loads((src / "model_lgb.json").read_text(encoding="utf-8"))
assert "wmult" not in m and "wmult_pow" not in m and "lgb_dir" not in m and m["co2_mult"] == 1.8
shutil.copy(src / "model_lgb.json", dst / "model.json")
for s in ("price", "co2", "load", "pv"):
    shutil.copy(src / f"lgb_{s}.txt", dst / f"lgb_{s}.txt")
zp = dst.parent / f"{a.name}.zip"
with zipfile.ZipFile(zp, "w", zipfile.ZIP_DEFLATED) as z:
    for f in ("agent.py", "model.json", "lgb_price.txt", "lgb_co2.txt", "lgb_load.txt", "lgb_pv.txt"):
        z.write(dst / f, f)
print(zp, f"{zp.stat().st_size / 1e6:.2f} MB")
# ms/step: one local simulation of the zip's agent on the 1848 h hold-out-shaped glued run
import importlib.util
from experiments.mpc.validate import monthly_blocks
from sim.data import load_campus_hourly
from sim.simulator import HARD, simulate
spec = importlib.util.spec_from_file_location("cand_agent", dst / "agent.py")
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
data = monthly_blocks(load_campus_hourly(hard=True), "last")
t0 = time.perf_counter()
r = simulate(mod.BatteryAgent(), data, spec=HARD)
print(f"{a.name}: {1000 * (time.perf_counter() - t0) / len(data):.1f} ms/step on {len(data)} h (in-sample for a final model: score {r.score:.2f} not meaningful), viol {r.violations}")
