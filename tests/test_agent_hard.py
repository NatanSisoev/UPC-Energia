"""Tests for the Hard Mode agent (agent_hard/agent.py).

The heavy validation (score vs the 22.40 bound on the hold-out, value-of-information ladder, tuning) lives in
experiments/hard/validate.py and tune.py -- slow, run manually.  What is tested here, fast and synthetic:

  * the clamp never allows an infraction, at every extreme SOC, including the official smoke-test obs shape
    (string timestamp, 24-long lists, no cap_max_kwh / power_max_kw);
  * act() never raises on malformed observations (returns a finite, feasible setpoint or 0);
  * the stochastic DP planner with PERFECT forecasts reaches ~the perfect-foresight LP bound on a small
    frame where net load goes negative (exercises the export kink and the scenario machinery);
  * a full HARD run on synthetic data has 0 violations;
  * model.json (the file the server zip carries) exists and has the expected schema.
"""
import json
import math
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

import agent_hard.agent as ah
from experiments.hard.validate import OracleAgent
from sim.simulator import HARD, build_obs, simulate

MODEL_JSON = Path(__file__).resolve().parents[1] / "agent_hard" / "model.json"


@pytest.fixture(scope="module")
def params():
    if not MODEL_JSON.exists():
        pytest.skip("agent_hard/model.json not built yet (python -m experiments.hard.build_model)")
    return json.loads(MODEL_JSON.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def hard_df():
    """14 synthetic days with a 12x solar plant: net load strongly negative at midday (export kink matters)."""
    from sim.data import synthetic_campus
    df = synthetic_campus(days=14)
    df["pv_kw"] *= 12.0
    return df


def smoke_obs(ts, soc, price=0.10, co2=0.20):
    """The exact shape starter_kit/check_submission.py feeds act(): strings and plain lists."""
    return {"timestamp": ts, "soc_kwh": soc, "soc_percent": 100.0 * soc / 6000.0,
            "preu_actual": price, "co2_actual": co2,
            "preus_properes_24h": [price] * 24, "co2_properes_24h": [co2] * 24,
            "noves_dades_5min": {"ultim_consum_kw": 1100.0, "ultima_solar_kw": 0.0}}


# ---------------------------------------------------------------- clamp / robustness
@pytest.mark.parametrize("soc", [0.0, 1e-6, 1500.0, 3000.0, 5999.9999, 6000.0, 12345.0, float("nan")])
def test_act_stays_feasible_at_every_soc(params, soc):
    agent = ah.BatteryAgent(model=params)
    p = agent.act(smoke_obs("2026-01-10 08:00:00", soc))
    assert np.isfinite(p)
    if not math.isnan(soc):
        max_c = max(0.0, min(1500.0, (6000.0 - min(max(soc, 0.0), 6000.0)) / ah.ETA - 1e-4))
        max_d = max(0.0, min(1500.0, max(min(soc, 6000.0), 0.0) * ah.ETA - 1e-4))
        assert -max_d - 1e-9 <= p <= max_c + 1e-9
    else:
        assert p == 0.0                                  # unknown SOC: idle


@pytest.mark.parametrize("obs", [
    {},                                                  # empty
    {"soc_kwh": 3000.0},                                 # no clock, no lists
    {"timestamp": "not a date", "soc_kwh": 3000.0},
    {"timestamp": datetime(2026, 1, 10, 8), "soc_kwh": 3000.0,
     "preus_properes_24h": [], "co2_properes_24h": []},  # market lists missing entirely
    {"timestamp": "2026-01-10 08:00:00", "soc_kwh": None,
     "preus_properes_24h": [0.1], "co2_properes_24h": [0.1]},
    {"timestamp": "2026-01-10 08:00:00", "soc_kwh": 3000.0,
     "preus_properes_24h": ["x"] * 24, "co2_properes_24h": [None] * 24},   # garbage values
])
def test_act_survives_malformed_obs(params, obs):
    agent = ah.BatteryAgent(model=params)
    p = agent.act(obs)
    assert np.isfinite(p)


def test_official_smoke_shape_24_steps(params):
    """Exactly what the official checker does: 24 hourly steps, string timestamps, plain lists."""
    agent = ah.BatteryAgent(model=params)
    ts = datetime(2026, 1, 10, 0)
    soc = 3000.0
    for k in range(24):
        p = agent.act(smoke_obs((ts + timedelta(hours=k)).isoformat(sep=" "), soc))
        assert np.isfinite(p)
        max_c = max(0.0, min(1500.0, (6000.0 - soc) / ah.ETA - 1e-4))
        max_d = max(0.0, min(1500.0, soc * ah.ETA - 1e-4))
        assert -max_d - 1e-9 <= p <= max_c + 1e-9
        soc = min(max(soc + (p * ah.ETA if p >= 0 else p / ah.ETA), 0.0), 6000.0)


def test_flat_market_idles(params):
    agent = ah.BatteryAgent(model=params)
    assert agent.act(smoke_obs("2026-01-10 08:00:00", 3000.0)) == 0.0


def test_spike_market_charges(params):
    """A price/CO2 spike two hours out must produce a charge, not an idle."""
    agent = ah.BatteryAgent(model=params)
    obs = smoke_obs("2026-01-10 08:00:00", 3000.0, price=0.30, co2=0.35)
    obs["preus_properes_24h"] = [0.10, 0.10, 0.30] + [0.30] * 21
    obs["co2_properes_24h"] = [0.20, 0.20, 0.35] + [0.35] * 21
    assert agent.act(obs) > 0.0


# ---------------------------------------------------------------- planner quality
def test_perfect_forecast_reaches_the_lp_bound(params, hard_df):
    """With every forecast perfect the agent must be (almost) the perfect-foresight LP: this isolates the
    planner from the forecaster.  98 % is generous room for the end-of-run padding effect; a real planner
    bug lands far below (wrong shift sign: ~50 %, mean-instead-of-quantile: ~95 %)."""
    bound = oracle_bound = None
    from experiments.oracle.oracle_lp import oracle_run
    bound = oracle_run(hard_df, HARD)[0]
    res = simulate(OracleAgent(params, hard_df, True, True), hard_df, spec=HARD)
    assert res.violations == 0
    assert res.score >= 0.98 * bound


def test_full_hard_run_zero_violations(params, hard_df):
    res = simulate(ah.BatteryAgent(model=params), hard_df, spec=HARD)
    assert res.violations == 0
    assert res.score > 0.0


# ---------------------------------------------------------------- model file
def test_model_json_schema():
    assert MODEL_JSON.exists(), "model.json missing -- build it with python -m experiments.hard.build_model"
    m = json.loads(MODEL_JSON.read_text(encoding="utf-8"))
    for k, ndaytype in (("price_prof", 3), ("co2_prof", 3), ("load_prof", 4)):   # load also splits closure days
        a = np.asarray(m[k], dtype=float)
        assert a.shape == (12, ndaytype, 24) and np.isfinite(a).all()
    assert np.asarray(m["sun"]).shape == (3,)
    assert np.asarray(m["kbar"]).shape == (12,)
    err = np.asarray(m["err"], dtype=float)
    assert err.ndim == 3 and err.shape[0] == 7 and err.shape[1] == 5
    assert (np.diff(err, axis=2) >= -1e-9).all()          # quantiles ascending within each cell
    for s, wide in (("price", 3), ("co2", 3), ("load", 3)):
        for r, ncol in (("A", 3), ("B", 2)):
            assert np.asarray(m["coef"][s][r]).shape == (48, ncol)
    assert np.asarray(m["co2_rate"]).shape == (12,) and np.asarray(m["cost_rate"]).shape == (12,)
    assert len(m["holidays"]) >= 10
    agent = ah.BatteryAgent(model=m)                       # and the agent accepts it end to end
    assert np.isfinite(agent.act(smoke_obs("2026-06-10 12:00:00", 3000.0)))
