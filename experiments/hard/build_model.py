"""Fit the Hard Mode agent's parameters (agent_hard/model.json) -- experiments only, never imported by the agent.

Everything the Hard Mode forecaster needs (docs/HARD_MODE_HANDOFF.md sections 4 and 5.1):

  * month x day-type x hour profiles of price, CO2 and campus load.  Weekend cells (2-4 days) are shrunk
    towards "month working-day profile x all-month day-type ratio" with a prior weight of 2 days.  November
    has price/CO2 but no load/solar: its load profile = October/December mean.  Profiles are computed
    LEAVING OUT the 7-day chunk that is being forecast, so the corrections are fitted against profiles of
    honest quality (otherwise they learn to over-trust the profile).
  * clear-sky solar: the agent's own sun-position basis x 3 coefficients, fitted as a tau = 0.97 expectile
    upper envelope (IRLS + NNLS) for a small grid of haze values; monthly mean clearness kbar.
  * linear corrections of the profiles from what the agent can measure in the current week: ridge per lead
    and per feature set (A = day-old residual available, B = not), fitted on features produced by the
    agent's own _features() code -- train/inference consistency is guaranteed by construction.
  * net-load forecast-error quantiles by lead bucket x clear-sky bin (the planner's scenarios), K per cell.

Samples are collected by running the agent itself over every (month, chunk) with leave-chunk-out parameters.
Chunks: days 1-7, 8-14, 15-end of each month.  --holdout additionally drops chunk 3 (days 15+) from EVERY
fit, so the model can be validated on the last 7 train days of each month (the hidden-test shape).

Run:  .venv/Scripts/python -m experiments.hard.build_model [--holdout] [--out path]
                                                   [--k 7] [--spread-scale 1.0] [--spread-mode lead] [--tv 0.0]
"""
import json
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.optimize import nnls

import agent_hard.agent as ah
from experiments.mpc.arb import load_signals
from sim.data import load_campus_hourly
from sim.simulator import HARD, build_obs

ROOT = Path(__file__).resolve().parents[2]
TAU = 0.97                     # expectile of the clear-sky envelope (slightly above q95)
RIDGE_ALPHA = 0.02             # ridge shrinkage relative to the feature scale (n >> p, only tames collinearity)
HAZE_GRID = (0.0, 0.05, 0.10, 0.15, 0.20, 0.25, 0.30)
IRLS_STEPS = 40
MIN_FIT = 30                   # a ridge fit with fewer samples falls back to the pure profile
SERIES = ("price", "co2", "load", "pv")
CHUNKS = (0, 1, 2)             # days 1-7 / 8-14 / 15-end of each month

HOLIDAYS = ["2025-09-11", "2025-09-24", "2025-10-12", "2025-11-01", "2025-12-06", "2025-12-08"]
HOLIDAYS += [f"2025-12-{d:02d}" for d in range(24, 32)]
HOLIDAYS += [f"2026-01-{d:02d}" for d in range(1, 7)]
HOLIDAYS += ["2026-04-03", "2026-04-06", "2026-05-01", "2026-05-25", "2026-06-24", "2026-08-15"]


def _chunk_of(days):
    return np.where(days <= 7, 0, np.where(days <= 14, 1, 2))


def _daytypes(index, holidays, load_mode):
    """0 working day / 1 Saturday / 2 Sunday; in load_mode holidays count as 2."""
    wd = index.day_of_week.values
    dt = np.where(wd < 5, 0, wd - 4).astype(int)
    if load_mode:
        hol = np.isin(index.strftime("%Y-%m-%d"), list(holidays))
        dt = np.where(hol, 2, dt)
    return dt


