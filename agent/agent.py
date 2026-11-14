"""
agent.py - BatteryAgent for the UPC Sostenible battery challenge (Datathon FME 2026).

STRATEGY: exact 24 h look-ahead optimisation, re-solved every hour (MPC). No ML model in the loop.

Why this is the right tool (evidence: experiments/mpc/, experiments/oracle/, docs/HANDOFF.md):
  * Score = 0.7*dCO2% + 0.3*dCost%, both relative to the same campus without battery. So every kWh the campus
    imports in hour t costs
        w_t = 0.7 * co2_t / CO2_base + 0.3 * price_t / COST_base        (score units per kWh)
    where CO2_base / COST_base are the no-battery totals of the whole evaluation.
  * Campus net load (demand - solar) is practically always above the battery's 500 kW, so the battery never
    pushes the grid into export and the score is LINEAR in the setpoint: pure energy arbitrage on w_t.
  * w_t is known for the next 24 h (price and CO2 lists in obs). A 2,000 kWh / 500 kW battery fills or empties
    in ~4 h, so the best action now only depends on w up to the next time the battery is full or empty, which is
    well inside 24 h. Re-planning every hour therefore reproduces the perfect-foresight optimum (99.85 % of the
    LP bound on the train year; the rest is two meter outages nobody can foresee) - demand/solar are only
    needed for a safety guard, not forecast.

Each act():  blended signal w for the known window -> dynamic programme on the marginal value of stored energy
(exact for this linear problem, ~1 ms, checked against a HiGHS LP in tests/) -> first action -> safety clamp
(0 infractions guaranteed).

Only numpy is imported. No file, network or system access.
"""
import numpy as np

# ---- battery physics (official battery_spec.json) -------------------------------------------------------------
CAPACITY = 2000.0          # kWh
P_MAX = 500.0              # kW
ETA = 0.9 ** 0.5           # one-way efficiency (90 % round trip)
EPS = 1e-4                 # safety margin of the clamp (kW)
SOC_STEP = 1.0             # kWh, resolution of the planner's state-of-charge grid

# ---- score normalisation ---------------------------------------------------------------------------------------
# Baseline (no battery) CO2 [kg/h] and cost [EUR/h] of the campus by calendar month (Jan..Dec), measured on the
# train weeks (November has no meter data: its price/CO2 x the typical hour-of-week load). Only the RATIO of the
# two totals matters for the decisions; these priors are replaced by what the agent observes as the run goes on.
CO2_RATE = (93.56, 54.34, 71.65, 65.98, 74.95, 89.20, 130.55, 93.42, 95.56, 126.17, 94.96, 114.56)
COST_RATE = (162.86, 127.67, 156.79, 121.46, 123.80, 161.47, 230.73, 155.91, 157.77, 169.00, 148.64, 167.68)
HOURS_PER_MONTH = 168      # the evaluation contains one 7-day block per calendar month
ALPHA_CO2, BETA_COST = 0.70, 0.30

# ---- export guard ----------------------------------------------------------------------------------------------
NET_MARGIN_KW = 50.0       # discharge at most (last measured net load - margin): exported energy is worth nothing


