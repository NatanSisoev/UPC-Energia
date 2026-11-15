"""Gradient-boosted RESIDUAL forecasters for the Hard Mode agent (experiments only; the agent just loads the boosters).

What is learnt: truth - (linear-corrected forecast of agent_hard/agent.py), one LightGBM per series
(price, co2, load, pv) with the lead as a feature.  Features = agent._lgb_features(): calendar, lead, last-hour weather
(temp ambient / panel, irradiance), days into the week, what the agent has measured this week (f1/f2/f3 of the linear
model), the profile and the linear forecast itself.  The agent's own code builds them, so train == inference.

Protocol (--holdout): the linear model comes from experiments/hard/model_holdout.json (fitted WITHOUT days 15+ of every
month); boosters are fitted on days 1-14 only, profiles are leave-chunk-out exactly like experiments/hard/build_model.py;
`--eval` scores the boosted forecasts on the last 7 days of every month (the hidden-test shape).
Out-of-fold (month-grouped) predictions on the training rows give honest forecast errors, from which the net-load
scenario table `err_lgb` is refitted (in-sample boosted errors would be too small).

Run: python -m experiments.hard.lgb_build --holdout [--rounds 200] [--no-month] [--eval]
     python -m experiments.hard.lgb_build            (final model: fits on all days, writes agent_hard/lgb_*.txt)
"""
import argparse
import json
import time
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.model_selection import GroupKFold

import agent_hard.agent as ah
import experiments.hard.build_model as bm
import experiments.hard.calprof as calprof
from experiments.mpc.arb import load_signals
from experiments.mpc.validate import monthly_blocks
from sim.data import load_campus_hourly
from sim.simulator import HARD, build_obs

ROOT = Path(__file__).resolve().parents[2]
SERIES = ("price", "co2", "load", "pv")
PARAMS = dict(objective="l2", learning_rate=0.05, num_leaves=15, min_data_in_leaf=300, feature_fraction=0.8,
              bagging_fraction=0.7, bagging_freq=1, lambda_l2=10.0, verbose=-1, num_threads=4, seed=1)


# per-series objective / size chosen by month-grouped OOF MAE (robust losses win: errors are heavy-tailed, and the
# scenario table re-adds the error quantiles around the robust central forecast)
SERIES_PARAMS = {"price": dict(objective="huber", alpha=0.02), "co2": dict(objective="huber", alpha=0.008),
                 "load": dict(objective="huber", alpha=100.0, num_leaves=15), "pv": dict(objective="huber", alpha=50.0)}


def _lin_dict(price, co2, load, pv):
    return {"price": price, "co2": co2, "load": load, "pv": pv}


def _step(agent, obs):
    """One agent step without planning: (features, linear forecasts, calendar, known) exactly as the agent builds them."""
    i, n, cal, known = agent._observe(obs)
    f = agent._features(i, 48, cal, known)
    lin = _lin_dict(*agent._forecast(i, 48, cal, known))
    return i, cal, known, f, lin, agent._lgb_features(i, 48, cal, known, f, lin)


def collect_train(df, sig, base_params, profs_for, chunks):
    """Rows of every (step, lead) of the given chunks. Returns dict of arrays (S, 48, ...)."""
    out = {k: [] for k in ("X_price", "X_co2", "X_load", "X_pv", "lin_price", "lin_co2", "lin_load", "lin_pv",
                           "t_price", "t_co2", "t_load", "t_pv", "clear", "known", "month", "chunk")}
    sp, sc = sig["price"].values, sig["co2"].values
    for c in chunks:
        agent = ah.BatteryAgent(model={**base_params, **profs_for(c), "horizon": 48, "lgb": False})
        rows = np.flatnonzero(bm._chunk_of(df.index.day.values) == c)
        for abs_i in rows:
            i, cal, known, f, lin, X = _step(agent, build_obs(df, int(abs_i), HARD.soc_init, HARD))
            exp = pd.date_range(df.index[abs_i], periods=48, freq="h")
            p_df, p_sig = df.index.get_indexer(exp), sig.index.get_indexer(exp)
            for s, vals, pos in (("price", sp, p_sig), ("co2", sc, p_sig),
                                 ("load", df["load_kw"].values, p_df), ("pv", df["pv_kw"].values, p_df)):
                out[f"t_{s}"].append(np.where(pos >= 0, vals[np.maximum(pos, 0)], np.nan))
                out[f"lin_{s}"].append(lin[s])
                out[f"X_{s}"].append(X[s])
            out["clear"].append(cal["clear"][:48])
            out["known"].append(known)
            out["month"].append(df.index[abs_i].month)
            out["chunk"].append(c)
    return {k: np.asarray(v) for k, v in out.items()}