# ---------------------------------------------------------------- sun / clear sky
def fit_sun(df, verbose=True):
    """Clear-sky envelope: for each haze, fit sun coefficients by expectile (tau) regression with NNLS+IRLS.
    Returns (haze, sun, clear) with clear = the fitted clear-sky kW of every train hour."""
    doy = df.index.day_of_year.values.astype(float)
    hour = df.index.hour.values.astype(float)
    summer = np.array([ah._is_summer_time(t) for t in df.index])
    pv = df["pv_kw"].values
    mask = pv > 1.0                                            # hours with production define the envelope
    best = None
    for haze in HAZE_GRID:
        basis = ah.clear_sky_basis(doy[mask], hour[mask], summer[mask], haze).T     # (n, 3)
        y, w, x = pv[mask], np.ones(mask.sum()), np.zeros(3)
        for _ in range(IRLS_STEPS):
            sw = np.sqrt(w)
            x, _ = nnls(basis * sw[:, None], y * sw)
            r = np.maximum(basis @ x, 0.0) - y
            w_new = np.where(r > 0, 1.0 - TAU, TAU)      # r = pred - y: over-prediction is cheap, missing is dear
            if np.array_equal(w_new, w):
                break
            w = w_new
        r = np.maximum(basis @ x, 0.0) - y
        loss = float(np.mean(np.where(r > 0, (1.0 - TAU) * r, TAU * -r)))               # expectile loss
        if best is None or loss < best[0]:
            best = (loss, haze, x)
    _, haze, sun = best
    basis = ah.clear_sky_basis(doy, hour, summer, haze)
    clear = np.maximum(sun @ basis, 0.0)
    if verbose:
        print(f"sun fit: haze={haze:.2f}  sun={np.round(sun, 2)}  expectile loss={best[0]:.1f} kW")
        for m in sorted(set(df.index.month - 1)):
            sel = mask & (df.index.month - 1 == m)
            if sel.sum() > 100:
                q_pv, q_cs = np.quantile(pv[sel], 0.95), np.quantile(clear[sel], 0.95)
                print(f"  month {m + 1:2d}: q95 pv {q_pv:7.0f} kW  q95 clear-sky {q_cs:7.0f} kW  ratio {q_pv / max(q_cs, 1):.2f}")
    return haze, sun, clear


def monthly_kbar(pv, clear, use, month):
    """Mean clearness by month = sum(pv) / sum(clear-sky) over hours with clear-sky > CS_MIN_KW."""
    kbar = np.full(12, np.nan)
    for m in range(12):
        sel = use & (month == m) & (clear > ah.CS_MIN_KW)
        if clear[sel].sum() > 0:
            kbar[m] = pv[sel].sum() / clear[sel].sum()
    return kbar


def monthly_rates(df, use, month):
    """No-battery kg/h and EUR/h of each month under Hard Mode (November = neighbours' mean)."""
    net = np.maximum(df["load_kw"].values - df["pv_kw"].values, 0.0)
    rates = {}
    for key, col in (("co2_rate", "co2_kg_per_kwh"), ("cost_rate", "precio_eur_per_kwh")):
        r = np.full(12, np.nan)
        for m in range(12):
            sel = use & (month == m)
            if sel.sum():
                r[m] = float((net[sel] * df[col].values[sel]).mean())
        r[10] = np.nanmean([r[9], r[11]])                       # November: no load data
        rates[key] = r
    return rates["co2_rate"], rates["cost_rate"]


# ---------------------------------------------------------------- profiles
def fit_profiles(vals, index, dtype, use):
    """[12][3][24] month x day-type x hour means; weekend cells shrunk towards wd-profile x ratio (2-day prior)."""
    mo, hr = index.month.values - 1, index.hour.values
    prof = np.full((12, 3, 24), np.nan)
    for m in np.unique(mo[use]):
        mm = use & (mo == m)
        wd = mm & (dtype == 0)
        if wd.sum() < 24:                                       # no working days: fall back to all days
            wd = mm
        cnt = np.bincount(hr[wd], minlength=24)
        wd_prof = np.bincount(hr[wd], weights=vals[wd], minlength=24) / np.maximum(cnt, 1)
        wd_prof[cnt == 0] = np.nan
        tot0 = np.nanmean(vals[wd])
        prof[m, 0] = wd_prof
        for d in (1, 2):
            dd = mm & (dtype == d)
            cnt_d = np.bincount(hr[dd], minlength=24)
            cell = np.bincount(hr[dd], weights=vals[dd], minlength=24) / np.maximum(cnt_d, 1)
            cell[cnt_d == 0] = np.nan
            ratio = (np.nanmean(vals[dd]) / tot0) if dd.sum() and np.isfinite(tot0) and tot0 else 1.0
            prior = wd_prof * ratio
            with np.errstate(invalid="ignore"):
                prof[m, d] = np.where(cnt_d > 0, (cnt_d * cell + 2 * prior) / (cnt_d + 2), prior)
    return prof


