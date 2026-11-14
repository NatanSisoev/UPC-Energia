"""Cross-check our simulator against the official starter_kit/environment.py (skipped if kit/data not present)."""
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
pytestmark = pytest.mark.skipif(not (ROOT / "starter_kit" / "environment.py").exists(), reason="starter_kit not downloaded")


def test_matches_official_environment():
    sys.path.insert(0, str(ROOT / "starter_kit"))
    from environment import run_agent_simulation
    from sim.data import synthetic_campus
    from sim.simulator import load_agent_class, simulate

    df = synthetic_campus(days=30)
    official = run_agent_simulation(load_agent_class(str(ROOT / "agent" / "agent.py"))(), df)
    ours = simulate(load_agent_class(str(ROOT / "agent" / "agent.py"))(), df)
    assert ours.score == pytest.approx(official["score"], abs=0.02)
    assert ours.d_co2_pct == pytest.approx(official["co2_estalviat_pct"], abs=0.02)
    assert ours.d_cost_pct == pytest.approx(official["cost_estalviat_pct"], abs=0.02)


def test_observation_matches_official_environment():
    """The agent must see exactly what the server shows: same keys, same forecast lists (start at the current
    hour, truncated at the end), same telemetry of the previous hour."""
    sys.path.insert(0, str(ROOT / "starter_kit"))
    from environment import CampusBatteryEnv
    from sim.data import synthetic_campus
    from sim.simulator import SOC_INIT, build_obs

    df = synthetic_campus(days=3)
    env = CampusBatteryEnv(df.rename_axis("Fecha"))
    for i in (0, 1, 30, len(df) - 24, len(df) - 5, len(df) - 1):
        env.t = i
        official, ours = env._get_obs(), build_obs(df, i, SOC_INIT)
        assert set(official) == set(ours)
        for key in ("hour", "day_of_week", "soc_kwh", "preu_actual", "co2_actual", "noves_dades_5min"):
            assert official[key] == ours[key], (i, key)
        for key in ("preus_properes_24h", "co2_properes_24h"):
            assert official[key] == pytest.approx(ours[key]), (i, key)
            assert len(official[key]) == len(ours[key]) == min(24, len(df) - i)
