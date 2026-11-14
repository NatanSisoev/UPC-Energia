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