def _fill_gaps(prof, month=10, neighbours=(9, 11)):
    """Fill a missing month (November load) with the neighbours' mean, elementwise."""
    bad = ~np.isfinite(prof[month])
    if bad.any() and np.isfinite(prof[list(neighbours)]).any():
        prof[month] = np.where(bad, np.nanmean(prof[list(neighbours)], axis=0), prof[month])
    if np.isnan(prof).any():                                    # last resort: global mean of the same cell type
        fill = np.nanmean(prof, axis=0)
        prof = np.where(np.isnan(prof), fill[None], prof)
    return prof


# ---------------------------------------------------------------- sample collection
def collect_samples(df, sig, params_for, chunks):
    """Run the agent's own book-keeping over every chunk and collect (features, truth) pairs for all leads.

    Returns flat arrays of shape (S, 48): per-series (base, f3) and truths, pv (clear, kbar), plus the
    scalar features f1/f2/k_last/k_day (S,) and the believed month of each lead (S, 48)."""
    F1 = {s: [] for s in SERIES}
    F2 = {s: [] for s in SERIES}
    BASE = {s: [] for s in SERIES}
    F3 = {s: [] for s in SERIES}
    TRUTH = {s: [] for s in SERIES}
    CLEAR, KBAR, KLAST, KDAY, MONTH, LEADC = ([] for _ in range(6))
    sig_price, sig_co2 = sig["price"].values, sig["co2"].values
    df_load, df_pv = df["load_kw"].values, df["pv_kw"].values

    for c in chunks:
        agent = ah.BatteryAgent(model=params_for(c))
        rows = np.flatnonzero(_chunk_of(df.index.day.values) == c)
        for abs_i in rows:
            obs = build_obs(df, int(abs_i), HARD.soc_init, HARD)
            i, n, cal, known = agent._observe(obs)
            f = agent._features(i, 48, cal, known)
            t0 = df.index[abs_i]
            exp = pd.date_range(t0, periods=48, freq="h")
            p_df, p_sig = df.index.get_indexer(exp), sig.index.get_indexer(exp)
            for s, (vals, pos) in (("price", (sig_price, p_sig)), ("co2", (sig_co2, p_sig)),
                                   ("load", (df_load, p_df)), ("pv", (df_pv, p_df))):
                BASE[s].append(f[s][0])
                F1[s].append(f[s][1])
                F2[s].append(f[s][2])
                F3[s].append(f[s][3])
                ok = pos >= 0
                TRUTH[s].append(np.where(ok, vals[np.maximum(pos, 0)], np.nan))
            CLEAR.append(f["pv"][0])
            KBAR.append(f["pv"][1])
            KLAST.append(f["pv"][2])
            KDAY.append(f["pv"][3])
            MONTH.append(cal["month"][:48])
            LEADC.append(cal["clear"][:48])
    out = {}
    for s in SERIES:
        out[s] = dict(base=np.asarray(BASE[s]), f1=np.asarray(F1[s]), f2=np.asarray(F2[s]),
                      f3=np.asarray(F3[s]), truth=np.asarray(TRUTH[s]))
    out["pv"].update(clear=np.asarray(CLEAR), kbar=np.asarray(KBAR), k_last=np.asarray(KLAST),
                     k_day=np.asarray(KDAY), lead_clear=np.asarray(LEADC))
    out["month"] = np.asarray(MONTH)
    return out


# ---------------------------------------------------------------- ridge
def _ridge(X, y):
    """No-intercept ridge on raw features (the agent applies the coefficients directly). None if too few samples."""
    X, y = np.asarray(X), np.asarray(y)
    if len(y) < MIN_FIT:
        return None
    XtX = X.T @ X
    lam = RIDGE_ALPHA * np.trace(XtX) / max(X.shape[1], 1)
    return np.linalg.solve(XtX + lam * np.eye(X.shape[1]), X.T @ y)


