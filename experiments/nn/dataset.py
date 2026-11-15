"""Training / evaluation sets of the neural forecasters, built by RUNNING agent_hard_nn's own code
(_observe -> _features -> linear forecast -> _nn_features) over pseudo-weeks, so train and inference features are identical.

  ds_eval.npz     the hold-out weeks (last 168 rows of every month of data/train) with the hold-out twin parameters of
                  H10 (experiments/hard/model_holdout_lgb_cal.json); one fresh agent over the glued run, like the test.
                  Also stores the LightGBM-corrected forecasts of every row ("lgb").
  ds_holdout.npz  rows of 7-day pseudo-weeks (a new one every 2 days, fresh agent state at each start) built ONLY from the
                  rows BEFORE the hold-out week of each month, hold-out parameters.
  ds_full.npz     the same over all train days, full parameters (agent_hard/model_lgb.json).
Profiles / clear-sky clearness of a pseudo-week are fitted WITHOUT that block (leave-BLOCK-out: exact days of the block
are dropped, one profile fit per block). The linear (ridge) coefficients are the model's (fitted on days <= 14).
Scale: scale.json = std(truth - lin) per series over ds_holdout (pass 1 runs without features, pass 2 builds them).
November has price/CO2 but no campus rows (no load/solar): it has no pseudo-weeks, exactly as in experiments/hard/lgb_build.py.

Run: PYTHONPATH=. .venv/Scripts/python -m experiments.nn.dataset [--which eval holdout full] [--rescale]
Arrays: hist [N,96,11] fut [N,24,F] stat [N,S] y [N,4,24] lin truth (and lgb for eval) [N,4,24]; known, month, block,
step (step in block), ts (timestamp string). Series order everywhere: price, co2, load, pv."""
import argparse
import json
import time
from pathlib import Path

import numpy as np
import pandas as pd

import agent_hard_nn.agent as ah
import experiments.hard.build_model as bm
import experiments.hard.calprof as calprof
from experiments.mpc.arb import load_signals
from experiments.mpc.validate import monthly_blocks
from sim.data import load_campus_hourly
from sim.simulator import HARD, build_obs

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "nn"
TWIN = ROOT / "experiments/hard/model_holdout_lgb_cal.json"
FULL = ROOT / "agent_hard/model_lgb.json"
SERIES = ("price", "co2", "load", "pv")
BLOCK, STRIDE, H = 168, 48, 24
KEYS = ("sun", "haze", "co2_rate", "cost_rate", "coef", "holidays", "err", "terminal_value")


def load_scale():
    return json.loads((OUT / "scale.json").read_text(encoding="utf-8"))


def mask_y(truth, lin, known, clear, scale=None):
    """y = (truth - lin) / scale with NaN where the target is not a real forecast target:
    missing truth, market leads inside the published window, meter outage (load < MIN_LOAD_KW), pv at night."""
    ok = np.isfinite(truth)
    for r in (0, 1):
        ok[:, r] &= np.arange(H)[None, :] >= known[:, None]
    good = np.isfinite(truth[:, 2]) & (truth[:, 2] >= ah.MIN_LOAD_KW)
    ok[:, 2] &= good
    ok[:, 3] &= good & (clear > 1.0)
    y = np.where(ok, truth - lin, np.nan)
    if scale is not None:
        y = y / np.array([scale[s] for s in SERIES])[None, :, None]
    return y.astype(np.float32)


def holdout_start(df):
    """{(year, month): timestamp of the first hour of that month's hold-out week} (last 168 rows of the month)."""
    return {k: g.index[-BLOCK] for k, g in df.groupby([df.index.year, df.index.month]) if len(g) >= BLOCK}


def blocks_of(df, allowed):
    """Pseudo-weeks: per month, consecutive runs of 168 allowed rows starting every 48 rows. -> list of (month, rows)."""
    out = []
    for _, g in pd.Series(np.arange(len(df)), index=df.index)[allowed].groupby([df.index[allowed].year, df.index[allowed].month]):
        pos = g.values
        for s in range(0, len(pos) - BLOCK + 1, STRIDE):
            out.append((int(df.index[pos[s]].month), pos[s:s + BLOCK]))
    return out


