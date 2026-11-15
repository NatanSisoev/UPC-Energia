"""Shared pieces of the neural-forecaster scaffold: data loading, masked Huber loss, training protocol, report, export, parity.
See experiments/nn/README.md. Series order everywhere: price, co2, load, pv."""
import json
import time
from pathlib import Path

import numpy as np
import torch

torch.set_num_threads(4)                                   # other agents share this machine

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data" / "nn"
SERIES = ("price", "co2", "load", "pv")
VAL_MONTHS = (2, 6, 10)                                    # calendar months held out for early stopping (all their blocks)
BUCKETS = (("0-2", 0, 3), ("3-11", 3, 12), ("12-23", 12, 24))


def scale():
    return json.loads((DATA / "scale.json").read_text(encoding="utf-8"))


def load(name):
    """name in eval / holdout / full -> dict of numpy arrays (data/nn/ds_<name>.npz)."""
    z = np.load(DATA / f"ds_{name}.npz")
    return {k: z[k] for k in z.files}


def dims(ds):
    return {"L": ds["hist"].shape[1], "C": ds["hist"].shape[2], "H": ds["fut"].shape[1], "F": ds["fut"].shape[2],
            "S": ds["stat"].shape[1]}


def huber(pred, y, delta=1.0):
    """Masked Huber loss: y is NaN where the target is not a real forecast target."""
    m = torch.isfinite(y)
    e = torch.where(m, pred - torch.nan_to_num(y), torch.zeros_like(pred)).abs()
    l = torch.where(e < delta, 0.5 * e * e, delta * (e - 0.5 * delta))
    return (l * m).sum() / m.sum().clamp(min=1)


def _tensors(ds, idx):
    return [torch.from_numpy(ds[k][idx]) for k in ("hist", "fut", "stat", "y")]


def _predict(model, ds, bs=512):
    model.eval()
    out = []
    with torch.no_grad():
        for s in range(0, len(ds["y"]), bs):
            h, f, st = (torch.from_numpy(ds[k][s:s + bs]) for k in ("hist", "fut", "stat"))
            out.append(model(h, f, st).numpy())
    return np.concatenate(out)


predict = _predict


def _fit(build_fn, cfg, d, tr, va, epochs, seed, log):
    """Trains on rows `tr`; with `va` (indices) tracks the validation loss. Returns (model, best_epoch, curve)."""
    torch.manual_seed(seed)
    np.random.seed(seed)
    model = build_fn(cfg, d)
    model.cfg = cfg
    opt = torch.optim.AdamW(model.parameters(), lr=cfg.get("lr", 1e-3), weight_decay=cfg.get("wd", 1e-2))
    hist, fut, stat, y = _tensors(DS, tr)
    vh = _tensors(DS, va) if va is not None else None
    bs, best, best_ep, curve = cfg.get("batch", 128), (float("inf")), 0, []
    for ep in range(1, epochs + 1):
        model.train()
        perm = torch.randperm(len(y))
        for s in range(0, len(y), bs):
            b = perm[s:s + bs]
            opt.zero_grad()
            loss = huber(model(hist[b], fut[b], stat[b]), y[b])
            loss.backward()
            opt.step()
        if vh is not None:
            model.eval()
            with torch.no_grad():
                v = float(huber(model(*vh[:3]), vh[3]))
            curve.append(v)
            if v < best:
                best, best_ep = v, ep
            if ep - best_ep >= cfg.get("patience", 8):
                break
    return model, best_ep, curve


DS = None


def train(build_fn, cfg, mode, seeds, epochs=None, log=print):
    """mode "holdout" (ds_holdout) or "full" (ds_full).
    holdout: per seed, early stopping on the validation MONTHS (VAL_MONTHS, all their blocks) -> best epoch count, then a
    refit on ALL months for that many epochs. full: refit on ds_full for `epochs` (the list chosen in holdout mode).
    Returns (models, info) with info = {"epochs": [...], "val_loss": [...], "train_s": seconds}."""
    global DS
    DS = load(mode)
    d = dims(DS)
    t0 = time.perf_counter()
    allr = np.arange(len(DS["y"]))
    isval = np.isin(DS["month"], VAL_MONTHS)
    models, chosen, vals = [], [], []
    for k, seed in enumerate(range(seeds)):
        if mode == "holdout":
            _, ep, curve = _fit(build_fn, cfg, d, allr[~isval], allr[isval], cfg.get("max_epochs", 60), seed, log)
            ep = max(ep, 1)
            vals.append(min(curve))
            log(f"  seed {seed}: best epoch {ep}/{len(curve)}  val loss {min(curve):.4f} (epoch 1: {curve[0]:.4f})")
        else:
            ep = int(epochs[k % len(epochs)])
        model, _, _ = _fit(build_fn, cfg, d, allr, None, ep, seed, log)
        models.append(model)
        chosen.append(ep)
    return models, {"epochs": chosen, "val_loss": vals, "train_s": round(time.perf_counter() - t0, 1)}