def collect_eval(data, params):
    """Same, over a glued dataframe (the last 7 days of every month) with ONE fresh agent -- the validation shape."""
    agent = ah.BatteryAgent(model={**params, "horizon": 48, "lgb": False})
    out = {k: [] for k in ("X_price", "X_co2", "X_load", "X_pv", "lin_price", "lin_co2", "lin_load", "lin_pv",
                           "t_price", "t_co2", "t_load", "t_pv", "clear", "known")}
    cols = {"price": "precio_eur_per_kwh", "co2": "co2_kg_per_kwh", "load": "load_kw", "pv": "pv_kw"}
    n = len(data)
    for r in range(n):
        i, cal, known, f, lin, X = _step(agent, build_obs(data, r, HARD.soc_init, HARD))
        for s in SERIES:
            t = np.full(48, np.nan)
            seg = data[cols[s]].values[r:r + 48]
            t[:len(seg)] = seg
            out[f"t_{s}"].append(t)
            out[f"lin_{s}"].append(lin[s])
            out[f"X_{s}"].append(X[s])
        out["clear"].append(cal["clear"][:48])
        out["known"].append(known)
    return {k: np.asarray(v) for k, v in out.items()}


def row_mask(d, s):
    """(S, 48) rows that are trained / scored: truth present, lead >= published hours for the market series,
    daylight for pv, no meter outage for load/pv."""
    ok = np.isfinite(d[f"t_{s}"])
    if s in ("price", "co2"):
        ok &= np.arange(48)[None, :] >= d["known"][:, None]
    if s in ("pv", "load"):
        ok &= np.isfinite(d["t_load"]) & (d["t_load"] >= ah.MIN_LOAD_KW)
    if s == "pv":
        ok &= d["clear"] > 1.0
    return ok


def fit_series(d, s, rounds, no_month, folds=4, verbose=True):
    """OOF (month-grouped) residual predictions + final booster. Returns (booster, oof (S, 48))."""
    X = d[f"X_{s}"].copy()
    if no_month:
        X[:, :, 2] = 0.0                                               # column 2 = target month
    y = (d[f"t_{s}"] - d[f"lin_{s}"])
    ok = row_mask(d, s)
    grp = np.broadcast_to(d["month"][:, None], ok.shape)
    Xf, yf, gf = X[ok], y[ok], grp[ok]
    oof = np.zeros(len(yf))
    P = {**PARAMS, **SERIES_PARAMS.get(s, {})}
    for tr, te in GroupKFold(n_splits=folds).split(Xf, yf, gf):
        b = lgb.train(P, lgb.Dataset(Xf[tr], yf[tr]), num_boost_round=rounds)
        oof[te] = b.predict(Xf[te])
    booster = lgb.train(P, lgb.Dataset(Xf, yf), num_boost_round=rounds)
    full = np.zeros(ok.shape)
    full[ok] = oof
    if verbose:
        print(f"  {s:5s} rows {len(yf):7d}  MAE linear {np.mean(np.abs(yf)):.5g} -> OOF boosted "
              f"{np.mean(np.abs(yf - oof)):.5g}  ({100 * (1 - np.mean(np.abs(yf - oof)) / np.mean(np.abs(yf))):.1f}% better)")
    return booster, full


