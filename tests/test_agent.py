"""Behavioural tests of the submitted agent (agent/agent.py) on synthetic data - no download needed."""
import numpy as np
import pytest

from sim.data import synthetic_campus
from sim.simulator import CAPACITY, ETA, P_MAX, SOC_INIT, build_obs, load_agent_class, simulate

AGENT = "agent/agent.py"


@pytest.fixture(scope="module")
def cls():
    return load_agent_class(AGENT)


@pytest.fixture(scope="module")
def df():
    return synthetic_campus(days=10)


def test_scores_well_with_zero_violations_and_ends_empty(cls, df):
    r = simulate(cls(), df)
    assert r.violations == 0
    assert r.score > 10.0                      # synthetic campus has big price/CO2 spreads: >10 is easy for an MPC
    assert r.trace["soc_kwh"].iloc[-1] < 1.0   # nothing left in the battery when the simulation ends


def test_matches_perfect_foresight_when_the_campus_always_absorbs_the_battery(cls, df):
    """Like the real campus: net load always above 500 kW. Then the score is linear in the setpoint and, given the
    true score weights, re-planning 24 h ahead every hour must reproduce the perfect-foresight optimum."""
    from experiments.oracle.oracle_lp import oracle_run
    big = df.assign(load_kw=df["load_kw"] + 400.0, pv_kw=df["pv_kw"] * 0.1)
    base = (big["load_kw"] - big["pv_kw"]).clip(lower=0)
    co2_base = float((base * big["co2_kg_per_kwh"]).sum())
    cost_base = float((base * big["precio_eur_per_kwh"]).sum())

    class ExactWeights(cls):                   # the real agent estimates these two totals from the train months
        def _weights(self):
            return 0.7 / co2_base, 0.3 / cost_base

    assert simulate(ExactWeights(), big).score == pytest.approx(oracle_run(big)[0], rel=1e-3)


def test_lists_starting_at_the_next_hour_are_detected(cls, df):
    """A simulator whose 24 h lists start at t+1 (instead of t, as the official one) must not fool the agent."""
    class Shifted:
        def __init__(self):
            self.agent, self.i = cls(), 0

        def act(self, obs):
            obs = dict(obs)
            for key, col in (("preus_properes_24h", "precio_eur_per_kwh"), ("co2_properes_24h", "co2_kg_per_kwh")):
                obs[key] = df[col].iloc[self.i + 1:self.i + 25].tolist()
            self.i += 1
            return self.agent.act(obs)

    assert simulate(Shifted(), df).score == pytest.approx(simulate(cls(), df).score, rel=5e-3)


def test_planner_reproduces_the_lp_optimum(cls):
    """Independent check of the dynamic programme: rolling the planner through random 24 h windows must cost the
    same as the HiGHS linear programme on that window (the agent itself only uses numpy)."""
    from experiments.mpc.arb import lp_schedule
    rng = np.random.default_rng(1)
    agent = cls()
    for _ in range(25):
        w = rng.uniform(0.2, 2.0, 24) * (1 + 0.8 * np.sin(np.arange(24) * 2 * np.pi / 24 + rng.uniform(0, 6)))
        w = np.maximum(w, 0.05)
        soc0 = float(rng.uniform(0, CAPACITY))
        c, d = lp_schedule(w, soc0)
        best = float(np.dot(w, c - d))
        soc, cost = soc0, 0.0
        for t in range(24):
            p = cls._clamp(agent._plan(w[t:], soc, P_MAX), soc)
            cost += w[t] * p
            soc = min(max(soc + (p * ETA if p >= 0 else p / ETA), 0.0), CAPACITY)
        assert cost == pytest.approx(best, abs=2e-3 * np.abs(w).sum() * P_MAX / 24)


def test_never_discharges_into_an_empty_campus(cls, df):
    """Battery energy exported to the grid earns nothing: with no measured consumption the agent must not discharge."""
    agent = cls()
    obs = build_obs(df, 20, 1500.0)            # 20:00, evening peak, battery 75 % full
    obs["noves_dades_5min"] = {"ultim_consum_kw": 0.0, "ultima_solar_kw": 0.0}
    assert agent.act(obs) >= 0.0


@pytest.mark.parametrize("soc", [0.0, 1e-6, 1000.0, 1999.9999, 2000.0])
def test_setpoint_is_always_physically_feasible(cls, df, soc):
    agent = cls()
    for i in (0, 13, 20, len(df) - 1):
        p = agent.act(build_obs(df, i, soc))
        assert np.isfinite(p)
        assert -min(P_MAX, soc * ETA) <= p <= min(P_MAX, (CAPACITY - soc) / ETA)


def test_survives_malformed_observations(cls, df):
    agent = cls()
    good = build_obs(df, 5, SOC_INIT)
    broken = [
        {},
        {"soc_kwh": float("nan")},
        dict(good, preus_properes_24h=[], co2_properes_24h=[]),
        dict(good, preus_properes_24h=[float("nan")] * 24),
        dict(good, noves_dades_5min=None, timestamp=None),
        dict(good, preu_actual=None, co2_actual="x"),
        dict(good, timestamp=float("nan"), preus_properes_24h=[0.1], co2_properes_24h=[]),
        dict(good, preus_properes_24h=[None] * 24),
    ]
    for obs in broken:
        p = agent.act(obs)
        assert isinstance(p, float) and np.isfinite(p) and abs(p) <= P_MAX
