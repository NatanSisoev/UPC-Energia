"""BatteryAgent for HARD MODE (6,000 kWh / +-1,500 kW battery, 12x solar, only 3 known hours of price and CO2).

Every hour the agent
  1. forecasts the next 48 h of price, CO2, campus load and solar production,
  2. turns them into the score weight of one imported kWh, w = 0.7*co2/CO2_base + 0.3*price/COST_base,
     and into a few equally likely scenarios of the net load (load - solar) of every hour,
  3. solves the 48 h plan that minimises the EXPECTED weighted grid import (dynamic programme on the marginal
     value of stored energy) and applies its first hour.

Forecasts (all parameters are fitted on data/train only and stored in model.json, see experiments/hard/build_model.py):
  * price, CO2, load:  month x day-type x hour profile  +  a linear correction from what the agent has measured in
    the current week (last residual, mean residual of the last 24 h, residual at the same hour of the previous day);
  * solar:  clear-sky production from the sun's position (so it is right at the end of the month, in November and
    across the daylight-saving change)  x  clearness index, which persists from the last measured hours.

Why scenarios: energy sent to the grid is worth nothing. Discharging more than the campus really consumes, or
charging more than the real solar surplus, is paid in full, and the real consumption of the hour is not known when
the setpoint is chosen. Planning on the expected cost over the forecast-error distribution makes the agent hold
back exactly as much as that risk is worth.

Only numpy + stdlib (json, math, datetime, pathlib). Every return goes through the physical clamp: 0 infractions.
"""
import json
import math
from datetime import date, datetime, timedelta
from pathlib import Path

import numpy as np

try:                                                  # optional: gradient-boosted residual forecasters (see _lgb_apply)
    import lightgbm as _lgb
except Exception:                                     # no lightgbm: the linear corrections are used
    _lgb = None

ETA = 0.9 ** 0.5              # one-way efficiency (90 % round trip)
EPS = 1e-4                     # safety margin of the clamp (kW)
CAP_DEFAULT, P_DEFAULT = 6000.0, 1500.0
HORIZON = 48                   # hours planned ahead
N_GRID = 241                   # state-of-charge grid of the planner (25 kWh steps)
RUN_HOURS = 2016               # length of the evaluation (12 blocks of 7 days)
ALPHA_CO2, BETA_COST = 0.70, 0.30
LAT, LON = math.radians(41.39), 2.11     # Campus Nord, Barcelona
MIN_LOAD_KW = 50.0             # a lower reading is a meter outage, not a measurement
CS_MIN_KW = 40.0               # clearness index is only defined when the clear-sky production exceeds this
LEAD_BUCKET = np.array([0, 1, 2] + [3] * 3 + [4] * 6 + [5] * 12 + [6] * 200)   # error table row of each lead
DAYPART = np.array([0] * 7 + [1] * 12 + [2] * 5)                                  # night / working hours / evening
CS_BINS = np.array([1.0, 400.0, 900.0, 1400.0])                                  # error table column (kW)


# ---------------------------------------------------------------------------------------------------------------
# Calendar knowledge that is published in advance (NOT learnt from the hidden days): Spanish / Catalan / Barcelona
# holidays of the evaluation year and the non-teaching periods of the UPC academic calendar 2025-26
# (Christmas 29 Dec-5 Jan, Holy Week 30 Mar-6 Apr, summer 3-31 Aug). Enabled by model["calendar"] = 1.
NATIONAL_HOLIDAYS = {date(2025, 10, 12), date(2025, 11, 1), date(2025, 12, 6), date(2025, 12, 8), date(2025, 12, 25),
                     date(2026, 1, 1), date(2026, 1, 6), date(2026, 4, 3), date(2026, 5, 1), date(2026, 8, 15)}
REGIONAL_HOLIDAYS = {date(2025, 9, 11), date(2025, 9, 24), date(2025, 12, 26), date(2026, 4, 6), date(2026, 5, 25),
                     date(2026, 6, 24), date(2026, 9, 11), date(2026, 9, 24)}     # Catalonia + Barcelona local days
CLOSURES = (("xmas", date(2025, 12, 29), date(2026, 1, 5)), ("easter", date(2026, 3, 30), date(2026, 4, 6)),
            ("summer", date(2026, 8, 3), date(2026, 8, 31)))