class BatteryAgent:
    def __init__(self):
        self.historial = []                      # (timestamp, soc_kwh, setpoint_kw) of every step, for auditing
        self._grid = np.arange(0.0, CAPACITY + 0.5 * SOC_STEP, SOC_STEP)
        self._err_now = 0.0                      # evidence against "forecast lists start at the current hour"
        self._err_next = 0.0                     # evidence against "forecast lists start at the next hour"
        self._last_head = None                   # first (price, co2) of the previous step's lists
        self._prev = None                        # (month index, price, co2) of the previous hour
        self._seen = [0] * 12                    # hours observed per calendar month
        self._co2_obs = [0.0] * 12               # observed baseline CO2 per calendar month (kg)
        self._cost_obs = [0.0] * 12              # observed baseline cost per calendar month (EUR)

    # ------------------------------------------------------------------------------------------------------------
    def act(self, obs: dict) -> float:
        """Return the battery setpoint in kW: > 0 charge, < 0 discharge."""
        soc = self._num(obs.get("soc_kwh"), None)
        if soc is None:                          # state of charge unknown: idling is the only always-legal action
            return 0.0
        try:
            consigna = self._decide(obs, min(max(soc, 0.0), CAPACITY))
        except Exception:                        # never let a malformed observation break the simulation: idle
            consigna = 0.0
        consigna = self._clamp(consigna, soc)
        self.historial.append((obs.get("timestamp"), soc, consigna))
        return consigna

    # ------------------------------------------------------------------------------------------------------------
    def _decide(self, obs: dict, soc: float) -> float:
        price_now = self._num(obs.get("preu_actual"), 0.0)
        co2_now = self._num(obs.get("co2_actual"), 0.0)
        prices = np.nan_to_num(np.asarray(obs.get("preus_properes_24h", []), dtype=float).ravel())
        co2s = np.nan_to_num(np.asarray(obs.get("co2_properes_24h", []), dtype=float).ravel())
        n = min(len(prices), len(co2s))
        prices, co2s = prices[:n], co2s[:n]

        # The official environment starts both lists at the CURRENT hour (element 0 == preu_actual / co2_actual)
        # and truncates them when the simulation is about to end. Reading them one hour off costs ~45 % of the
        # score, so the alignment is verified against the data instead of assumed: if the lists turn out to start
        # at the next hour, the current hour is prepended so that index 0 of the window is always "now".
        if not self._lists_start_now(prices, co2s, price_now, co2_now) or n == 0:
            prices = np.concatenate([[price_now], prices])
            co2s = np.concatenate([[co2_now], co2s])

        net_last = self._learn(obs, price_now, co2_now)
        k_co2, k_cost = self._weights()
        w = k_co2 * co2s + k_cost * prices
        w = np.maximum(w / max(float(np.mean(np.abs(w))), 1e-300), 1e-9)   # only relative values matter

        # Never discharge more than the campus is expected to consume this hour (battery export earns nothing).
        dis_cap = P_MAX if net_last is None else min(max(net_last - NET_MARGIN_KW, 0.0), P_MAX)
        return self._plan(w, soc, dis_cap)

    # ------------------------------------------------------------------------------------------------------------
    def _lists_start_now(self, prices, co2s, price_now: float, co2_now: float) -> bool:
        """Do the 24 h lists start at the current hour (official environment) or at the next one?
        Two accumulated mismatches decide: element 0 vs the current values (zero if the lists start now) and the
        PREVIOUS step's element 0 vs the current values (zero if they start one hour ahead). Consecutive hours
        never share both price and CO2, so the wrong hypothesis accumulates error from the first step."""
        def rel(a, b):
            return abs(a - b) / max(abs(b), 1e-9)

        if len(prices):
            self._err_now += max(rel(prices[0], price_now), rel(co2s[0], co2_now))
        if self._last_head is not None:
            self._err_next += max(rel(self._last_head[0], price_now), rel(self._last_head[1], co2_now))
        self._last_head = (prices[0], co2s[0]) if len(prices) else None
        return self._err_now <= self._err_next + 1e-3

    def _learn(self, obs: dict, price_now: float, co2_now: float):
        """Use the telemetry of the hour that just ended: returns its net load (kW) and updates the running
        no-battery CO2 / cost totals that normalise the two score terms."""
        tele = obs.get("noves_dades_5min") or {}
        load = self._num(tele.get("ultim_consum_kw"), None)
        solar = self._num(tele.get("ultima_solar_kw"), 0.0)
        net_last = None if load is None else load - solar
        if self._prev is not None and net_last is not None:
            m, price_prev, co2_prev = self._prev
            base = max(net_last, 0.0)                                  # baseline import of the previous hour
            self._seen[m] += 1
            self._co2_obs[m] += base * co2_prev
            self._cost_obs[m] += base * price_prev
        month = self._num(getattr(obs.get("timestamp"), "month", None), None)
        known_month = month is not None and 1 <= month <= 12
        self._prev = (int(month) - 1, price_now, co2_now) if known_month else None
        return net_last

    def _weights(self):
        """Score weight of 1 kg CO2 and of 1 EUR: 0.7 / CO2_base and 0.3 / COST_base, where each base is what has
        been observed so far plus the monthly prior for the hours still to come."""
        co2_base = cost_base = 0.0
        for m in range(12):
            left = max(HOURS_PER_MONTH - self._seen[m], 0)
            co2_base += self._co2_obs[m] + left * CO2_RATE[m]
            cost_base += self._cost_obs[m] + left * COST_RATE[m]
        return ALPHA_CO2 / max(co2_base, 1e-9), BETA_COST / max(cost_base, 1e-9)

    # ------------------------------------------------------------------------------------------------------------
    def _plan(self, w: np.ndarray, soc: float, dis_cap: float) -> float:
        """Optimal first setpoint for the window w[0..n-1] (w[0] = now), i.e. the solution of the LP

            min sum_t w_t * p_t    s.t.  |p_t| <= 500,  0 <= soc_t <= 2000,
                                         soc_t = soc_{t-1} + eta * p_t (charging)  or  + p_t / eta (discharging)

        by dynamic programming on the MARGINAL VALUE of stored energy. Let q_t(s) be the value (score units per
        kWh) of one more stored kWh at the start of hour t with state of charge s; it decreases with s. Storing a
        kWh in hour t costs w_t/eta, releasing one earns w_t*eta, and one hour moves the SOC by at most
        UP = 500*eta or DOWN = 500/eta kWh. Backwards from q_end = 0 (energy left at the end is worthless):

            q_t(s) = min( q_{t+1}(s - DOWN),  max( q_{t+1}(s + UP),  clip(q_{t+1}(s), w_t*eta, w_t/eta) ) )

        i.e. keep charging at full power while the kWh is worth more than it costs, else charge until it is worth
        exactly w_t/eta, else idle, and symmetrically for discharging (q = +inf below empty, -inf above full).
        The first action then moves the real SOC to where q_1 crosses today's buy / sell thresholds.
        No terminal value is needed: with a 24 h window the first action is already the perfect-foresight one,
        and when the simulation is about to end (truncated window) emptying the battery is exactly right."""
        grid = self._grid
        up, down = P_MAX * ETA, P_MAX / ETA
        q = np.zeros(len(grid))
        for t in range(len(w) - 1, 0, -1):
            q_up = np.interp(grid + up, grid, q, right=-np.inf)
            q_down = np.interp(grid - down, grid, q, left=np.inf)
            q = np.minimum(q_down, np.maximum(q_up, np.clip(q, w[t] * ETA, w[t] / ETA)))
        buy_until = self._crossing(grid, q, w[0] / ETA)                # charging pays while q_1(s') > w_0/eta
        sell_until = self._crossing(grid, q, w[0] * ETA)               # discharging pays while q_1(s') < w_0*eta
        if buy_until > soc:
            return (min(buy_until, soc + up) - soc) / ETA
        if sell_until < soc:
            return (max(sell_until, soc - min(dis_cap, P_MAX) / ETA) - soc) * ETA
        return 0.0

    @staticmethod
    def _crossing(grid: np.ndarray, q: np.ndarray, level: float) -> float:
        """SOC at which the decreasing curve q(s) falls to `level` (0 if it starts below, full if it never does)."""
        k = int(np.count_nonzero(q > level))                           # q[k-1] > level >= q[k]
        if k == 0:
            return float(grid[0])
        if k == len(grid):
            return float(grid[-1])
        return float(grid[k - 1] + (grid[k] - grid[k - 1]) * (q[k - 1] - level) / (q[k - 1] - q[k]))

    # ------------------------------------------------------------------------------------------------------------
    @staticmethod
    def _num(x, default):
        """float(x) if it is a finite number, else default."""
        try:
            x = float(x)
        except (TypeError, ValueError):
            return default
        return x if np.isfinite(x) else default

    @staticmethod
    def _clamp(consigna: float, soc_kwh: float) -> float:
        """Safety clamp: guarantees 0 clipping infractions (capacity 2000 kWh, +-500 kW, eta = sqrt(0.9))."""
        if not np.isfinite(consigna):
            consigna = 0.0
        max_carrega = max(0.0, min(P_MAX, max(0.0, CAPACITY - soc_kwh) / ETA - EPS))
        max_descarrega = max(0.0, min(P_MAX, max(0.0, soc_kwh) * ETA - EPS))
        return float(max(-max_descarrega, min(max_carrega, consigna)))
