import numpy as np
import pytest

from sim.check import ast_scan
from sim.data import synthetic_campus
from sim.simulator import ETA, SOC_INIT, simulate, load_agent_class

AGENT = "agent/agent.py"


class Idle:
    def act(self, obs):
        return 0.0


class Reckless:
    """Always asks for +500 kW: must trigger violations once the battery is full."""
    def act(self, obs):
        return 500.0


def test_idle_agent_scores_zero():
    r = simulate(Idle(), synthetic_campus(days=14))
    assert r.score == pytest.approx(0.0)
    assert r.violations == 0 and r.d_co2_pct == pytest.approx(0.0)


def test_reckless_agent_gets_violations():
    r = simulate(Reckless(), synthetic_campus(days=14))
    assert r.violations > 0


def test_baseline_agent_has_no_violations_and_positive_score():
    r = simulate(load_agent_class(AGENT)(), synthetic_campus(days=84))
    assert r.violations == 0
    assert r.score > 0


def test_clamp_at_extreme_soc():
    cls = load_agent_class(AGENT)
    assert cls._clamp(500.0, 2000.0) <= 0.0           # full -> cannot charge
    assert cls._clamp(-500.0, 0.0) >= 0.0             # empty -> cannot discharge
    assert cls._clamp(-500.0, 100.0) >= -100.0 * ETA  # limited by stored energy
    assert cls._clamp(9999.0, SOC_INIT) <= 500.0


def test_agent_passes_ast_scan():
    from pathlib import Path
    assert ast_scan(Path(AGENT)) == []


def test_energy_accounting_round_trip():
    """Charge 100 kWh then discharge: stored = 100*eta, deliverable = 100*eta*eta = 90."""
    assert 100 * ETA * ETA == pytest.approx(90.0)


def test_ast_scan_rejects_unlisted_and_forbidden_code(tmp_path):
    from sim.check import ast_scan
    nl = chr(10)
    for snippet in ("import os", "import requests", "import torch", "from matplotlib import pyplot", "x = eval('1')"):
        f = tmp_path / "bad.py"
        f.write_text(snippet + nl)
        assert ast_scan(f), snippet


def test_ast_scan_accepts_allowed_libraries(tmp_path):
    from sim.check import ast_scan
    nl = chr(10)
    lines = [
        "import numpy as np",
        "from pathlib import Path",
        "import joblib",
        "from sklearn.ensemble import RandomForestRegressor",
    ]
    f = tmp_path / "ok.py"
    f.write_text(nl.join(lines) + nl)
    assert ast_scan(f) == []