def _mae_by_bucket(err):
    """Mean |error| of an (S, 48) error matrix, grouped by the agent's lead buckets."""
    b = np.broadcast_to(ah.LEAD_BUCKET[:48], err.shape)
    return [float(np.nanmean(np.abs(err[b == k]))) for k in range(7)]


def fit_corrections(smp, verbose=True):
    """Ridge per lead x series x feature set {A, B}; returns coef dict and the corrected forecasts (load, pv)."""
    coef = {s: {"A": np.zeros((48, 3)), "B": np.zeros((48, 2))} for s in ("price", "co2", "load")}
    coef["pv"] = {"A": np.zeros((48, 2)), "B": np.zeros((48, 1))}
    kbar0 = smp["pv"]["kbar"][:, 0]
    for s in ("price", "co2", "load"):
        d = smp[s]
        y = d["truth"] - d["base"]                               # residual the correction must explain
        f1_ok, f2_ok = np.isfinite(d["f1"]), np.isfinite(d["f2"])
        for j in range(48):
            okA = f1_ok & f2_ok & np.isfinite(d["f3"][:, j]) & np.isfinite(y[:, j])
            r = _ridge(np.stack([d["f1"][okA], d["f2"][okA], d["f3"][okA, j]], axis=1), y[okA, j])
            if r is not None:
                coef[s]["A"][j] = r
            okB = f1_ok & f2_ok & ~np.isfinite(d["f3"][:, j]) & np.isfinite(y[:, j])
            r = _ridge(np.stack([d["f1"][okB], d["f2"][okB]], axis=1), y[okB, j])
            if r is not None:
                coef[s]["B"][j] = r
    d = smp["pv"]
    k_true = np.where(d["clear"] > ah.CS_MIN_KW, d["truth"] / np.maximum(d["clear"], 1e-9), np.nan)
    y = k_true - d["kbar"]                                       # clearness residual per target month
    feat2 = np.where(np.isfinite(d["k_day"]), d["k_day"], d["k_last"])   # exactly what _forecast uses
    for j in range(48):
        okA = np.isfinite(d["k_last"]) & (d["clear"][:, j] > ah.CS_MIN_KW) & np.isfinite(y[:, j])
        r = _ridge(np.stack([d["k_last"][okA] - kbar0[okA], feat2[okA] - kbar0[okA]], axis=1), y[okA, j])
        if r is not None:
            coef["pv"]["A"][j] = r
        okB = ~np.isfinite(d["k_last"]) & np.isfinite(d["k_day"]) & (d["clear"][:, j] > ah.CS_MIN_KW) & np.isfinite(y[:, j])
        r = _ridge(np.stack([d["k_day"][okB] - kbar0[okB]], axis=1), y[okB, j])
        if r is not None:
            coef["pv"]["B"][j] = r

    # corrected forecasts of load and pv, exactly as _forecast rebuilds them (needed for the error table)
    def corr(s):
        d = smp[s]
        f3 = np.isfinite(d["f3"])
        pred = d["base"] + np.where(f3, coef[s]["A"][:, 0] * d["f1"][:, None] + coef[s]["A"][:, 1] * d["f2"][:, None]
                                    + coef[s]["A"][:, 2] * np.nan_to_num(d["f3"]),
                                    coef[s]["B"][:, 0] * d["f1"][:, None] + coef[s]["B"][:, 1] * d["f2"][:, None])
        has_f = np.isfinite(d["f1"]) & np.isfinite(d["f2"])
        return np.where(has_f[:, None], pred, d["base"])

    load_hat = np.maximum(corr("load"), 0.0)
    k = d["kbar"] + np.where(np.isfinite(d["k_last"])[:, None],
                             coef["pv"]["A"][:, 0] * (d["k_last"] - kbar0)[:, None]
                             + coef["pv"]["A"][:, 1] * (feat2 - kbar0)[:, None],
                             coef["pv"]["B"][:, 0] * (d["k_day"] - kbar0)[:, None])
    k = np.where(np.isfinite(k), k, d["kbar"])
    pv_hat = np.clip(k, 0.0, 1.15) * d["clear"]

    if verbose:
        print("\nMAE by lead bucket [0,1,2 | 3-5 | 6-11 | 12-23 | 24+] (profile -> corrected), kW or units:")
        for s in ("price", "co2", "load"):
            e0 = smp[s]["truth"] - smp[s]["base"]
            e1 = smp[s]["truth"] - corr(s)
            fmt = lambda v: " ".join(f"{x:6.2f}" for x in v)
            print(f"  {s:5s} {fmt(_mae_by_bucket(e0))}  ->  {fmt(_mae_by_bucket(e1))}")
        e0 = smp["pv"]["truth"] - smp["pv"]["clear"] * smp["pv"]["kbar"]
        e1 = smp["pv"]["truth"] - pv_hat
        fmt = lambda v: " ".join(f"{x:6.0f}" for x in v)
        print(f"  pv    {fmt(_mae_by_bucket(e0))}  ->  {fmt(_mae_by_bucket(e1))}")
        net0 = (smp["load"]["truth"] - smp["pv"]["truth"]) - (smp["load"]["base"] - smp["pv"]["clear"] * smp["pv"]["kbar"])
        net1 = (smp["load"]["truth"] - smp["pv"]["truth"]) - (load_hat - pv_hat)
        fmt = lambda v: " ".join(f"{x:6.0f}" for x in v)
        print(f"  net   {fmt(_mae_by_bucket(np.where(np.isfinite(net0), net0, np.nan)))}"
              f"  ->  {fmt(_mae_by_bucket(np.where(np.isfinite(net1), net1, np.nan)))}")
    return coef, load_hat, pv_hat


