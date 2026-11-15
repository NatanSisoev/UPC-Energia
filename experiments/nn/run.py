"""Train one architecture: PYTHONPATH=. .venv/Scripts/python -m experiments.nn.run --arch mlp --tag base --mode holdout|full [--seeds 3]
-> experiments/nn/runs/<arch>_<tag>/<mode>/{weights_s<seed>.npz, metrics.json}. Full mode reuses the epochs chosen in holdout mode."""
import argparse
import importlib
import json
from pathlib import Path

import numpy as np

from experiments.nn import common as C

RUNS = Path(__file__).resolve().parent / "runs"


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--arch", required=True)
    ap.add_argument("--tag", required=True)
    ap.add_argument("--mode", choices=("holdout", "full"), required=True)
    ap.add_argument("--seeds", type=int, default=3)
    ap.add_argument("--blend", type=float, default=0.5, help="blend used for the report column 'blend'")
    a = ap.parse_args()
    model_mod = importlib.import_module(f"experiments.nn.archs.{a.arch}.model")
    fwd_mod = importlib.import_module(f"experiments.nn.archs.{a.arch}.forward")
    cfg = model_mod.CONFIGS[a.tag]
    out = RUNS / f"{a.arch}_{a.tag}" / a.mode
    out.mkdir(parents=True, exist_ok=True)
    epochs = None
    if a.mode == "full":
        epochs = json.loads((RUNS / f"{a.arch}_{a.tag}" / "holdout" / "metrics.json").read_text())["epochs"]
    print(f"{a.arch}:{a.tag} {a.mode} cfg={cfg}")
    models, info = C.train(model_mod.build, cfg, a.mode, a.seeds, epochs)
    fwd = fwd_mod.NN_REGISTRY[a.arch]
    par = max(C.parity(fwd, m, 200, cfg) for m in models)
    for s, m in enumerate(models):
        C.export(m, out / f"weights_s{s}.npz")
    metrics = {"arch": a.arch, "tag": a.tag, "mode": a.mode, "cfg": cfg, "seeds": a.seeds, **info, "parity_max_abs": par}
    print(f"parity max |numpy - torch| = {par:.2e}   training {info['train_s']}s")
    if a.mode == "holdout":                                       # score on the hold-out weeks: mean of the seeds' corrections
        pred = np.mean([C.predict(m, C.load("eval")) for m in models], axis=0)
        metrics["report"] = C.report(pred, a.blend)
        metrics["blend"] = a.blend
    (out / "metrics.json").write_text(json.dumps(metrics, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
