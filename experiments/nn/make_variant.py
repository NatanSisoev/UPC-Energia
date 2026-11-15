"""Derive a NEW submission folder + zip from an existing one by editing model.json / nn.json. Never overwrites.

Run from the repo root. Examples:
  .venv/Scripts/python experiments/nn/make_variant.py --src submissions/hard/nn/c33_mlp_market_only \
      --name c35_mlp_market_only_e13 --set co2_expand=1.3
  .venv/Scripts/python experiments/nn/make_variant.py --src submissions/hard/nn/c40_SOMETHING \
      --name c42_nhits_market --blend-market 0.5 --blend-net 0 --drop-err-nn --set co2_expand=1.3
  .venv/Scripts/python experiments/nn/make_variant.py --src submissions/hard/probes/p04_co2_expand13 \
      --name f01_p04_dst --out submissions/hard/final --agent submissions/hard/_base_v2/agent.py --set dst_continuous=1

--set KEY=JSON      set a model.json key (value parsed as JSON: 1.3, true, {"co2": 1.3}, [1, 2])
--unset KEY         remove a model.json key
--drop-err-nn       remove "err_nn" (the agent then uses H10's own uncertainty table "err_lgb")
--blend-market X    nn.json blend for price and co2 (0 = LightGBM only, 1 = neural net only)
--blend-net X       nn.json blend for load and pv
--agent FILE        replace agent.py by this file
--copy FILE         copy an extra file into the folder (repeatable; replaces a file of the same name)
The zip gets every file of the folder except *_info.json, at the zip root, and is checked by the official checker.
"""
import argparse
import json
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def _path(p):
    p = Path(p)
    return p if p.is_absolute() else ROOT / p


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True)
    ap.add_argument("--name", required=True)
    ap.add_argument("--out", default=None, help="parent folder of the new variant (default: parent of --src)")
    ap.add_argument("--set", action="append", default=[], metavar="KEY=JSON")
    ap.add_argument("--unset", action="append", default=[])
    ap.add_argument("--drop-err-nn", action="store_true")
    ap.add_argument("--blend-market", type=float, default=None)
    ap.add_argument("--blend-net", type=float, default=None)
    ap.add_argument("--agent", default=None)
    ap.add_argument("--copy", action="append", default=[])
    a = ap.parse_args()

    src = _path(a.src)
    dst = (_path(a.out) if a.out else src.parent) / a.name
    if not (src / "agent.py").exists() or not (src / "model.json").exists():
        sys.exit(f"ERROR: {src} is not a submission folder (agent.py + model.json expected)")
    if dst.exists() or dst.with_suffix(".zip").exists():
        sys.exit(f"ERROR: {dst} already exists - choose a new --name (nothing is ever overwritten)")
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(src, dst)
    for f in dst.glob("*_info.json"):
        f.unlink()

    model = json.loads((dst / "model.json").read_text(encoding="utf-8"))
    for kv in a.set:
        key, _, val = kv.partition("=")
        model[key] = json.loads(val)
    for key in a.unset + (["err_nn"] if a.drop_err_nn else []):
        model.pop(key, None)
    (dst / "model.json").write_text(json.dumps(model), encoding="utf-8")

    if a.blend_market is not None or a.blend_net is not None:
        if not (dst / "nn.json").exists():
            sys.exit("ERROR: --blend-* needs a folder with nn.json (a neural candidate)")
        nn = json.loads((dst / "nn.json").read_text(encoding="utf-8"))
        for group, val in ((("price", "co2"), a.blend_market), (("load", "pv"), a.blend_net)):
            if val is not None:
                for s in group:
                    nn["blend"][s] = val
        (dst / "nn.json").write_text(json.dumps(nn), encoding="utf-8")
    if a.agent:
        shutil.copyfile(_path(a.agent), dst / "agent.py")
    for extra in a.copy:
        shutil.copyfile(_path(extra), dst / Path(extra).name)

    info = {"src": str(src), "set": a.set, "unset": a.unset, "drop_err_nn": a.drop_err_nn,
            "blend_market": a.blend_market, "blend_net": a.blend_net, "agent": a.agent, "copy": a.copy}
    (dst / "variant_info.json").write_text(json.dumps(info, indent=1), encoding="utf-8")

    zpath = dst.with_suffix(".zip")
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
        for f in sorted(dst.iterdir()):
            if f.is_file() and not f.name.endswith("_info.json"):
                z.write(f, f.name)
    out = subprocess.run([sys.executable, str(ROOT / "starter_kit" / "check_submission.py"), str(zpath)],
                         capture_output=True, text=True, encoding="utf-8", errors="replace", cwd=str(ROOT))
    ok = "LIDA I EST" in out.stdout
    shown = {k: model.get(k) for k in ("co2_mult", "co2_expand", "price_expand", "corr_scale", "dst_continuous",
                                       "horizon", "spread_scale", "lgb", "nn")}
    print(f"{a.name}: {'VALID' if ok else 'CHECK FAILED'} -> {zpath}")
    print("  settings:", shown, "| err_nn" if "err_nn" in model else "| no err_nn")
    if not ok:
        print(out.stdout[-800:], out.stderr[-800:])
        sys.exit(1)


if __name__ == "__main__":
    main()