def lead_weights(d, s, oof, smooth=5):
    """Per-lead shrinkage of the boosted residual: least-squares weight of the OOF prediction on the true residual,
    clipped to [0, 1] and smoothed over neighbouring leads. Short leads (where the linear model is already at the
    noise floor) get ~0, long leads ~1."""
    y = d[f"t_{s}"] - d[f"lin_{s}"]
    ok = row_mask(d, s)
    w = np.zeros(48)
    for j in range(48):
        sel = ok[:, j]
        if sel.sum() > 50 and np.sum(oof[sel, j] ** 2) > 0:
            w[j] = np.clip(np.sum(y[sel, j] * oof[sel, j]) / np.sum(oof[sel, j] ** 2), 0.0, 1.0)
    pad = np.concatenate([np.full(smooth // 2, w[0]), w, np.full(smooth // 2, w[-1])])
    return np.convolve(pad, np.ones(smooth) / smooth, mode="valid")


def report(d, pred, label):
    """MAE per lead bucket of linear vs boosted forecasts on a sample set (pred = dict of residual predictions)."""
    print(f"\n{label}: MAE by lead bucket [0,1,2 | 3-5 | 6-11 | 12-23 | 24+]  linear -> boosted")
    b = ah.LEAD_BUCKET[:48]
    for s in SERIES:
        ok = row_mask(d, s)
        e0 = np.abs(d[f"t_{s}"] - d[f"lin_{s}"])
        e1 = np.abs(d[f"t_{s}"] - d[f"lin_{s}"] - pred[s])
        r0, r1 = [], []
        for k in range(7):
            sel = ok & (b[None, :] == k)
            r0.append(e0[sel].mean() if sel.any() else np.nan)
            r1.append(e1[sel].mean() if sel.any() else np.nan)
        fmt = (lambda v: " ".join(f"{x:7.4f}" for x in v)) if s in ("price", "co2") else (lambda v: " ".join(f"{x:7.1f}" for x in v))
        print(f"  {s:5s} {fmt(r0)}  ->  {fmt(r1)}")


def err_table(d, pred, k):
    """Net-load error quantiles (lead bucket x clear-sky bin) of the BOOSTED forecasts."""
    load_hat = np.maximum(d["lin_load"] + pred["load"], 0.0)
    pv_hat = np.clip(d["lin_pv"] + pred["pv"], 0.0, 1.15 * d["clear"])
    ok = np.isfinite(d["t_load"]) & np.isfinite(d["t_pv"]) & (d["t_load"] >= ah.MIN_LOAD_KW)
    smp = {"load": {"truth": np.where(ok, d["t_load"], np.nan)}, "pv": {"truth": np.where(ok, d["t_pv"], np.nan),
                                                                         "lead_clear": d["clear"]}}
    return bm.fit_errors(smp, load_hat, pv_hat, k, verbose=False)


def err_table4(d, pred, k):
    """Like err_table, additionally split by daypart (night/work hours/evening) x working day: [7][5][6][K]."""
    load_hat = np.maximum(d["lin_load"] + pred["load"], 0.0)
    pv_hat = np.clip(d["lin_pv"] + pred["pv"], 0.0, 1.15 * d["clear"])
    ok = np.isfinite(d["t_load"]) & np.isfinite(d["t_pv"]) & (d["t_load"] >= ah.MIN_LOAD_KW)
    err = np.where(ok, (d["t_load"] - d["t_pv"]) - (load_hat - pv_hat), np.nan)
    b = np.broadcast_to(ah.LEAD_BUCKET[:48], err.shape)
    c = np.searchsorted(ah.CS_BINS, d["clear"])
    ctx = ah.DAYPART[d["X_load"][:, :, 1].astype(int)] * 2 + (d["X_load"][:, :, 3] > 0)
    qs = (np.arange(k) + 0.5) / k
    table = np.zeros((7, 5, 6, k))
    for bk in range(7):
        for col in range(5):
            for cx in range(6):
                for sel in ((b == bk) & (c == col) & (ctx == cx) & ok, (b == bk) & (c == col) & ok, (b == bk) & ok, ok):
                    if sel.sum() >= bm.MIN_FIT * 4:                    # fall back to coarser pools when sparse
                        table[bk, col, cx] = np.quantile(err[sel], qs)
                        break
    return table


def wmult_table(d, oof, lin, m_scen):
    """Relative error scenarios of the score weight w = k_co2*co2 + k_cost*price, by lead bucket (planner: _value).
    Quantiles of true w / forecast w (boosted out-of-fold forecasts); published hours are certain (ones)."""
    run = 2016
    kc = 0.7 / (run * np.nanmean(np.asarray(lin["co2_rate"], float)))
    kp = 0.3 / (run * np.nanmean(np.asarray(lin["cost_rate"], float)))
    p_hat = np.maximum(d["lin_price"] + oof["price"], 0.0)
    c_hat = np.maximum(d["lin_co2"] + oof["co2"], 0.0)
    w_hat, w_true = kc * c_hat + kp * p_hat, kc * d["t_co2"] + kp * d["t_price"]
    ok = np.isfinite(w_true) & (w_hat > 0) & (np.arange(48)[None, :] >= d["known"][:, None])
    ratio = np.where(ok, w_true / np.maximum(w_hat, 1e-12), np.nan)
    b = np.broadcast_to(ah.LEAD_BUCKET[:48], ratio.shape)
    qs = (np.arange(m_scen) + 0.5) / m_scen
    table = np.ones((7, m_scen))
    for bk in range(3, 7):
        v = ratio[(b == bk) & ok]
        table[bk] = np.quantile(v, qs)
    return table


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--holdout", action="store_true")
    ap.add_argument("--rounds", type=int, default=200)
    ap.add_argument("--no-month", action="store_true", help="make the booster blind to the month (unseen November)")
    ap.add_argument("--eval", action="store_true", help="MAE on the last 7 days of every month (holdout only)")
    ap.add_argument("--k", type=int, default=7)
    ap.add_argument("--wm", type=int, default=7, help="price-error scenarios of the planner (0: none)")
    ap.add_argument("--wpow", type=float, default=2.0, help="exponent applied to the fitted multipliers (widens them)")
    ap.add_argument("--calendar", action="store_true", help="published calendar: holidays, UPC closures (day_info)")
    ap.add_argument("--err4", action="store_true", help="scenario table split by daypart x working day")
    ap.add_argument("--leaves", type=int, default=None)
    ap.add_argument("--min-leaf", type=int, default=None)
    ap.add_argument("--lr", type=float, default=None)
    ap.add_argument("--tag", default=None, help="output folder suffix (holdout runs)")
    a = ap.parse_args()
    if a.leaves:
        PARAMS["num_leaves"] = a.leaves
    if a.min_leaf:
        PARAMS["min_data_in_leaf"] = a.min_leaf
    if a.lr:
        PARAMS["learning_rate"] = a.lr

    t0 = time.perf_counter()
    lin_path = ROOT / ("experiments/hard/model_holdout.json" if a.holdout else "agent_hard/model_linear.json")
    if not a.holdout and not lin_path.exists():
        lin_path = ROOT / "agent_hard/model.json"
    lin = json.loads(lin_path.read_text(encoding="utf-8"))
    df = load_campus_hourly(hard=True)
    sig = load_signals()

    # profiles per leave-chunk-out variant, as build_model.build_params does (same data selection as the linear fit)
    month_df, chunk_df = df.index.month.values - 1, bm._chunk_of(df.index.day.values)
    chunk_sig = bm._chunk_of(sig.index.day.values)
    allowed_df = chunk_df < 2 if a.holdout else np.ones(len(df), bool)
    allowed_sig = chunk_sig < 2 if a.holdout else np.ones(len(sig), bool)
    haze, sun, clear = bm.fit_sun(df, verbose=False)
    dt_load = bm._daytypes(df.index, bm.HOLIDAYS, True)
    dt_sig = bm._daytypes(sig.index, bm.HOLIDAYS, False)
    profs = {}
    for c in bm.CHUNKS:
        use_df, use_sig = allowed_df & (chunk_df != c), allowed_sig & (chunk_sig != c)
        kb = bm.monthly_kbar(df["pv_kw"].values, clear, use_df, month_df)
        kb[10] = np.nanmean([kb[9], kb[11]])
        profs[c] = dict(
            load_prof=bm._fill_gaps(bm.fit_profiles(df["load_kw"].values, df.index, dt_load, use_df)),
            price_prof=bm._fill_gaps(bm.fit_profiles(sig["price"].values, sig.index, dt_sig, use_sig)),
            co2_prof=bm._fill_gaps(bm.fit_profiles(sig["co2"].values, sig.index, dt_sig, use_sig)), kbar=kb)
    final_prof = None
    if a.calendar:                                                     # profiles on the calendar's day types
        for c in bm.CHUNKS:
            use_df, use_sig = allowed_df & (chunk_df != c), allowed_sig & (chunk_sig != c)
            profs[c] = {**calprof.make_profiles(df, sig, use_df, use_sig), "kbar": profs[c]["kbar"]}
        final_prof = calprof.make_profiles(df, sig, allowed_df, allowed_sig)
    base_params = {k: lin[k] for k in ("sun", "haze", "co2_rate", "cost_rate", "coef", "holidays", "err", "terminal_value")}
    base_params.update(spread_scale=0.0, spread_mode="lead", calendar=int(a.calendar))
    chunks = (0, 1) if a.holdout else bm.CHUNKS
    d = collect_train(df, sig, base_params, lambda c: profs[c], chunks)
    print(f"collected {len(d['month'])} steps x 48 leads in {time.perf_counter() - t0:.0f}s")

    boosters, oof, weights = {}, {}, {}
    for s in SERIES:
        boosters[s], oof[s] = fit_series(d, s, a.rounds, a.no_month)
        weights[s] = lead_weights(d, s, oof[s])
        oof[s] = oof[s] * weights[s][None, :]
    report(d, oof, "training rows, month-grouped OOF, after per-lead shrinkage")
    err = err_table4(d, oof, a.k) if a.err4 else err_table(d, oof, a.k)

    out_dir = (ROOT / "experiments/hard" / ("lgb_holdout" + (f"_{a.tag}" if a.tag else ""))) if a.holdout else ROOT / "agent_hard"
    out_dir.mkdir(exist_ok=True)
    for s in SERIES:
        (out_dir / f"lgb_{s}.txt").write_text(boosters[s].model_to_string(), encoding="utf-8")
    model = {**lin, **(bm._jsonable(final_prof) if final_prof else {}), "calendar": int(a.calendar), "lgb": True, **({"wmult": wmult_table(d, oof, lin, a.wm).tolist(), "wmult_pow": a.wpow} if a.wm else {}), "err_lgb": err.tolist(), "lgb_w": {k: v.tolist() for k, v in weights.items()}}
    if a.holdout:
        model["lgb_dir"] = str(out_dir)
    json_path = (ROOT / "experiments/hard" / f"model_holdout_lgb{'_' + a.tag if a.tag else ''}.json") if a.holdout \
        else ROOT / "agent_hard/model_lgb.json"
    json_path.write_text(json.dumps(model), encoding="utf-8")
    print(f"wrote {json_path} and {out_dir}/lgb_*.txt")

    if a.eval and a.holdout:
        data = monthly_blocks(df, "last")
        ev = collect_eval(data, {**lin, **(bm._jsonable(final_prof) if final_prof else {}), "calendar": int(a.calendar)})
        # evaluation uses the boosters fitted on the whole training set (no OOF needed: these days were never seen)
        pred = {}
        for s in SERIES:
            X = ev[f"X_{s}"].copy()
            if a.no_month:
                X[:, :, 2] = 0.0
            pred[s] = boosters[s].predict(X.reshape(-1, X.shape[-1])).reshape(X.shape[:2]) * weights[s][None, :]
            if s in ("price", "co2"):
                pred[s][:, :] = np.where(np.arange(48)[None, :] >= ev["known"][:, None], pred[s], 0.0)
        report(ev, pred, "HOLD-OUT (last 7 days of every month)")
    print(f"done in {time.perf_counter() - t0:.0f}s")


if __name__ == "__main__":
    main()