def fit_errors(smp, load_hat, pv_hat, k_scen, verbose=True):
    """Net-load error quantiles (true - forecast) per lead bucket x clear-sky bin: [7][5][K]."""
    net_true = smp["load"]["truth"] - smp["pv"]["truth"]
    net_hat = load_hat - pv_hat
    err = (net_true - net_hat).ravel()
    ok = np.isfinite(err)
    err, b, c = err[ok], np.broadcast_to(ah.LEAD_BUCKET[:48], net_true.shape).ravel()[ok], \
        np.searchsorted(ah.CS_BINS, smp["pv"]["lead_clear"].ravel())[ok]
    qs = (np.arange(k_scen) + 0.5) / k_scen
    table = np.zeros((7, 5, k_scen))
    for bk in range(7):
        for col in range(5):
            sel = (b == bk) & (c == col)
            if sel.sum() >= MIN_FIT:
                table[bk, col] = np.quantile(err[sel], qs)
            else:                                            # sparse cell: pool the whole bucket, then everything
                sel2 = b == bk
                table[bk, col] = np.quantile(err[sel2], qs) if sel2.sum() >= MIN_FIT else np.quantile(err, qs)
    if verbose:
        print(f"\nnet-load error quantiles ({ok.sum()} samples, K={k_scen}), rows=lead buckets, cols=clear-sky bins:")
        for bk in range(7):
            lo = ", ".join(f"{table[bk, col, 0]:6.0f}/{table[bk, col, -1]:6.0f}" for col in range(5))
            print(f"  bucket {bk}: min/max per bin  {lo}")
    return table


