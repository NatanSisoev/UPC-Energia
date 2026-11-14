"""
agent.py
Baseline BatteryAgent = official UPC Sostenible template heuristic + the mandatory safety clamp.
Datathon 2026. This file must ALWAYS stay submittable on main (see WORKFLOW.md).

Rules: no os/sys/subprocess/socket/urllib/requests/inspect, no eval/exec. Models: Path(__file__).parent / "model.pkl".
"""
# from pathlib import Path
# import joblib


class BatteryAgent:
    def __init__(self):
        self.llindar_preu_carrega = 0.08      # EUR/kWh
        self.llindar_preu_descarrega = 0.16   # EUR/kWh
        self.potencia_nominal_kw = 500.0
        self.historial = []                   # past observations (reset short windows if timestamp jumps > 2 h)

    def act(self, obs: dict) -> float:
        """Return battery setpoint in kW: >0 charge, <0 discharge."""
        self.historial.append(obs)
        hora = obs["hour"]
        preu = obs["preu_actual"]
        soc = obs["soc_pct"]
        co2 = obs["co2_actual"]

        consigna = 0.0
        if 1 <= hora <= 6 and preu < self.llindar_preu_carrega and soc < 0.85:
            consigna = 350.0
        elif 11 <= hora <= 15 and preu < 0.10 and soc < 0.95:
            consigna = 250.0
        elif 18 <= hora <= 22 and (preu > self.llindar_preu_descarrega or co2 > 0.10) and soc > 0.15:
            consigna = -450.0

        return self._clamp(consigna, float(obs["soc_kwh"]))

    @staticmethod
    def _clamp(consigna: float, soc_kwh: float) -> float:
        """Safety clamp: guarantees 0 clipping infractions (capacity 2000 kWh, +-500 kW, eta = sqrt(0.9))."""
        eta = 0.9 ** 0.5
        eps = 1e-4
        max_carrega = max(0.0, min(500.0, max(0.0, 2000.0 - soc_kwh) / eta - eps))
        max_descarrega = max(0.0, min(500.0, max(0.0, soc_kwh) * eta - eps))
        return float(max(-max_descarrega, min(max_carrega, consigna)))