class Rows:
    """Accumulator of dataset rows."""
    keys = ("hist", "fut", "stat", "y", "lin", "truth", "lgb", "known", "month", "block", "step", "ts")

    def __init__(self):
        self.d = {k: [] for k in self.keys}

    def add(self, **kw):
        for k, v in kw.items():
            self.d[k].append(v)

    def save(self, path):
        out = {}
        for k, v in self.d.items():
            if not v:
                continue
            a = np.asarray(v)
            out[k] = a.astype(np.float32) if a.dtype.kind == "f" else a
        np.savez(path, **out)


def step_row(agent, obs, with_feat):
    """One agent step (no planning). Returns (i, n, cal, known, f, lin padded, lgb-or-lin forecast padded, features)."""
    i, n, cal, known = agent._observe(obs)
    res = agent._forecast(i, n, cal, known)                            # lgb-corrected when the agent has boosters
    f, lin = agent._last_fc
    fin = agent._pad_lin(dict(zip(SERIES, res)), i)
    feats = agent._nn_features(i, cal, known, f, lin) if with_feat else None
    return i, cal, known, agent._pad_lin(lin, i), fin, feats, f


def arr(d):
    return np.array([d[s] for s in SERIES])


def collect_blocks(df, sig, params, blocks, allowed_df, allowed_sig, profs_for, scale, with_feat):
    """Rows of the pseudo-weeks. profs_for(rows) -> leave-block-out profile dict."""
    rows = Rows()
    sp, sc = sig["price"].values, sig["co2"].values
    for bid, (month, pos) in enumerate(blocks):
        agent = ah.BatteryAgent(model={**params, **profs_for(pos), "horizon": 24, "lgb": False, "nn": 0})
        agent.nn_scale = scale
        for r in pos:
            i, cal, known, lin, _, feats, _f = step_row(agent, build_obs(df, int(r), HARD.soc_init, HARD), with_feat)
            exp = pd.date_range(df.index[r], periods=H, freq="h")
            p_df, p_sig = df.index.get_indexer(exp), sig.index.get_indexer(exp)
            ok_df = (p_df >= 0) & allowed_df[np.maximum(p_df, 0)]
            ok_sig = (p_sig >= 0) & allowed_sig[np.maximum(p_sig, 0)]
            truth = np.array([np.where(ok_sig, sp[np.maximum(p_sig, 0)], np.nan), np.where(ok_sig, sc[np.maximum(p_sig, 0)], np.nan),
                              np.where(ok_df, df["load_kw"].values[np.maximum(p_df, 0)], np.nan),
                              np.where(ok_df, df["pv_kw"].values[np.maximum(p_df, 0)], np.nan)])
            linm = arr(lin)
            kw = {}
            if with_feat:
                kw = dict(hist=feats[0], fut=feats[1], stat=feats[2])
            rows.add(y=mask_y(truth[None], linm[None], np.array([known]), cal["clear"][None, :H], scale)[0], lin=linm, truth=truth,
                     known=known, month=month, block=bid, step=i, ts=str(df.index[r]), **kw)
    return rows


