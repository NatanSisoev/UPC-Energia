"""Builds a "knob probe" submission: H10 (submissions/hard/_base_h10) with a few model.json settings changed.

  python -m experiments.hard.make_probe --name p01_price_expand05 --set price_expand=0.5 \
         --agent submissions/hard/_base_h10_knobs/agent.py
  python -m experiments.hard.make_probe --name p10_lgb_x15 --lgb-scale 1.5

--set key=value   value parsed as JSON (1.0, false, [3, 4] ...); repeatable
--lgb-scale X     multiplies every lgb_w vector by X (vectors of ones are created when absent)
--agent PATH      replaces agent.py (default: the agent of the base zip)
Writes submissions/hard/probes/NAME/ and NAME.zip (files at the zip root), runs the official checker.
Refuses to overwrite an existing NAME.
"""
import argparse
import json
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / "submissions" / "hard" / "_base_h10"
PROBES = ROOT / "submissions" / "hard" / "probes"
SERIES = ("price", "co2", "load", "pv")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", required=True)
    ap.add_argument("--set", action="append", default=[], metavar="key=value")
    ap.add_argument("--lgb-scale", type=float, default=None)
    ap.add_argument("--agent", default=None)
    a = ap.parse_args()

    out_dir, out_zip = PROBES / a.name, PROBES / f"{a.name}.zip"
    if out_dir.exists() or out_zip.exists():
        sys.exit(f"refusing to overwrite existing probe {a.name}")
    PROBES.mkdir(parents=True, exist_ok=True)
    shutil.copytree(BASE, out_dir)

    mp = out_dir / "model.json"
    model = json.loads(mp.read_text(encoding="utf-8"))
    for kv in a.set:
        k, _, v = kv.partition("=")
        model[k.strip()] = json.loads(v)
    if a.lgb_scale is not None:
        w = model.get("lgb_w") or {}
        model["lgb_w"] = {s: [float(x) * a.lgb_scale for x in w.get(s, [1.0] * 48)] for s in SERIES}
    mp.write_text(json.dumps(model), encoding="utf-8")
    if a.agent:
        shutil.copyfile(a.agent, out_dir / "agent.py")

    with zipfile.ZipFile(out_zip, "w", zipfile.ZIP_DEFLATED) as z:
        for f in sorted(out_dir.iterdir()):
            z.write(f, f.name)
    r = subprocess.run([sys.executable, str(ROOT / "starter_kit" / "check_submission.py"), str(out_zip)],
                       capture_output=True, text=True, cwd=ROOT)
    txt = (r.stdout + r.stderr).strip()
    ok = r.returncode == 0 and "invalid" not in txt.lower() and "error" not in txt.lower()
    print(txt[-600:])
    print(f"{a.name}: {'VALID' if ok else 'INVALID'}  -> {out_zip}")


if __name__ == "__main__":
    main()