# ------------------------------------------------------------------ evaluation
def blend_forecast(ds, out, blend, sc=None):
    """numpy mirror of agent_hard_nn.BatteryAgent._nn_apply over a dataset: final = lin + (1-b)(lgb-lin) + b*scale*out.
    blend: scalar or 24-vector (or None -> the neural forecast alone = 1.0). Returns (N,4,24). Needs ds['lgb'] unless blend==1."""
    sc = sc or scale()
    s_ = np.array([sc[s] for s in SERIES])[None, :, None]
    lin = ds["lin"].astype(float)
    lgb = ds["lgb"].astype(float) if "lgb" in ds else lin
    b = np.broadcast_to(np.asarray(1.0 if blend is None else blend, dtype=float), lin.shape[1:]) if np.ndim(blend) else blend
    x = lin + (1 - b) * (lgb - lin) + b * s_ * out
    lead = np.arange(lin.shape[2])[None, None, :]
    pub = (lead < ds["known"][:, None, None]) & (np.arange(4)[None, :, None] < 2)
    x = np.where(pub, lin, x)                                    # published market hours stay as they are
    x[:, :2] = np.maximum(x[:, :2], 0.0)
    x[:, 2] = np.maximum(x[:, 2], 0.0)
    x[:, 3] = np.clip(x[:, 3], 0.0, 1.15 * ds["fut"][:, :, FUT_CLEAR] * 1700.0)
    return x


FUT_CLEAR = 10                                              # column of clear/1700 in fut (see README)


def mae_table(ds, nn_out, blend=0.5):
    """{series: {bucket: {variant: MAE}}}, variants lin / lgb / nn / blend, over rows where y is finite; the market series
    only count leads >= known (y is NaN before). 'net' = load - pv."""
    forecasts = {"lin": ds["lin"].astype(float), "lgb": ds["lgb"].astype(float),
                 "nn": blend_forecast(ds, nn_out, 1.0), "blend": blend_forecast(ds, nn_out, blend)}
    out = {}
    for k, s in enumerate(SERIES + ("net",)):
        out[s] = {}
        for name, a, b in BUCKETS:
            if s == "net":
                ok = np.isfinite(ds["y"][:, 2, a:b]) & np.isfinite(ds["truth"][:, 3, a:b])
                t = ds["truth"][:, 2, a:b] - ds["truth"][:, 3, a:b]
                err = {v: np.abs(t - (f[:, 2, a:b] - f[:, 3, a:b])) for v, f in forecasts.items()}
            else:
                ok = np.isfinite(ds["y"][:, k, a:b])
                err = {v: np.abs(ds["truth"][:, k, a:b] - f[:, k, a:b]) for v, f in forecasts.items()}
            out[s][name] = {v: (float(e[ok].mean()) if ok.any() else None) for v, e in err.items()}
    return out


def report(pred, blend=0.5, log=print):
    """pred = (N,4,24) neural corrections in scaled units on ds_eval. Prints and returns the MAE table."""
    ds = load("eval")
    tab = mae_table(ds, pred, blend)
    log(f"MAE on ds_eval (hold-out weeks); blend={blend}")
    log(f"{'series':6s} {'leads':6s} {'lin':>9s} {'lin+LGB':>9s} {'lin+NN':>9s} {'blend':>9s}")
    for s, d in tab.items():
        for name, v in d.items():
            if v["lin"] is not None:
                log(f"{s:6s} {name:6s} {v['lin']:9.4f} {v['lgb']:9.4f} {v['nn']:9.4f} {v['blend']:9.4f}")
    return tab


# ------------------------------------------------------------------ export / parity
def export(model, path):
    """float32 numpy arrays keyed by state_dict names."""
    np.savez(path, **{k: v.detach().cpu().numpy().astype(np.float32) for k, v in model.state_dict().items()})


def parity(forward_fn, torch_model, n=200, cfg=None):
    """max |numpy forward - torch forward| over n evenly spaced ds_eval rows (must be < 1e-4)."""
    ds = load("eval")
    idx = np.linspace(0, len(ds["y"]) - 1, n).astype(int)
    cfg = cfg if cfg is not None else getattr(torch_model, "cfg", {})
    torch_model.eval()
    with torch.no_grad():
        ref = torch_model(*(torch.from_numpy(ds[k][idx]) for k in ("hist", "fut", "stat"))).numpy()
    W = {k: v.detach().cpu().numpy().astype(np.float32) for k, v in torch_model.state_dict().items()}
    got = np.array([forward_fn(W, ds["hist"][j], ds["fut"][j], ds["stat"][j], cfg) for j in idx])
    return float(np.max(np.abs(got - ref)))
