"""Profiles for the published-calendar model (agent_hard.agent.day_info): month x day-type x hour.

Load profile has 4 day types (0 working day, 1 Saturday, 2 Sunday/holiday, 3 closure/reduced weekday). A cell with no
data (e.g. closure weekdays of March) is filled with  working-day profile x ratio  where the ratio is learnt from the
SAME closure period elsewhere (Holy Week: 1-2 April; Christmas: 24 Dec + 2/5 Jan), a 2-day prior as for weekends.
Market profiles (price, CO2) have 3 day types where national holidays count as Sundays.
"""
import numpy as np
import pandas as pd

import agent_hard.agent as ah
import experiments.hardk.build_model as bm

DEFAULT_CLOSURE_RATIO = 0.85


def load_types(index):
    return np.array([ah.day_info(t.date())[0] for t in index])


def market_types(index):
    return np.array([ah.day_info(t.date())[1] for t in index])


def closure_ratios(vals, index, ltype, use):
    """Mean (daily mean of a closure weekday) / (mean of the working days of its month), per closure period."""
    days = index.normalize()
    out = {}
    for period in ("xmas", "easter"):
        r = []
        for day in np.unique(days[use & (ltype == 3)]):
            if ah.closure_period(pd.Timestamp(day).date()) != period:
                continue
            m = (index.month == pd.Timestamp(day).month) & (index.year == pd.Timestamp(day).year)
            wd = use & m & (ltype == 0)
            sel = use & (days == day)
            if wd.sum() >= 24 and sel.sum() >= 20:
                r.append(vals[sel].mean() / vals[wd].mean())
        out[period] = float(np.mean(r)) if r else DEFAULT_CLOSURE_RATIO
    return out


def fit_load_profiles(vals, index, use):
    ltype = load_types(index)
    mo, hr = index.month.values - 1, index.hour.values
    ratios = closure_ratios(vals, index, ltype, use)
    days = index.normalize()
    prof = np.full((12, 4, 24), np.nan)

    def cell(sel):
        cnt = np.bincount(hr[sel], minlength=24)
        mean = np.bincount(hr[sel], weights=vals[sel], minlength=24) / np.maximum(cnt, 1)
        mean[cnt == 0] = np.nan
        return cnt, mean

    for m in np.unique(mo[use]):
        mm = use & (mo == m)
        c0, base = cell(mm & (ltype == 0))
        if (mm & (ltype == 0)).sum() < 24:                         # no working days (August): closure weekdays are the base
            c0, base = cell(mm & (ltype == 3))
            if (mm & (ltype == 3)).sum() < 24:
                c0, base = cell(mm)
        tot0 = np.nanmean(base)
        prof[m, 0] = base
        for t in (1, 2):
            c, mean = cell(mm & (ltype == t))
            ratio = (np.nanmean(mean) / tot0) if c.sum() and np.isfinite(tot0) else 1.0
            prior = base * ratio
            prof[m, t] = np.where(c > 0, (c * mean + 2 * prior) / (c + 2), prior)
        # closure weekdays: ratio of the period(s) present in this month, else the generic default
        sel3 = mm & (ltype == 3)
        c, mean = cell(sel3)
        periods = {ah.closure_period(pd.Timestamp(d).date()) for d in np.unique(days[sel3])}
        if not periods:                                            # no closure day in the data of this month: use the
            month_days = {pd.Timestamp(d).date() for d in np.unique(days[(index.month == m + 1)])}   # period that falls in this month
            periods = {ah.closure_period(d) for d in month_days}
            periods = {p for p in periods if p}
            if not periods:                                        # calendar of the evaluation year
                y = 2025 if m + 1 >= 9 else 2026
                import datetime as dt
                periods = {ah.closure_period(dt.date(y, m + 1, k)) for k in range(1, 29)} - {None}
        r3 = float(np.mean([ratios.get(p, DEFAULT_CLOSURE_RATIO) for p in periods])) if periods else DEFAULT_CLOSURE_RATIO
        if "summer" in periods:                                    # August: the base already is the closed campus
            r3 = 1.0
        prior = base * r3
        prof[m, 3] = np.where(c > 0, (c * mean + 2 * prior) / (c + 2), prior)
    # months without any load data (November): neighbours' mean
    bad = ~np.isfinite(prof[10])
    if bad.any():
        prof[10] = np.where(bad, np.nanmean(prof[[9, 11]], axis=0), prof[10])
    if np.isnan(prof).any():
        prof = np.where(np.isnan(prof), np.nanmean(prof, axis=0, keepdims=True), prof)
    return prof