# ---------------------------------------------------------------- assembly
def build_params(holdout=False, k_scen=7, spread_scale=1.0, spread_mode="lead", terminal_value=0.0, verbose=True):
    """Fit everything and return the model dict the agent expects (and model.json stores)."""
    df = load_campus_hourly(hard=True)
    sig = load_signals()
    if verbose:
        print(f"campus df: {len(df)} h  {df.index[0]} .. {df.index[-1]}   signals: {len(sig)} h  "
              f"months: {sorted(set(sig.index.month))}")
    month_df = df.index.month.values - 1
    chunk_df = _chunk_of(df.index.day.values)
    month_sig = sig.index.month.values - 1
    chunk_sig = _chunk_of(sig.index.day.values)
    allowed_df = np.ones(len(df), bool) if not holdout else chunk_df < 2
    allowed_sig = np.ones(len(sig), bool) if not holdout else chunk_sig < 2

    haze, sun, clear = fit_sun(df, verbose)
    kbar = monthly_kbar(df["pv_kw"].values, clear, allowed_df, month_df)
    kbar[10] = np.nanmean([kbar[9], kbar[11]])
    co2_rate, cost_rate = monthly_rates(df, allowed_df, month_df)

    # profiles per leave-chunk-out variant (chunk c removed everywhere, so corrections stay honest)
    dt_load = _daytypes(df.index, HOLIDAYS, load_mode=True)
    dt_sig = _daytypes(sig.index, HOLIDAYS, load_mode=False)
    profs = {}
    for c in CHUNKS:
        use_df, use_sig = allowed_df & (chunk_df != c), allowed_sig & (chunk_sig != c)
        load_prof = _fill_gaps(fit_profiles(df["load_kw"].values, df.index, dt_load, use_df))
        price_prof = _fill_gaps(fit_profiles(sig["price"].values, sig.index, dt_sig, use_sig))
        co2_prof = _fill_gaps(fit_profiles(sig["co2"].values, sig.index, dt_sig, use_sig))
        profs[c] = (price_prof, co2_prof, load_prof)

    zero_coef = {s: {"A": np.zeros((48, 3)), "B": np.zeros((48, 2))} for s in ("price", "co2", "load")}
    zero_coef["pv"] = {"A": np.zeros((48, 2)), "B": np.zeros((48, 1))}

    def params_for(c):
        price_prof, co2_prof, load_prof = profs[c]
        kbar_c = monthly_kbar(df["pv_kw"].values, clear, allowed_df & (chunk_df != c), month_df)
        kbar_c[10] = np.nanmean([kbar_c[9], kbar_c[11]])
        return dict(price_prof=price_prof, co2_prof=co2_prof, load_prof=load_prof, sun=sun, haze=haze,
                    kbar=kbar_c, err=np.zeros((7, 5, k_scen)), co2_rate=co2_rate, cost_rate=cost_rate,
                    coef=zero_coef, holidays=HOLIDAYS, spread_scale=0.0, spread_mode=spread_mode,
                    terminal_value=terminal_value)

    chunks = (0, 1) if holdout else CHUNKS
    smp = collect_samples(df, sig, params_for, chunks)
    coef, load_hat, pv_hat = fit_corrections(smp, verbose)
    err = fit_errors(smp, load_hat, pv_hat, k_scen, verbose)

    price_prof, co2_prof, load_prof = profs[0]                   # final model: fit on everything
    params = dict(price_prof=price_prof, co2_prof=co2_prof, load_prof=load_prof, sun=sun, haze=float(haze),
                  kbar=kbar, err=err, co2_rate=co2_rate, cost_rate=cost_rate, coef=coef, holidays=HOLIDAYS,
                  spread_scale=float(spread_scale), spread_mode=spread_mode, terminal_value=float(terminal_value))
    return params


def _jsonable(obj):
    """numpy -> plain Python so model.json can be serialised."""
    if isinstance(obj, dict):
        return {k: _jsonable(v) for k, v in obj.items()}
    if isinstance(obj, np.ndarray):
        return np.where(np.isnan(obj), None, obj).tolist() if np.isnan(obj.astype(float)).any() and obj.dtype.kind == "f" \
            else obj.tolist()
    if isinstance(obj, (np.floating, np.integer)):
        return float(obj)
    return obj


def main():
    import argparse
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--holdout", action="store_true", help="fit without days 15+ of each month (validation model)")
    p.add_argument("--out", default=None, help="output json (default agent_hard/model.json, or model_holdout.json)")
    p.add_argument("--k", type=int, default=7, help="scenarios per (lead bucket, clear-sky bin)")
    p.add_argument("--spread-scale", type=float, default=1.0)
    p.add_argument("--spread-mode", choices=("lead", "flat"), default="lead")
    p.add_argument("--tv", type=float, default=0.0, help="terminal value of stored energy, score points per kWh")
    a = p.parse_args()

    params = build_params(holdout=a.holdout, k_scen=a.k, spread_scale=a.spread_scale,
                          spread_mode=a.spread_mode, terminal_value=a.tv)
    out = Path(a.out) if a.out else (ROOT / "experiments/hard/model_holdout.json" if a.holdout
                                     else ROOT / "agent_hard/model.json")
    out.write_text(json.dumps(_jsonable(params)), encoding="utf-8")
    print(f"\nwrote {out}  ({out.stat().st_size / 1e3:.0f} kB)")


if __name__ == "__main__":
    main()