REDUCED_DAYS = {date(2025, 12, 24)}                                              # Christmas Eve: campus half empty
_DAY_CACHE = {}
_CAL_CACHE = {}


def day_info(d):
    """Calendar class of a date -> (load type, market type, holiday class).
    load type   0 working day, 1 Saturday, 2 Sunday / holiday, 3 closure or reduced weekday (non-teaching period)
    market type 0 weekday, 1 Saturday, 2 Sunday or NATIONAL holiday (regional/local holidays are ordinary market days)
    holiday class 0 working day, 1 weekend, 2 national holiday, 3 regional holiday, 4 closure weekday"""
    out = _DAY_CACHE.get(d)
    if out is None:
        wd = d.weekday()
        national, regional = d in NATIONAL_HOLIDAYS, d in REGIONAL_HOLIDAYS
        closed = d in REDUCED_DAYS or any(a <= d <= b for _, a, b in CLOSURES)
        if wd == 6 or ((national or regional) and wd < 5):
            lt = 2
        elif wd == 5:
            lt = 1
        else:
            lt = 3 if closed else 0
        mt = 2 if (wd == 6 or (national and wd < 5)) else (1 if wd == 5 else 0)
        hc = 1 if wd >= 5 else 2 if national else 3 if regional else 4 if lt == 3 else 0
        out = _DAY_CACHE[d] = (lt, mt, hc)
    return out


def closure_period(d):
    """Name of the closure period a date belongs to (None outside closures)."""
    return "xmas" if d == date(2025, 12, 24) else next((n for n, a, b in CLOSURES if a <= d <= b), None)


def calendar_features(d):
    """Extra booster features of a date: holiday class, bridge flag, days to the next / since the last day off."""
    out = _CAL_CACHE.get(d)
    if out is None:
        out = _CAL_CACHE[d] = _calendar_features(d)
    return out


def _calendar_features(d):
    lt = day_info(d)[0]
    hc = day_info(d)[2]
    bridge = 0.0
    if lt == 0:                                                   # working day squeezed between a weekday holiday and the weekend
        wd = d.weekday()
        hol = lambda k: day_info(d + timedelta(days=k))[0] == 2 and (d + timedelta(days=k)).weekday() < 5
        bridge = float((wd == 4 and hol(-1)) or (wd == 0 and hol(1)))
    to_off = next((k for k in range(1, 8) if day_info(d + timedelta(days=k))[0] != 0), 8)
    since_off = next((k for k in range(1, 8) if day_info(d - timedelta(days=k))[0] != 0), 8)
    return float(hc), bridge, float(to_off), float(since_off)


def _last_sunday(year, month):
    d = datetime(year, month, 31 if month in (3, 10) else 30)
    return d - timedelta(days=(d.weekday() + 1) % 7)


def _is_summer_time(t):
    """Spanish daylight-saving time (the timestamps are local clock time)."""
    return _last_sunday(t.year, 3) + timedelta(hours=2) <= t < _last_sunday(t.year, 10) + timedelta(hours=3)


def sun_vector(day_of_year, clock_hour, summer_time):
    """Unit vector towards the sun (east, north, up) at local clock time `clock_hour` (may be fractional)."""
    utc = clock_hour - np.where(summer_time, 2.0, 1.0)
    b = 2 * np.pi * (day_of_year - 81) / 364.0
    eq_time = 9.87 * np.sin(2 * b) - 7.53 * np.cos(b) - 1.5 * np.sin(b)                  # minutes
    decl = np.radians(23.44) * np.sin(2 * np.pi * (284 + day_of_year) / 365.0)
    omega = np.radians(15.0 * (utc + LON / 15.0 + eq_time / 60.0 - 12.0))                # hour angle
    up = math.sin(LAT) * np.sin(decl) + math.cos(LAT) * np.cos(decl) * np.cos(omega)
    east = -np.cos(decl) * np.sin(omega)
    north = math.cos(LAT) * np.sin(decl) - math.sin(LAT) * np.cos(decl) * np.cos(omega)
    return east, north, up


