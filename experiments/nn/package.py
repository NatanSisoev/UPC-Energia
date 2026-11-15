"""Hold-out score + submission package of a neural candidate.
PYTHONPATH=. .venv/Scripts/python -m experiments.nn.package --id c30 --members mlp:base [arch:tag ...] --blend 0.5
(i)  hold-out agent: agent_hard_nn + H10 hold-out twin (wmult removed) + the members' holdout-mode weights, err_nn from ds_eval;
     simulates the hold-out weeks and prints the score next to the H10 twin (same co2_mult).
(ii) submissions/hard/nn/<id>_<name>/ (agent.py, model.json, lgb_*.txt, nn.json, weights) + the zip beside it, then
     AST scan, official checker and ms/step. Refuses to overwrite an existing id."""
import argparse
import importlib
import json
import shutil
import subprocess
import sys
import time
import zipfile
from pathlib import Path

import numpy as np

import agent_hard_nn.agent as ah
from experiments.hard.lgb_build import err_table, err_table4
from experiments.mpc.validate import monthly_blocks
from experiments.nn import common as C
from experiments.nn.runs_util import member_files
from sim.check import ast_scan
from sim.data import load_campus_hourly
from sim.simulator import HARD, load_agent_class, simulate

ROOT = Path(__file__).resolve().parents[2]
TWIN = ROOT / "experiments/hard/model_holdout_lgb_cal.json"
FULL = ROOT / "agent_hard/model_lgb.json"
SUBS = ROOT / "submissions/hard/nn"
PKG = Path(__file__).resolve().parent / "packages"
MARK = "# @@NN_FORWARD@@"


def nn_spec(members, blend, mode, scale):
    """nn.json content + {file name: source path} for the weights of the given mode."""
    files, entries = {}, []
    seeds = {m: member_files(m, mode) for m in members}
    total = sum(len(v) for v in seeds.values())
    for m, paths in seeds.items():
        arch, tag = m.split(":")
        cfg = json.loads((paths[0].parent.parent / "holdout" / "metrics.json").read_text())["cfg"]
        for p in paths:
            name = f"nn_{arch}_{tag}_{p.stem.split('_')[-1]}.npz"
            files[name] = p
            entries.append({"arch": arch, "weights": name, "cfg": cfg, "weight": 1.0 / total})
    return {"L": 96, "H": 24, "scale": scale, "blend": {s: blend for s in C.SERIES}, "members": entries}, files


def numpy_out(spec, files, ds):
    """Neural corrections (N,4,24) of the whole ensemble on a dataset, with the numpy forwards."""
    out = np.zeros((len(ds["y"]), 4, 24))
    for e in spec["members"]:
        z = np.load(files[e["weights"]])
        W = {k: z[k] for k in z.files}
        fn = ah.NN_REGISTRY[e["arch"]]
        for j in range(len(out)):
            out[j] += e["weight"] * fn(W, ds["hist"][j], ds["fut"][j], ds["stat"][j], e["cfg"])
    return out


def err_nn_table(ds, out, blend, k, ndim):
    """Error quantiles of the final blended net-load forecast on ds_eval, same shape/logic as the model's err_lgb."""
    fin = C.blend_forecast(ds, out, blend)
    n, pad = len(ds["y"]), 24
    P = lambda a, v: np.concatenate([a, np.full((n, 48 - pad), v)], axis=1)
    hour = np.round(np.arctan2(ds["fut"][:, :, 1], ds["fut"][:, :, 2]) * 24 / (2 * np.pi)) % 24
    ltype = np.argmax(ds["fut"][:, :, 3:7], axis=2)
    X = np.zeros((n, 48, 4))
    X[:, :, 1], X[:, :, 3] = P(hour, 0), P(ltype, 0)
    d = {"lin_load": P(fin[:, 2], 0.0), "lin_pv": P(fin[:, 3], 0.0), "clear": P(ds["fut"][:, :, C.FUT_CLEAR] * 1700.0, 0.0),
         "t_load": P(ds["truth"][:, 2], np.nan), "t_pv": P(ds["truth"][:, 3], np.nan), "X_load": X}
    zero = {"load": 0.0, "pv": 0.0}
    return (err_table4 if ndim == 4 else err_table)(d, zero, k)