def collect_eval(data, params, scale):
    """The hold-out run: one fresh agent over the glued hold-out weeks (the shape of the hidden test)."""
    agent = ah.BatteryAgent(model={**params, "horizon": 24, "nn": 0})
    agent.nn_scale = scale
    rows = Rows()
    cols = {"price": "precio_eur_per_kwh", "co2": "co2_kg_per_kwh", "load": "load_kw", "pv": "pv_kw"}
    for r in range(len(data)):
        i, cal, known, lin, fin, feats, _f = step_row(agent, build_obs(data, r, HARD.soc_init, HARD), True)
        truth = np.full((4, H), np.nan)
        for k, s in enumerate(SERIES):
            seg = data[cols[s]].values[r:r + H]
            truth[k, :len(seg)] = seg
        linm = arr(lin)
        rows.add(hist=feats[0], fut=feats[1], stat=feats[2], lin=linm, lgb=arr(fin), truth=truth, known=known,
                 y=mask_y(truth[None], linm[None], np.array([known]), cal["clear"][None, :H], scale)[0],
                 month=int(data.index[r].month), block=int(r // BLOCK), step=r % BLOCK, ts=str(data.index[r]))
    return rows


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--which", nargs="+", default=["eval", "holdout", "full"], choices=["eval", "holdout", "full"])
    ap.add_argument("--rescale", action="store_true", help="recompute scale.json")
    a = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    t0 = time.perf_counter()
    df, sig = load_campus_hourly(hard=True), load_signals()
    twin, full = (json.loads(p.read_text(encoding="utf-8")) for p in (TWIN, FULL))
    haze, sun, clear = bm.fit_sun(df, verbose=False)
    month_df = df.index.month.values - 1
    hs = holdout_start(df)

    def allowed(idx, holdout):
        if not holdout:
            return np.ones(len(idx), bool)
        start = np.array([hs.get((t.year, t.month)) for t in idx], dtype=object)
        cut = np.array([(t < s) if s is not None else (t.day <= 14) for t, s in zip(idx, start)])
        return cut

    def make_profs(params, allow_df, allow_sig):
        """leave-block-out profile function: drops the exact span of the block from the fit data."""
        cache = {}

        def profs_for(pos):
            key = (int(pos[0]), int(pos[-1]))
            if key not in cache:
                lo, hi = df.index[pos[0]], df.index[pos[-1]]
                use_df = allow_df & ~((df.index >= lo) & (df.index <= hi))
                use_sig = allow_sig & ~((sig.index >= lo) & (sig.index <= hi))
                kb = bm.monthly_kbar(df["pv_kw"].values, clear, use_df, month_df)
                kb[10] = np.nanmean([kb[9], kb[11]])
                cache[key] = {**calprof.make_profiles(df, sig, use_df, use_sig), "kbar": kb}
                cache[key] = bm._jsonable(cache[key])
            return cache[key]
        return profs_for

    def base(params):
        return {**{k: params[k] for k in KEYS}, "spread_scale": 0.0, "spread_mode": "lead", "calendar": 1}

    ah_h, ah_s = allowed(df.index, True), allowed(sig.index, True)
    blocks_h = blocks_of(df, ah_h)
    print(f"hold-out pseudo-weeks: {len(blocks_h)}  ({sum(len(p) for _, p in blocks_h)} rows)", flush=True)

    scale_path = OUT / "scale.json"
    if a.rescale or not scale_path.exists():                           # pass 1: lin / truth only, provisional scale 1
        rows = collect_blocks(df, sig, base(twin), blocks_h, ah_h, ah_s, make_profs(twin, ah_h, ah_s),
                              {s: 1.0 for s in SERIES}, False)
        y = np.array(rows.d["truth"]) - np.array(rows.d["lin"])
        yy = np.array(rows.d["y"]) * 1.0                                # mask only (scale 1)
        scale = {s: float(np.nanstd(yy[:, k])) for k, s in enumerate(SERIES)}
        scale_path.write_text(json.dumps(scale, indent=1), encoding="utf-8")
        print("scale (std of truth - lin, ds_holdout):", scale, f"[{time.perf_counter() - t0:.0f}s]", flush=True)
    scale = load_scale()

    if "eval" in a.which:
        data = monthly_blocks(df, "last")
        collect_eval(data, {**twin, "calendar": 1}, scale).save(OUT / "ds_eval.npz")
        print(f"ds_eval done [{time.perf_counter() - t0:.0f}s]", flush=True)
    if "holdout" in a.which:
        collect_blocks(df, sig, base(twin), blocks_h, ah_h, ah_s, make_profs(twin, ah_h, ah_s), scale, True) \
            .save(OUT / "ds_holdout.npz")
        print(f"ds_holdout done [{time.perf_counter() - t0:.0f}s]", flush=True)
    if "full" in a.which:
        af_d, af_s = allowed(df.index, False), allowed(sig.index, False)
        blocks_f = blocks_of(df, af_d)
        print(f"full pseudo-weeks: {len(blocks_f)}", flush=True)
        collect_blocks(df, sig, base(full), blocks_f, af_d, af_s, make_profs(full, af_d, af_s), scale, True) \
            .save(OUT / "ds_full.npz")
        print(f"ds_full done [{time.perf_counter() - t0:.0f}s]", flush=True)


if __name__ == "__main__":
    main()