def clear_sky_basis(day_of_year, hour, summer_time, haze):
    """Hourly mean of (east, north, up) x atmospheric transmittance: clear-sky kW = max(0, basis . coefficients)."""
    out = np.zeros((3,) + np.shape(day_of_year))
    for minute in (7.5, 22.5, 37.5, 52.5):
        e, n, u = sun_vector(day_of_year, hour + minute / 60.0, summer_time)
        t = np.where(u > 0.02, np.exp(-haze * (1.0 / np.maximum(u, 0.02) - 1.0)), 0.0)
        out[0] += 0.25 * e * t
        out[1] += 0.25 * n * t
        out[2] += 0.25 * u * t
    return out


class BatteryAgent:
    def __init__(self, model=None):
        """`model`: parameter dict (experiments only). The server calls BatteryAgent() -> model.json beside this file."""
        if model is None:
            model = json.loads((Path(__file__).parent / "model.json").read_text(encoding="utf-8"))
        self.m = {k: np.asarray(model[k], dtype=float) for k in
                  ("price_prof", "co2_prof", "load_prof", "sun", "haze", "kbar", "err", "co2_rate", "cost_rate")}
        self.coef = {s: {r: np.asarray(c, dtype=float) for r, c in d.items()} for s, d in model["coef"].items()}
        self.lgb = self._load_lgb(model)              # None -> linear corrections only (the validated fallback)
        if self.lgb is not None and "err_lgb" in model:   # the boosted forecasts have their own error scenarios
            self.m["err"] = np.asarray(model["err_lgb"], dtype=float)
        self.lgb_w = {s: np.asarray((model.get("lgb_w") or {}).get(s, np.ones(HORIZON)), dtype=float)
                      for s in ("price", "co2", "load", "pv")}   # per-lead shrinkage of the boosted residual
        wm = model.get("wmult")                       # optional: (lead bucket x M) multipliers of the score weight w
        self.wmult = None if wm is None else np.maximum(np.asarray(wm, dtype=float), 0.02)
        self.wmult_pow = float(model.get("wmult_pow", 1.0))
        self.rho = float(model.get("wmult_rho", 0.0))   # share of the price-error variance that persists over the horizon
        self.holidays = set(model.get("holidays", []))
        am = model.get("active_months")                 # optional: only act in these months (1-12); null = all
        self.active_months = None if am is None else {int(x) for x in am}
        self.co2_mult = float(model.get("co2_mult", 1.0))   # tilt of the planner's CO2 weight vs price
        self.calendar = bool(model.get("calendar", 0))  # published calendar (holidays, UPC closures) instead of the list
        self.spread_scale = float(model.get("spread_scale", 1.0))
        self.spread_mode = str(model.get("spread_mode", "lead"))   # "lead": spread grows with the lead; "flat": nowcast spread everywhere
        self.tv = float(model.get("terminal_value", 0.0))          # value of one stored kWh after the horizon (0: empty the battery)
        self.horizon = int(model.get("horizon", HORIZON))          # hours planned ahead (24 tuned = same score, half cost)
        self.n_grid = int(model.get("n_grid", N_GRID))             # SOC grid of the planner (121 tuned: no score loss)
        self.historial = []                           # (timestamp, soc_kwh, setpoint_kw) of every step
        size = RUN_HOURS + self.horizon + 8
        self.val = {s: np.full(size, np.nan) for s in ("price", "co2", "load", "pv", "irr", "tamb", "tpan", "wind")}   # measurements by step
        self.base = {s: np.full(size, np.nan) for s in ("price", "co2", "load", "pv")}   # profile / clear sky
        self.step = -1
        self.block_start = 0                          # step at which the current contiguous week began
        self.block_first = None                       # its timestamp
        self.prev_time = None
        self._month_prev = 0
        self._seen = np.zeros(12)
        self._co2_obs = np.zeros(12)
        self._cost_obs = np.zeros(12)

    # ------------------------------------------------------------------ public API
    def act(self, obs: dict) -> float:
        soc = self._num(obs.get("soc_kwh"), None)
        if soc is None:                               # SOC unknown: idling is the only always-legal action
            return 0.0
        cap = self._num(obs.get("cap_max_kwh"), CAP_DEFAULT)
        pmax = self._num(obs.get("power_max_kw"), P_DEFAULT)
        try:
            consigna = self._decide(obs, min(max(soc, 0.0), cap), cap, pmax)
        except Exception:
            consigna = 0.0
        consigna = self._clamp(consigna, soc, cap, pmax)
        self.historial.append((obs.get("timestamp"), soc, consigna))
        return consigna

    # ------------------------------------------------------------------ decision
    def _decide(self, obs, soc, cap, pmax):
        i, n, cal, known = self._observe(obs)
        if self.active_months is not None and int(cal["month"][0]) + 1 not in self.active_months:
            return 0.0                                                    # probe: idle outside the chosen months
        price, co2, load, pv = self._forecast(i, n, cal, known)
        k_co2, k_cost = self._weights()
        w = k_co2 * self.co2_mult * co2 + k_cost * price                # co2_mult 1 = the score's own weights
        w = np.maximum(w / max(float(np.mean(np.abs(w))), 1e-300), 1e-9)       # only relative values matter
        atoms = (load - pv)[:, None] + self._spread(n, cal)
        wmult = None
        if self.wmult is not None:                                     # relative price-error scenarios by lead
            if self.wmult.ndim == 3:                                   # table also split by daypart of the target hour
                wmult = self.wmult[LEAD_BUCKET[:n], DAYPART[cal["hour"][:n]]] ** self.wmult_pow
            else:
                wmult = self.wmult[LEAD_BUCKET[:n]] ** self.wmult_pow
            wmult[:known] = 1.0                                        # the published hours are certain
        return self._plan(w, atoms, soc, cap, pmax, wmult)

    def _observe(self, obs):
        """Book-keeping of one step: clock, week boundaries, measurements. Returns (step, hours to plan, calendar of
        the next `horizon` hours, number of hours of price/CO2 published by the market)."""
        self.step += 1
        i = self.step
        if i + self.horizon + 4 >= len(self.val["price"]):            # longer run than expected: grow the buffers
            for d in (self.val, self.base):
                for s in d:
                    d[s] = np.concatenate([d[s], np.full(RUN_HOURS, np.nan)])
        now = self._time(obs)
        if self.prev_time is None or now - self.prev_time != timedelta(hours=1):
            self.block_start, self.block_first = i, now               # time jump: a new week begins
        self.prev_time = now

        prices = np.asarray(obs.get("preus_properes_24h", []), dtype=float).ravel()
        co2s = np.asarray(obs.get("co2_properes_24h", []), dtype=float).ravel()
        known = min(len(prices), len(co2s))
        ends_soon = known < 3                                          # lists are only truncated at the very end
        remaining = known if ends_soon else (RUN_HOURS - i if i < RUN_HOURS else self.horizon)
        n = int(max(1, min(self.horizon, remaining)))

        cal = self._calendar(now, self.horizon)
        self._store(i, obs, cal, prices[:known], co2s[:known])
        return i, n, cal, known

    # ------------------------------------------------------------------ calendar
    def _time(self, obs):
        ts = obs.get("timestamp")
        if not isinstance(ts, datetime):                               # pandas Timestamp is a datetime
            try:
                ts = datetime.fromisoformat(str(ts))
            except ValueError:
                ts = None
        if ts is None:                                                 # no usable clock: keep counting hours
            ts = self.prev_time + timedelta(hours=1) if self.prev_time else datetime(2026, 1, 1)
        if getattr(ts, "tzinfo", None) is not None:
            ts = ts.replace(tzinfo=None)
        return datetime(ts.year, ts.month, ts.day, ts.hour)

    def _future_times(self, now, n):
        """Timestamps of the next n simulation steps. The evaluation glues the last 7 days of every month: when the
        current week is one of those blocks, the hour after the end of the month is the first hour of the next one."""
        first = self.block_first
        blocks = first is not None and first.hour == 0 and (first + timedelta(days=7)).day == 1
        out, t = [], now
        for _ in range(n):
            out.append(t)
            t = t + timedelta(hours=1)
            if blocks and t.day == 1 and t.hour == 0:                  # jump to the last 7 days of the new month
                nxt = datetime(t.year + (t.month == 12), t.month % 12 + 1, 1)
                t = nxt - timedelta(days=7)
        return out

    def _calendar(self, now, n):
        times = self._future_times(now, n)
        month = np.array([t.month - 1 for t in times])
        hour = np.array([t.hour for t in times])
        wd = np.array([t.weekday() for t in times])
        daytype = np.where(wd < 5, 0, wd - 4)                          # 0 working day, 1 Saturday, 2 Sunday
        doy = np.array([t.timetuple().tm_yday for t in times], dtype=float)
        summer = np.array([_is_summer_time(t) for t in times])
        basis = clear_sky_basis(doy, hour.astype(float), summer, float(self.m["haze"]))
        clear = np.maximum(np.tensordot(self.m["sun"], basis, axes=1), 0.0)
        if self.calendar:                                              # published calendar replaces the holiday list
            info = [day_info(t.date()) for t in times]
            cf = np.array([calendar_features(t.date()) for t in times])
            return {"month": month, "hour": hour, "daytype": np.array([x[1] for x in info]),   # market type
                    "loadtype": np.array([x[0] for x in info]), "clear": clear,
                    "hol_cls": cf[:, 0], "bridge": cf[:, 1], "to_off": cf[:, 2], "since_off": cf[:, 3]}
        holiday = np.array([t.strftime("%Y-%m-%d") in self.holidays for t in times])
        return {"month": month, "hour": hour, "daytype": daytype, "loadtype": np.where(holiday, 2, daytype),
                "clear": clear}

    # ------------------------------------------------------------------ memory
    def _store(self, i, obs, cal, prices, co2s):
        m, h = cal["month"], cal["hour"]
        k = len(cal["hour"])
        self.base["price"][i:i + k] = self.m["price_prof"][m, cal["daytype"], h]
        self.base["co2"][i:i + k] = self.m["co2_prof"][m, cal["daytype"], h]
        self.base["load"][i:i + k] = self.m["load_prof"][m, cal["loadtype"], h]
        self.base["pv"][i:i + k] = cal["clear"]
        self.val["price"][i:i + len(prices)] = prices
        self.val["co2"][i:i + len(co2s)] = co2s
        if not np.isfinite(self.val["price"][i]):
            self.val["price"][i] = self._num(obs.get("preu_actual"), np.nan)
        if not np.isfinite(self.val["co2"][i]):
            self.val["co2"][i] = self._num(obs.get("co2_actual"), np.nan)
        tele = obs.get("noves_dades_5min") or {}
        if i > 0:                                                      # weather of the hour that has just ended
            for key, s in (("irradiancia_wm2", "irr"), ("temp_ambient_c", "tamb"), ("temp_panel_c", "tpan"), ("vent_ms", "wind")):
                self.val[s][i - 1] = self._num(tele.get(key), np.nan)
        load = self._num(tele.get("ultim_consum_kw"), np.nan)
        pv = self._num(tele.get("ultima_solar_kw"), np.nan)
        if i > 0 and np.isfinite(load) and load >= MIN_LOAD_KW:        # telemetry = the hour that has just ended
            self.val["load"][i - 1] = load
            self.val["pv"][i - 1] = max(pv, 0.0) if np.isfinite(pv) else np.nan
            mp = int(self._month_prev)                                 # learn the real no-battery totals as we go
            base = max(load - (pv if np.isfinite(pv) else 0.0), 0.0)
            if np.isfinite(self.val["price"][i - 1]) and np.isfinite(self.val["co2"][i - 1]):
                self._seen[mp] += 1
                self._co2_obs[mp] += base * self.val["co2"][i - 1]
                self._cost_obs[mp] += base * self.val["price"][i - 1]
        self._month_prev = m[0]

    def _weights(self):
        """Score weights of CO2 and price: 0.7 / (no-battery CO2 of the whole run) and 0.3 / (no-battery cost).
        Totals = what has been measured so far + the train-set rate of every month for the hours still to come."""
        left = np.maximum(RUN_HOURS / 12.0 - self._seen, 0.0)
        co2_base = float(np.sum(self._co2_obs + left * self.m["co2_rate"]))
        cost_base = float(np.sum(self._cost_obs + left * self.m["cost_rate"]))
        return ALPHA_CO2 / max(co2_base, 1e-9), BETA_COST / max(cost_base, 1e-9)

    # ------------------------------------------------------------------ forecasts
    def _features(self, i, n, cal, known):
        """Everything the linear forecasters use, for the n hours starting now (also used to fit them)."""
        b0 = self.block_start
        out = {}
        for s in ("price", "co2", "load"):
            last = i + known - 1 if s != "load" else i - 1            # newest step with a measurement
            res = self.val[s] - self.base[s]
            lo = max(b0, last - 23)
            recent = res[lo:last + 1] if last >= lo else res[:0]
            recent = recent[np.isfinite(recent)]
            f1 = res[last] if last >= b0 and np.isfinite(res[last]) else np.nan
            f2 = float(recent.mean()) if len(recent) else np.nan
            if not np.isfinite(f1):
                f1 = f2                                                # outage in the last hour: use the day's mean
            target = np.arange(i, i + n)
            back = np.maximum(np.ceil((target - last) / 24.0), 1.0).astype(int)
            src = target - 24 * back                                   # newest measured step with the same hour
            ok = src >= b0
            f3 = np.where(ok, res[np.maximum(src, 0)], np.nan)
            out[s] = (self.base[s][i:i + n].copy(), f1, f2, f3)
        clear = self.base["pv"]
        lo = max(b0, i - 24)
        cs, pv = clear[lo:i], self.val["pv"][lo:i]
        day = np.isfinite(pv) & (cs > CS_MIN_KW)
        kbar = self.m["kbar"][cal["month"][:n]]
        k_day = float(pv[day].sum() / cs[day].sum()) if day.sum() >= 3 else np.nan
        k_last = float(pv[-1] / cs[-1]) if len(pv) and day[-1] else np.nan
        out["pv"] = (clear[i:i + n].copy(), kbar, k_last, k_day)
        return out

    def _forecast(self, i, n, cal, known):
        f = self._features(i, n, cal, known)
        res = {}
        for s in ("price", "co2", "load"):
            base, f1, f2, f3 = f[s]
            pred = base.copy()
            if np.isfinite(f1) and np.isfinite(f2):
                ca, cb = self.coef[s]["A"][:n], self.coef[s]["B"][:n]
                full = np.isfinite(f3)
                pred += np.where(full, ca[:, 0] * f1 + ca[:, 1] * f2 + ca[:, 2] * np.nan_to_num(f3),
                                 cb[:, 0] * f1 + cb[:, 1] * f2)
            res[s] = pred
        for s in ("price", "co2"):                                     # the first hours are published by the market
            res[s][:known] = self.val[s][i:i + min(known, n)]
            res[s] = np.maximum(np.where(np.isfinite(res[s]), res[s], f[s][0]), 0.0)
        res["load"] = np.maximum(res["load"], 0.0)

        clear, kbar, k_last, k_day = f["pv"]
        k = kbar.copy()
        if np.isfinite(k_last):
            ca = self.coef["pv"]["A"][:n]
            k += ca[:, 0] * (k_last - kbar[0]) + ca[:, 1] * ((k_day if np.isfinite(k_day) else k_last) - kbar[0])
        elif np.isfinite(k_day):
            k += self.coef["pv"]["B"][:n, 0] * (k_day - kbar[0])
        res["pv"] = np.clip(k, 0.0, 1.15) * clear
        if self.lgb is not None:
            try:
                self._lgb_apply(i, n, cal, known, f, res)
            except Exception:                                          # any failure: keep the linear forecast
                pass
        return res["price"], res["co2"], res["load"], res["pv"]

    # ------------------------------------------------------------------ boosted residual forecasters (optional)
    @staticmethod
    def _load_lgb(model):
        """Boosters stored as text beside this file (lgb_price/co2/load/pv.txt), enabled by model["lgb"] = true.
        Returns {series: Booster} or None when disabled / lightgbm or a file is missing."""
        if _lgb is None or not model.get("lgb"):
            return None
        try:
            folder = Path(model["lgb_dir"]) if model.get("lgb_dir") else Path(__file__).parent
            out = {s: _lgb.Booster(model_str=(folder / f"lgb_{s}.txt").read_text(encoding="utf-8"))
                   for s in ("price", "co2", "load", "pv")}
            return out
        except Exception:
            return None

    def _lgb_features(self, i, n, cal, known, f, lin):
        """Feature matrix (n leads x F) of each series: calendar, lead, weather of the last hour, what the agent has
        measured this week (the linear model's own features f1/f2/f3) and the linear forecast itself.
        Used both to fit the boosters (experiments/hard/lgb_build.py) and to apply them -> identical by construction."""
        b0 = self.block_start
        lo = max(b0, i - 24)
        nan = float("nan")

        def last(s):
            return float(self.val[s][i - 1]) if i > 0 else nan

        w24 = self.val["tamb"][lo:i]
        w24 = w24[np.isfinite(w24)]
        def mean24(s):
            v = self.val[s][lo:i]
            v = v[np.isfinite(v)]
            return float(v.mean()) if len(v) else nan

        const = [float(cal["hour"][0]), min((i - b0) / 24.0, 7.0), last("tamb"), last("tpan"), last("irr"),
                 float(w24.mean()) if len(w24) else nan]
        for s in ("price", "co2", "load"):
            const += [f[s][1], f[s][2]]
        const += [f["pv"][2], f["pv"][3]]
        common = [np.arange(n, dtype=float), cal["hour"][:n].astype(float), cal["month"][:n].astype(float),
                  cal["loadtype"][:n].astype(float), f["pv"][1][:n], cal["clear"][:n]]
        common += [np.full(n, c, dtype=float) for c in const]
        if self.calendar:                                              # published-calendar features of the target hour
            common += [cal["hol_cls"][:n], cal["bridge"][:n], cal["to_off"][:n], cal["since_off"][:n]]
        out = {}
        wx = [last("wind"), mean24("wind"), mean24("irr"), mean24("tpan")]
        wx = [np.full(n, c, dtype=float) for c in wx]
        target = np.arange(i, i + n)
        for s in ("price", "co2", "load"):
            last_m = i + known - 1 if s != "load" else i - 1
            src = target - 24 * np.maximum(np.ceil((target - last_m) / 24.0), 1.0).astype(int)
            raw = []                                                   # same hour one and two days earlier (raw level)
            for sh in (0, 24):
                k = src - sh
                raw.append(np.where(k >= b0, self.val[s][np.maximum(k, 0)], nan))
            day = self.val[s][max(b0, last_m - 23):last_m + 1]
            day = day[np.isfinite(day)]
            dmin, dmax, dmean = (float(day.min()), float(day.max()), float(day.mean())) if len(day) else (nan, nan, nan)
            cols = common + [f[s][0][:n], lin[s][:n], f[s][3][:n], lin[s][:n] - f[s][0][:n]] + wx + raw                 + [np.full(n, v) for v in (dmin, dmax, dmean)]
            out[s] = np.column_stack(cols)
        cols = common + [lin["pv"][:n], lin["pv"][:n] / np.maximum(cal["clear"][:n], 1.0)] + wx
        out["pv"] = np.column_stack(cols)
        return out

    def _lgb_apply(self, i, n, cal, known, f, res):
        """Adds the boosted residual to the linear forecasts (market series only after the published hours)."""
        X = self._lgb_features(i, n, cal, known, f, res)
        d = {s: np.asarray(self.lgb[s].predict(X[s], num_threads=1), dtype=float) * self.lgb_w[s][:n] for s in X}
        for s in ("price", "co2"):
            d[s][:known] = 0.0
        new = {"price": np.maximum(res["price"] + d["price"], 0.0), "co2": np.maximum(res["co2"] + d["co2"], 0.0),
               "load": np.maximum(res["load"] + d["load"], 0.0),
               "pv": np.clip(res["pv"] + d["pv"], 0.0, 1.15 * cal["clear"][:n])}
        if all(np.all(np.isfinite(v)) for v in new.values()):
            res.update(new)

    def _spread(self, n, cal):
        """Forecast-error scenarios of the net load, kW: (n hours, K equally likely scenarios)."""
        bucket = LEAD_BUCKET[:n] if self.spread_mode == "lead" else np.zeros(n, dtype=int)
        col = np.searchsorted(CS_BINS, cal["clear"][:n])
        if self.m["err"].ndim == 4:                                    # table also split by daypart x working day
            ctx = DAYPART[cal["hour"][:n]] * 2 + (cal["loadtype"][:n] > 0)
            return self.m["err"][bucket, col, ctx] * self.spread_scale
        return self.m["err"][bucket, col] * self.spread_scale

    # ------------------------------------------------------------------ planner
    def _value(self, w, atoms, grid, pmax, wmult):
        """Backward pass: q(s) = marginal value of one stored kWh at state of charge s (see _plan)."""
        up, down = pmax * ETA, pmax / ETA
        T = len(w)
        rank = np.arange(atoms.shape[1]) / atoms.shape[1]
        # everything that does not depend on the value function, for all hours at once
        p = np.sort(np.clip(-atoms, -pmax, pmax), axis=1)              # setpoint at which each scenario stops importing
        charging = p > 0
        col = lambda v: np.full((T, 1), v)
        shifts = np.concatenate((col(-down), np.where(charging, p * ETA, p / ETA), col(0.0), col(up)), axis=1)
        levels = np.concatenate((col(-np.inf), w[:, None] * rank[None, :] * np.where(charging, 1.0 / ETA, ETA),
                                 (w * ETA * np.mean(atoms > 0, axis=1))[:, None],
                                 (w / ETA * np.mean(atoms > -pmax, axis=1))[:, None]), axis=1)
        q = np.full(self.n_grid, -self.tv)      # value of stored energy after the horizon (0: nothing is worth storing)
        for t in range(T - 1, 0, -1):
            g = np.interp(grid[None, :] + shifts[t][:, None], grid, q, left=np.inf, right=-np.inf)
            if wmult is None:
                q = np.min(np.maximum(g, levels[t][:, None]), axis=0)
            else:                                                      # price of hour t is random: average over scenarios
                lv = levels[t][None, :, None] * wmult[t][:, None, None]          # (scenarios, steps, 1), batched
                q = np.min(np.maximum(g[None], lv), axis=1).mean(axis=0)
        return -np.concatenate(([0.0], np.cumsum(0.5 * (q[1:] + q[:-1]) * np.diff(grid))))   # cost-to-go(s) + const

    def _plan(self, w, atoms, soc, cap, pmax, wmult=None):
        """Minimises  sum_t w_t * E[max(net_t + p_t, 0)]  over the setpoints p_t (battery limits and efficiency)
        and returns p_0.  q(s) = marginal value of one stored kWh at state of charge s, propagated backwards:
        the expected marginal cost of a setpoint is a staircase (one step per scenario), and q of the previous
        hour is where that staircase crosses q of the next one (min over the steps of max(q shifted, step level)).
        wmult (n x M): relative price-error scenarios of every hour. They are split into a persistent part
        (rho of the variance: one price level for the whole horizon, 3 Gauss-Hermite nodes, one backward pass each,
        averaged -> only the first decision is shared) and an hourly innovation (recourse inside each pass)."""
        grid = np.linspace(0.0, cap, self.n_grid)
        if wmult is None or self.rho <= 0.0:
            future = self._value(w, atoms, grid, pmax, wmult)
        else:
            dev = wmult - 1.0
            sig = np.std(dev, axis=1, keepdims=True)
            local = 1.0 + np.sqrt(1.0 - self.rho) * dev
            future = 0.0
            for c, pg in zip((-math.sqrt(3.0), 0.0, math.sqrt(3.0)), (1 / 6, 2 / 3, 1 / 6)):
                lvl = 1.0 + math.sqrt(self.rho) * c * sig                 # (n, 1) persistent level of this node
                future = future + pg * self._value(w, atoms, grid, pmax, np.maximum(local * lvl, 0.02))
        max_c = max(0.0, min(pmax, (cap - soc) / ETA - EPS))
        max_d = max(0.0, min(pmax, soc * ETA - EPS))
        cand = np.unique(np.concatenate((np.linspace(-max_d, max_c, 301), np.clip(-atoms[0], -max_d, max_c), [0.0])))
        soc_next = soc + np.where(cand >= 0, cand * ETA, cand / ETA)
        cost = w[0] * np.mean(np.maximum(atoms[0][None, :] + cand[:, None], 0.0), axis=1)             + np.interp(soc_next, grid, future)
        best = cand[cost <= cost.min() + 1e-9]
        return float(best[np.argmin(np.abs(best))])                    # among equals, the gentlest setpoint

    # ------------------------------------------------------------------ safety
    @staticmethod
    def _num(x, default):
        try:
            x = float(x)
        except (TypeError, ValueError):
            return default
        return x if np.isfinite(x) else default

    @staticmethod
    def _clamp(consigna, soc_kwh, cap, pmax):
        """Physical limits of this hour: never more than the battery can take or give -> 0 infractions."""
        if not np.isfinite(consigna):
            consigna = 0.0
        max_carrega = max(0.0, min(pmax, max(0.0, cap - soc_kwh) / ETA - EPS))
        max_descarrega = max(0.0, min(pmax, max(0.0, soc_kwh) * ETA - EPS))
        return float(max(-max_descarrega, min(max_carrega, consigna)))