def make_profiles(df, sig, use_df, use_sig, kernel=None, centres=None):
    """Dict with load_prof (12,4,24), price_prof, co2_prof (12,3,24) for the calendar model."""
    if kernel is not None:
        return make_profiles_k(df, sig, use_df, use_sig, kernel, centres)
    mt = market_types(sig.index)
    return dict(load_prof=fit_load_profiles(df["load_kw"].values, df.index, use_df),
                price_prof=bm._fill_gaps(bm.fit_profiles(sig["price"].values, sig.index, mt, use_sig)),
                co2_prof=bm._fill_gaps(bm.fit_profiles(sig["co2"].values, sig.index, mt, use_sig)))


# ---------------------------------------------------------------- kernel (date-centred) variants
def fit_load_profiles_k(vals, index, use, W):
    """fit_load_profiles with day weights W[m] (12, N) instead of month membership. Closure ratios stay global."""
    ltype = load_types(index)
    hr = index.hour.values
    ratios = closure_ratios(vals, index, ltype, use)
    days = index.normalize()
    prof = np.full((12, 4, 24), np.nan)
    ok_v = np.isfinite(vals)
    for m in range(12):
        w = np.where(use & ok_v, W[m], 0.0)
        mm = w > 0
        if not mm.any():
            continue

        def cell(sel):
            cnt = np.bincount(hr[sel], weights=w[sel], minlength=24)
            mean = np.bincount(hr[sel], weights=vals[sel] * w[sel], minlength=24) / np.maximum(cnt, 1e-12)
            mean[cnt <= 0] = np.nan
            return cnt, mean

        c0, base = cell(mm & (ltype == 0))
        if (mm & (ltype == 0)).sum() < 24:
            c0, base = cell(mm & (ltype == 3))
            if (mm & (ltype == 3)).sum() < 24:
                c0, base = cell(mm)
        tot0 = np.nanmean(base)
        prof[m, 0] = base
        for t in (1, 2):
            c, mean = cell(mm & (ltype == t))
            ratio = (np.nanmean(mean) / tot0) if c.sum() and np.isfinite(tot0) else 1.0
            prior = base * ratio
            prof[m, t] = np.where(c > 0, (c * mean + 2 * prior) / (c + 2), prior)
        sel3 = mm & (ltype == 3)
        c, mean = cell(sel3)
        periods = {ah.closure_period(pd.Timestamp(d).date()) for d in np.unique(days[sel3])}
        if not periods:
            month_days = {pd.Timestamp(d).date() for d in np.unique(days[(index.month == m + 1)])}
            periods = {ah.closure_period(d) for d in month_days}
            periods = {p for p in periods if p}
            if not periods:
                y = 2025 if m + 1 >= 9 else 2026
                import datetime as dt
                periods = {ah.closure_period(dt.date(y, m + 1, k)) for k in range(1, 29)} - {None}
        r3 = float(np.mean([ratios.get(p, DEFAULT_CLOSURE_RATIO) for p in periods])) if periods else DEFAULT_CLOSURE_RATIO
        if "summer" in periods:
            r3 = 1.0
        prior = base * r3
        prof[m, 3] = np.where(c > 0, (c * mean + 2 * prior) / (c + 2), prior)
    bad = ~np.isfinite(prof[10])
    if bad.any():
        prof[10] = np.where(bad, np.nanmean(prof[[9, 11]], axis=0), prof[10])
    if np.isnan(prof).any():
        prof = np.where(np.isnan(prof), np.nanmean(prof, axis=0, keepdims=True), prof)
    return prof


def make_profiles_k(df, sig, use_df, use_sig, kernel, centres):
    mt = market_types(sig.index)
    Wd, Ws = kernel.weights(df.index, centres), kernel.weights(sig.index, centres)
    return dict(load_prof=fit_load_profiles_k(df["load_kw"].values, df.index, use_df, Wd),
                price_prof=bm._fill_gaps(bm.fit_profiles_k(sig["price"].values, sig.index, mt, use_sig, Ws)),
                co2_prof=bm._fill_gaps(bm.fit_profiles_k(sig["co2"].values, sig.index, mt, use_sig, Ws)))