def simulate_ms(make, data, label):
    t0 = time.perf_counter()
    res = simulate(make(), data, spec=HARD)
    ms = 1000 * (time.perf_counter() - t0) / len(data)
    print(f"  {label:34s} score={res.score:7.3f}  viol={res.violations}  {ms:5.1f} ms/step", flush=True)
    return res.score, ms


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--id", required=True)
    ap.add_argument("--members", nargs="+", required=True, help="arch:tag ...")
    ap.add_argument("--blend", type=float, default=0.5)
    ap.add_argument("--name", default=None)
    ap.add_argument("--co2-mult", type=float, default=1.0, help="co2_mult of the LOCAL hold-out comparison (twin and candidate)")
    a = ap.parse_args()
    archs = sorted({m.split(":")[0] for m in a.members})
    name = a.name or f"{'+'.join(m.replace(':', '-') for m in a.members)}_b{int(round(a.blend * 100)):03d}"
    folder = SUBS / f"{a.id}_{name}"
    if list(SUBS.glob(f"{a.id}_*")) or (PKG / a.id).exists():
        sys.exit(f"id {a.id} already exists under {SUBS} or {PKG}: refusing to overwrite")
    for arch in archs:
        importlib.import_module(f"experiments.nn.archs.{arch}.forward")
        ah.NN_REGISTRY[arch] = sys.modules[f"experiments.nn.archs.{arch}.forward"].NN_REGISTRY[arch]
    scale = C.scale()
    ds = C.load("eval")

    # (i) hold-out agent -----------------------------------------------------------------------------------------
    spec, files = nn_spec(a.members, a.blend, "holdout", scale)
    out = numpy_out(spec, files, ds)
    twin = json.loads(TWIN.read_text(encoding="utf-8"))
    twin.pop("wmult", None)                                  # the true H10 twin has no price-uncertainty planner
    twin.pop("wmult_pow", None)
    twin["co2_mult"] = a.co2_mult
    err = err_nn_table(ds, out, a.blend, np.asarray(twin["err_lgb"]).shape[-1], np.asarray(twin["err_lgb"]).ndim)
    hdir = PKG / a.id / "holdout"
    hdir.mkdir(parents=True)
    (hdir / "nn.json").write_text(json.dumps(spec), encoding="utf-8")
    for n_, p in files.items():
        shutil.copy(p, hdir / n_)
    data = monthly_blocks(load_campus_hourly(hard=True), "last")
    print(f"hold-out simulation ({len(data)} h, co2_mult={a.co2_mult}):")
    s0, ms0 = simulate_ms(lambda: ah.BatteryAgent(model=twin), data, "H10 twin (no NN)")
    s1, ms1 = simulate_ms(lambda: ah.BatteryAgent(model={**twin, "nn": 1, "nn_dir": str(hdir), "err_nn": err.tolist()}),
                          data, f"{a.id} blend {a.blend}")
    (PKG / a.id / "holdout_score.json").write_text(json.dumps({"twin": s0, "candidate": s1, "ms_twin": ms0, "ms_nn": ms1,
                                                                 "blend": a.blend, "members": a.members}), encoding="utf-8")

    # (ii) submission ---------------------------------------------------------------------------------------------
    spec, files = nn_spec(a.members, a.blend, "full", scale)
    folder.mkdir(parents=True)
    src = (ROOT / "agent_hard_nn/agent.py").read_text(encoding="utf-8")
    assert src.count(MARK) == 1
    fw = "\n\n".join((ROOT / f"experiments/nn/archs/{arch}/forward.py").read_text(encoding="utf-8") for arch in archs)
    (folder / "agent.py").write_text(src.replace(MARK, fw), encoding="utf-8")
    model = {**json.loads(FULL.read_text(encoding="utf-8")), "nn": 1, "err_nn": err.tolist()}
    (folder / "model.json").write_text(json.dumps(model), encoding="utf-8")
    for s in C.SERIES:
        shutil.copy(ROOT / f"agent_hard/lgb_{s}.txt", folder / f"lgb_{s}.txt")
    (folder / "nn.json").write_text(json.dumps(spec), encoding="utf-8")
    for n_, p in files.items():
        shutil.copy(p, folder / n_)
    zpath = folder.parent / f"{folder.name}.zip"
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
        for f in sorted(folder.iterdir()):
            z.write(f, f.name)
    probs = ast_scan(folder / "agent.py")
    print("AST scan:", "OK" if not probs else probs)
    chk = subprocess.run([sys.executable, str(ROOT / "starter_kit/check_submission.py"), str(zpath)], capture_output=True,
                         text=True, cwd=ROOT)
    print("official checker:", (chk.stdout + chk.stderr).strip()[-400:])
    cls = load_agent_class(str(folder / "agent.py"))
    print("submission agent on the hold-out weeks (full-mode model: score is NOT a validation):")
    sc, ms = simulate_ms(cls, data, "submission agent.py")
    (folder / "package_info.json").write_text(json.dumps({"ms_step": ms, "ast_ok": not probs, "zip": str(zpath),
                                                           "checker_ok": chk.returncode == 0}), encoding="utf-8")
    print(f"zip: {zpath}  ({zpath.stat().st_size / 1e6:.2f} MB)")


if __name__ == "__main__":
    main()
