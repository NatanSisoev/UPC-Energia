"""Fast arbitrage test-bench for the MPC design (experiments only - never imported by agent/).

Finding that makes this valid: on the train set the campus net load (load - pv) is never negative and is below
the battery's 500 kW in only ~0.5 % of hours, so grid import = net + setpoint almost always and the score is
LINEAR in the setpoint:

    score = 100 * sum_t w_t * (-p_t),   w_t = 0.7 * co2_t / CO2_base + 0.3 * price_t / COST_base

i.e. the whole problem is energy arbitrage on the blended signal w_t, which the agent knows 24 h ahead.
This module works on the price/CO2 series alone (all 12 train months, including November, which has no load data).

Run:  python -m experiments.mpc.arb
"""
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.optimize import linprog

ROOT = Path(__file__).resolve().parents[2]
ETA = 0.9 ** 0.5
CAP, PMAX, SOC0 = 2000.0, 500.0, 1000.0
_CACHE = {}


def load_signals() -> pd.DataFrame:
    """Hourly price + CO2 for every train hour (6,768 h), with the contiguous-block id."""
    p = pd.read_csv(ROOT / "data/train/precio_pvpc.csv", parse_dates=["Fecha"]).set_index("Fecha")
    c = pd.read_csv(ROOT / "data/train/co2_red.csv", parse_dates=["Fecha"]).set_index("Fecha")
    df = pd.DataFrame({"price": p["precio_eur_per_kwh"], "co2": c["co2_kg_per_kwh"]}).dropna()
    gap = df.index.to_series().diff().dt.total_seconds().div(3600).fillna(1) > 1
    df["block"] = gap.cumsum().values
    return df


def default_weights(df: pd.DataFrame):
    """(k_co2, k_price) such that w = k_co2*co2 + k_price*price is in score points per kWh, flat 1.1 MW load."""
    return 0.7 * 100 / (1100 * df["co2"].sum()), 0.3 * 100 / (1100 * df["price"].sum())


def lp_schedule(w, soc0, tv=0.0):
    """Min sum w_t (c_t - d_t) - tv * soc_end  s.t. battery physics. Returns (charge, discharge) in kW.

    Variables x = [c, d] in [0, PMAX]; soc_t = soc0 + eta*cumsum(c) - cumsum(d)/eta must stay in [0, CAP]."""
    w = np.asarray(w, dtype=float)
    n = len(w)
    # IMPORTANT: rescale the costs to O(1). In score units w ~ 1e-5, the same order as HiGHS' 1e-7 dual
    # tolerance relative to the spreads we arbitrage, and the solver then stops at visibly sub-optimal plans.
    scale = 1.0 / max(float(np.mean(np.abs(w))), 1e-300)
    w, tv = w * scale, tv * scale
    if n > 200:                                    # long horizons (oracle): sparse form with explicit SOC variables
        from scipy.sparse import diags, eye, hstack
        I = eye(n, format="csr")
        D = I - diags([np.ones(n - 1)], [-1], format="csr")           # s_t - s_{t-1}
        A_eq = hstack([-ETA * I, I / ETA, D], format="csr")
        b_eq = np.zeros(n)
        b_eq[0] = soc0
        cost = np.concatenate([w, -w, np.zeros(n)])
        cost[-1] = -tv
        r = linprog(cost, A_eq=A_eq, b_eq=b_eq, bounds=[(0, PMAX)] * (2 * n) + [(0, CAP)] * n, method="highs")
        assert r.status == 0, r.message
        return r.x[:n], r.x[n:2 * n]
    if n not in _CACHE:
        L = np.tril(np.ones((n, n)))
        S = np.hstack([ETA * L, -L / ETA])
        _CACHE[n] = (np.vstack([S, -S]), [(0.0, PMAX)] * (2 * n))
    A_ub, bounds = _CACHE[n]
    cost = np.concatenate([w - tv * ETA, -w + tv / ETA])
    b_ub = np.concatenate([np.full(n, CAP - soc0), np.full(n, soc0)])
    r = linprog(cost, A_ub=A_ub, b_ub=b_ub, bounds=bounds, method="highs")
    assert r.status == 0, r.message
    return r.x[:n], r.x[n:]


def oracle_gain(w, soc0=SOC0):
    """Perfect foresight over the whole series (single run, SOC carried)."""
    c, d = lp_schedule(w, soc0)
    return float(np.dot(w, d - c))


def mpc_gain(w_true, w_plan=None, soc0=SOC0, horizon=24, offset=0, extend=None, tv_fn=None, endgame=True):
    """Receding-horizon arbitrage, scored on w_true while planning on w_plan (default: the same).

    offset=0: the plan sees [t, t+horizon) - the official environment (list starts at the CURRENT hour, truncated
    at the end). offset=1 emulates an agent that wrongly treats the list as starting at t+1.
    extend(t, known) -> extra predicted values appended beyond the known window. tv_fn(t, window) -> value/kWh of
    the energy left at the end of the window. endgame=False hides the end of the simulation from the planner.
    """
    w_plan = w_true if w_plan is None else w_plan
    n = len(w_true)
    soc, gain = soc0, 0.0
    for t in range(n):
        known = w_plan[t:t + horizon]
        if offset:                                   # misaligned agent: believes known[0] is NEXT hour
            known = np.concatenate([[w_plan[t]], w_plan[t:t + horizon]])
        at_end = len(w_plan) - t < horizon
        win, tv = known, 0.0
        if not at_end or not endgame:
            if not endgame and at_end:               # pad like a simulator that hides the end
                win = np.concatenate([known, np.full(horizon - len(known), known[-1])])
            if extend is not None:
                win = np.concatenate([win, extend(t, win)])
            if tv_fn is not None:
                tv = tv_fn(t, win)
        c, d = lp_schedule(win, soc, tv=tv)
        p = float(np.clip(c[0] - d[0], -min(PMAX, soc * ETA), min(PMAX, (CAP - soc) / ETA)))
        soc = min(max(soc + (p * ETA if p >= 0 else p / ETA), 0.0), CAP)
        gain -= w_true[t] * p
    return gain


if __name__ == "__main__":
    import time
    df = load_signals()
    w = df["co2"].values * default_weights(df)[0] + df["price"].values * default_weights(df)[1]
    orc = oracle_gain(w)
    print(f"oracle (one continuous run, {len(w)} h): {orc:.4f} points")
    for name, kw in [
        ("MPC 24 h, no terminal value", {}),
        ("MPC 24 h, tv = mean(w)", {"tv_fn": lambda t, e: float(np.mean(e))}),
        ("MPC 24 h + repeat-last-day", {"extend": lambda t, k: k[-24:]}),
        ("MPC 12 h", {"horizon": 12}),
        ("MPC 6 h", {"horizon": 6}),
    ]:
        t0 = time.time()
        g = mpc_gain(w, **kw)
        print(f"{name:30s}: {g:.4f}  ({100 * g / orc:.2f} % of oracle, {time.time() - t0:.0f}s)")
