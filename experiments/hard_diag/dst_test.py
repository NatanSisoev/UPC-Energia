"""Clock-change robustness: drop one hour mid-week (like 02:00 -> 03:00 on the last Sunday of March) and compare the agent
that resets its weekly memory at a 2 h jump (current behaviour) with one that treats 1->3 h gaps as continuous."""
from datetime import timedelta

import numpy as np

import agent_hard.agent as ah
from experiments.hard_diag.common import twin_params, blocks
from sim.simulator import HARD, simulate


class NoReset(ah.BatteryAgent):
    def _observe(self, obs):
        now = self._time(obs)
        if self.prev_time is not None and now - self.prev_time == timedelta(hours=2):
            self.prev_time = now - timedelta(hours=1)
        return super()._observe(obs)


params = twin_params()
df, bl = blocks()
for mo in ("2026-03", "2025-09", "2025-12", "2026-05"):
    d = bl[mo]
    for k in (60, 98):                    # Sunday-ish positions: drop the row at k (hour k-th of the week)
        dd = d.drop(d.index[k])
        a = simulate(ah.BatteryAgent(model=params), d, spec=HARD).score
        b = simulate(ah.BatteryAgent(model=params), dd, spec=HARD).score
        c = simulate(NoReset(model=params), dd, spec=HARD).score
        print(f"{mo} drop row {k} ({d.index[k]}): intact {a:6.3f} | gap, current {b:6.3f} | gap, no-reset {c:6.3f}", flush=True)
