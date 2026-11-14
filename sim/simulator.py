"""Local battery simulator + scoring. OUR APPROXIMATION of the official evaluator.

Assumptions (inferred from the challenge page; validate vs starter_kit/environment.py when available):
- eta_one_way = sqrt(0.9). Charging p kW stores p*eta kWh; discharging p kW delivers p kW and removes p/eta kWh.
- grid = load - pv + setpoint. Import (grid>0) costs price and emits co2*kWh. Export (grid<0) earns EXPORT_PRICE, no CO2 credit.
- Baseline "no battery" = same campus with setpoint 0.
- Score = max(0, 0.7*dCO2% + 0.3*dCost% - VIOLATION_PENALTY*violations)  (percent units).
- Violation = requested setpoint outside the feasible range that hour (|p|>500, charge > room/eta, discharge > soc*eta).
  Infeasible requests are clipped by the simulator.
"""
from dataclasses import dataclass, field
import importlib.util
from pathlib import Path

import numpy as np
import pandas as pd

CAPACITY = 2000.0
P_MAX = 500.0
ETA = 0.9 ** 0.5
SOC_INIT = 0.5 * CAPACITY
EXPORT_PRICE = 0.04
VIOLATION_PENALTY = 0.20   # page formula; FAQ says 1.00 -> keep configurable
TOL = 1e-3


@dataclass
class Result:
    score: float
    d_co2_pct: float
    d_cost_pct: float
    violations: int
    co2_base: float
    co2_agent: float
    cost_base: float
    cost_agent: float
    trace: pd.DataFrame = field(repr=False, default=None)

    def summary(self) -> str:
        return (f"score={self.score:.3f}  dCO2={self.d_co2_pct:.2f}%  dCost={self.d_cost_pct:.2f}%  "
                f"violations={self.violations}")


def _grid_metrics(load, pv, setpoint, price, co2):
    grid = load - pv + setpoint
    imp = np.clip(grid, 0, None)
    exp = np.clip(-grid, 0, None)
    return float((imp * co2).sum()), float((imp * price).sum() - (exp * EXPORT_PRICE).sum())


def _future(df: pd.DataFrame, i: int, col: str) -> list:
    vals = df[col].iloc[i + 1:i + 25].tolist()
    last = vals[-1] if vals else float(df[col].iloc[i])
    return (vals + [last] * 24)[:24]


def build_obs(df: pd.DataFrame, i: int, soc: float) -> dict:
    row = df.iloc[i]
    prev = df.iloc[i - 1] if i > 0 else row
    ts = df.index[i]
    return {
        "timestamp": ts, "hour": int(ts.hour), "day_of_week": int(ts.day_of_week),
        "soc_kwh": float(soc), "soc_percent": 100.0 * soc / CAPACITY, "soc_pct": soc / CAPACITY,
        "preu_actual": float(row["precio_eur_per_kwh"]), "co2_actual": float(row["co2_kg_per_kwh"]),
        "preus_properes_24h": _future(df, i, "precio_eur_per_kwh"),
        "co2_properes_24h": _future(df, i, "co2_kg_per_kwh"),
        "noves_dades_5min": {"ultim_consum_kw": float(prev["load_kw"]), "ultima_solar_kw": float(prev["pv_kw"])},
    }


def simulate(agent, df: pd.DataFrame, penalty: float = VIOLATION_PENALTY) -> Result:
    soc = SOC_INIT
    n = len(df)
    sp = np.zeros(n)
    socs = np.zeros(n)
    viol = 0
    for i in range(n):
        req = float(agent.act(build_obs(df, i, soc)))
        max_c = min(P_MAX, (CAPACITY - soc) / ETA)
        max_d = min(P_MAX, soc * ETA)
        if not np.isfinite(req):
            viol += 1
            req = 0.0
        elif req > max_c + TOL or req < -max_d - TOL:
            viol += 1
            req = float(np.clip(req, -max_d, max_c))
        sp[i] = req
        soc += req * ETA if req >= 0 else req / ETA
        soc = min(max(soc, 0.0), CAPACITY)
        socs[i] = soc
    load, pv = df["load_kw"].values, df["pv_kw"].values
    price, co2 = df["precio_eur_per_kwh"].values, df["co2_kg_per_kwh"].values
    co2_b, cost_b = _grid_metrics(load, pv, np.zeros(n), price, co2)
    co2_a, cost_a = _grid_metrics(load, pv, sp, price, co2)
    d_co2 = 100.0 * (co2_b - co2_a) / co2_b if co2_b else 0.0
    d_cost = 100.0 * (cost_b - cost_a) / cost_b if cost_b else 0.0
    score = max(0.0, 0.7 * d_co2 + 0.3 * d_cost - penalty * viol)
    trace = pd.DataFrame({"setpoint_kw": sp, "soc_kwh": socs}, index=df.index)
    return Result(score, d_co2, d_cost, viol, co2_b, co2_a, cost_b, cost_a, trace)


def load_agent_class(path: str):
    """Import BatteryAgent from a file path (local tooling only, never inside the submitted agent)."""
    spec = importlib.util.spec_from_file_location("agent_under_test", Path(path))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.BatteryAgent
