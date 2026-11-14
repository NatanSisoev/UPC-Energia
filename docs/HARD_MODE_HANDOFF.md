# Hard Mode — handoff to the next session

Written Saturday 2026-11-14, ~17:50, by Natan's agent. **Read this whole file before touching anything.**
It replaces the session context: everything known about Hard Mode, what is built, what is not, and the exact plan.

## 0. Where things stand (one paragraph)

Standard mode is finished (leaderboard 6.43 = the ceiling, tied with everyone; see `docs/SOLUTION.md`).
The organisers opened **Hard Mode** with its own leaderboard. For Hard Mode the simulator scenario and the
perfect-foresight bound exist and are tested; the agent (`agent_hard/agent.py`) is **written but has never been run**:
it needs a parameter file `agent_hard/model.json` that does not exist yet. The script that fits those parameters
(`experiments/hard/build_model.py`) is the next thing to write. Nothing has been submitted to the Hard Mode leaderboard.

**Clock:** Hard Mode shift 1 closes Saturday 21:00. Shift 2 is 21:00 → Sunday 08:00, shift 3 is Sunday 08:00 → close.
The site says 10 submissions per shift for Hard Mode (separate from standard); the Discord message said "2 per
4-hour window". Assume the smaller number until the human confirms: every submission must be a real improvement.

## 1. Hard Mode rules (from the site tab "🔥 Mode Difícil" and its code snippet, read 2026-11-14 17:10)

- Battery **6,000 kWh, ±1,500 kW**, efficiency 0.90 round trip (η = √0.9 each way), SOC0 50 % (= 3,000 kWh).
- Solar **× 12** (`pv_kw * 12`, peak ≈ 1,730 kW on train). Midday surplus up to ~1,000 kW; export is worth 0 € and 0 kg.
- `obs["preus_properes_24h"]` and `obs["co2_properes_24h"]` have **length 3: the current hour and the next 2**.
- `obs["noves_dades_5min"]` (readings of hour t−1) also has `irradiancia_wm2`, `temp_ambient_c`, `temp_panel_c`,
  `vent_ms`; `ultima_solar_kw` is already × 12. `obs` also has `"cap_max_kwh": 6000.0` and `"power_max_kw": 1500.0`.
- Time limit 1 minute per simulation. Public leaderboard = 1,008 h (half of the 2,016 h).
- Leaderboard at 17:10: 7 teams, 8 submissions, **record 22.23 points**.
- Official local simulation (the kit's `environment.py` we have does NOT read `forecast_horizon`; ours does):

```python
df_hard = df_campus_hourly.copy(); df_hard["pv_kw"] *= 12.0
spec_hard = {"capacity_kwh": 6000.0, "power_kw": 1500.0, "efficiency": 0.90, "soc_init": 0.50,
             "soc_min": 0.0, "soc_max": 1.0, "dt_hours": 1.0, "forecast_horizon": 3}
env_hard = CampusBatteryEnv(df_hard, spec=spec_hard)
```

- Official clamp for both modes:
  `max_c = max(0, min(p_max, (cap_max - soc)/eta - 1e-4))`, `max_d = max(0, min(p_max, soc*eta - 1e-4))`.
- The official smoke test (`starter_kit/check_submission.py`) calls `act()` with `timestamp` as a **string**, 24-long
  lists, `soc_kwh` 1000 and no `cap_max_kwh`: the agent must survive that (it parses strings, defaults 6000/1500).

## 2. Numbers measured on train (Hard Mode scenario)

| Data (one run each) | Perfect-foresight bound | Standard agent as-is | Template |
|---|---|---|---|
| full train, 5,993 h | **20.67** (CO2 19.6 %, cost 23.2 %) | 3.74 | 1.83 |
| last 7 train days of each month, 1,848 h | **22.40** | 4.37 | 2.26 |
| first 7 days of each month, 1,848 h | **22.52** | 4.04 | 2.02 |

So the leaderboard record (22.23) is already near the ceiling of a test-shaped sample: **the fight is over the last
few percent**, i.e. forecast quality and not wasting energy to export. (In standard mode the hidden test scored ~5 %
above the train-shaped bound; expect a test ceiling around 23–24.)

Data facts that drive the design:
- Hard-mode net load (load − 12·pv) is negative in 9.0 % of hours; 10.2 % of solar energy is surplus; mean no-battery
  import 837 kW. Load mean 1,123 kW; working day ≈ 1,200–1,650 kW by month, Saturday ≈ 800–960, Sunday ≈ 700–890.
- **Timestamps are local clock time with daylight saving** (solar centre of mass at 12.1–12.4 h Nov–Mar, 12.9 h
  Apr–Oct). The DST changes (last Sunday of March and of October) fall inside the hidden test weeks.
- **Holidays look like Sundays** (Sep 11: 835 kW, Dec 8: 764, Jan 1–6: 740–910, Apr 3/6: 811/751, May 1: 819, versus
  ~1,250 on a working day). Test weeks contain Sep 24 (La Mercè), Dec 25–31 (Christmas), May 25 (Whit Monday),
  Jun 24 (Sant Joan). August is low all month (working day ≈ 900).
- Train months run Sep 2025 → Aug 2026, days 1..23/24 of each month. **November has price/CO2 but no load/solar**
  in train (the merged table has 11 months). The test is assumed to be the last 7 days of all 12 months.
- Irradiance and solar are 0.997 correlated hourly (irradiance adds nothing over the solar reading itself).
  `vent_ms` is always 0. Temperature may help the load forecast (not used yet).
- Meter outages read load = pv = 0 (treat load < 50 kW as "no measurement").

## 3. Code state

Committed with this file (branch `natan`, also pushed to `main` at the human's request):

| File | State |
|---|---|
| `sim/simulator.py` | `Spec` dataclass, `STANDARD`, `HARD`; `build_obs(df, i, soc, spec)`, `simulate(agent, df, spec=...)`. Standard behaviour unchanged, 21 tests pass. |
| `sim/data.py` | `load_campus_hourly(hard=True)` → pv × 12 + columns `irradiancia_wm2, temp_ambient_c, temp_panel_c, vent_ms`; `load_meteo_hourly()`. |
| `experiments/oracle/oracle_lp.py` | `oracle_run(df, spec)`; CLI flag `--hard`. |
| `agent_hard/agent.py` | **Draft, never executed.** Needs `agent_hard/model.json`. Expect small bugs on first run. |
| `docs/HARD_MODE_HANDOFF.md` | this file |

Not written yet: `experiments/hard/build_model.py`, `agent_hard/model.json`, validation script, tests for the hard
agent, `--hard` in `sim/check.py` and `sim/evaluate.py`, Hard Mode section in `CHALLENGE.md` / `CLAUDE.md` /
`docs/SOLUTION.md`. `CLAUDE.md` still tells Aiman a forecaster is not needed — true for standard mode only; fix it.

Reproduce the table of section 2 (scratch script was not kept):

```python
from sim.data import load_campus_hourly
from sim.simulator import HARD, simulate, load_agent_class
from experiments.oracle.oracle_lp import oracle_run
from experiments.mpc.validate import monthly_blocks
df = load_campus_hourly(hard=True); last = monthly_blocks(df, "last")
print(oracle_run(last, HARD), simulate(load_agent_class("agent/agent.py")(), last, spec=HARD).score)
```
Run scratch scripts with `PYTHONPATH=. .venv/Scripts/python script.py` from the repo root.

## 4. Design of the Hard Mode agent (what `agent_hard/agent.py` implements)

Each hour: forecast 48 h of price, CO2, load, solar → score weight `w = 0.7·co2/CO2_base + 0.3·price/COST_base`
and K equally likely scenarios of the net load of each hour → plan minimising the **expected** weighted import →
apply the first hour through the clamp.

### 4.1 Planner (stochastic version of the standard-mode marginal-value DP)

Stage cost of setpoint p at hour t: `w_t · mean_k max(L_{t,k} + p, 0)` (L = net load scenarios). Its marginal cost
is a staircase: `w_t · (share of scenarios still importing)`, times η for discharge and 1/η for charge.
With q(s) = marginal value of a stored kWh, one backward step is

`q_t(s) = min over breakpoints b of max( q_{t+1}(s + b), level(b) )`

with breakpoints b = −DOWN (level −∞), one per scenario at the setpoint −L_k (level = w·rank/K·η or /η), 0
(level = w·η·P(L>0)) and UP (level = w/η·P(L>−P)); q = +∞ below empty and −∞ above full. One `np.interp` call
per hour. The first hour is chosen by direct minimisation of `expected cost + cost-to-go` over ~300 candidate
setpoints (cost-to-go = −∫q). With one scenario and L ≫ P this reduces exactly to the standard-mode formula.
**Not yet verified against the LP** — first test to write (see 5.3).

Why scenarios matter: discharging more than the campus really consumes, or charging more than the real surplus,
is paid in full, and the real net load of the current hour is unknown (only t−1 is measured). The optimal
discharge is a quantile of the net-load distribution, not its mean.

Open-loop caveat: the plan ignores that the agent will know more later. Spread for future hours is therefore a
tuning knob (`spread_scale` in model.json, and the choice between lead-dependent spread and nowcast-only spread).

### 4.2 Forecasts (all numpy, parameters in model.json)

- price, CO2, load: `profile[month, daytype, hour] + correction`, correction linear in three features measured in
  the current week: f1 = last residual (t+2 for the market series, t−1 for load), f2 = mean residual of the last
  24 h, f3 = residual at the same hour on the most recent measured day. Coefficient set "A" (f1,f2,f3) when f3
  exists, "B" (f1,f2) otherwise, one row per lead 0..47. No history in the current week → pure profile.
  Day type: 0 working day, 1 Saturday, 2 Sunday; for load, holidays count as 2.
- solar: clear-sky kW from the sun's position (`sun_vector`, `clear_sky_basis`: unit vector east/north/up ×
  transmittance `exp(−haze·(1/up − 1))`, averaged over 4 points in the hour, DST-aware) dotted with 3 fitted
  coefficients `sun`; times clearness k. k forecast = `kbar[month] + A·(k_last − kbar, k_day − kbar)` when the
  last hour was daytime, `+ B·(k_day − kbar)` at night (k_day = energy-weighted clearness of the last ≥3 daytime
  hours within 24 h), else kbar.
- Net-load scenarios: point forecast + `err[lead bucket][clear-sky bin][K]` (empirical error quantiles).
  Lead buckets: 0, 1, 2, 3–5, 6–11, 12–23, 24+. Clear-sky bins (kW): ≤1, ≤400, ≤900, ≤1400, >1400.
- Future timestamps jump from the end of a month to the last 7 days of the next one when the current week started
  at 00:00 exactly 7 days before a month end (`_future_times`).
- Run length assumed 2,016 h: the horizon shrinks near the end so the battery is emptied. Lists shorter than 3 also
  signal the end.

### 4.3 `model.json` schema the agent expects

```
price_prof, co2_prof, load_prof : [12][3][24]   month index 0 = January
sun   : [3]   kW per unit of (east, north, up) x transmittance        haze : float
kbar  : [12]  mean clearness by month
err   : [7][5][K]  net-load error quantiles (true - forecast), kW, ascending in K
co2_rate, cost_rate : [12]  no-battery kg/h and EUR/h under Hard Mode (max(load - 12 pv, 0) x co2 / price)
coef  : {"price": {"A": [48][3], "B": [48][2]}, "co2": same, "load": same, "pv": {"A": [48][2], "B": [48][1]}}
holidays : ["2025-09-11", ...]        spread_scale : float (optional, default 1)
```
`BatteryAgent(model=dict)` accepts the parameters directly (for experiments); the server calls `BatteryAgent()`.

## 5. Plan, in order

### 5.1 Write `experiments/hard/build_model.py` (fits everything, writes `agent_hard/model.json`)

1. Load `load_campus_hourly(hard=True)` (5,993 h) and the full price/CO2 series (`experiments/mpc/arb.load_signals()`,
   6,768 h incl. November).
2. Holidays (load only): 2025-09-11, 09-24, 10-12, 11-01, 12-06, 12-08, 12-24 … 2026-01-06, 04-03, 04-06, 05-01,
   05-25, 06-24, 08-15.
3. Profiles `[12][3][24]`: month × daytype × hour means. Weekend cells have 2–4 days: shrink towards
   `month working-day profile × all-month daytype ratio` (prior weight ≈ 2 days). November load = mean of Oct and
   Dec. **Compute them leaving out the 7-day chunk being used for fitting** (chunks = days 1–7, 8–14, 15–end of
   each month), otherwise the corrections learn to over-trust the profile.
4. Sun fit: build the basis with the agent's own `clear_sky_basis` (import it from `agent_hard/agent.py` so train
   and inference match); fit the 3 coefficients as an upper envelope (expectile regression, τ ≈ 0.97, IRLS) for
   each `haze` in a small grid (0 … 0.3); keep the best. Check the fitted curve against the q95 solar by month
   and hour, and that March vs April (DST) lines up.
5. `kbar[month]` = Σpv / Σclear over daytime hours; `co2_rate`, `cost_rate` by month; November = neighbours' mean.
6. Collect training samples **by running the agent's own code**: for each chunk, `BatteryAgent(model=params with
   leave-chunk-out profiles)`, feed `build_obs(month_segment_df, pos, 3000.0, HARD)` for the chunk's rows, call
   `agent._observe(obs)` then `agent._features(i, 48, cal, known)`; targets = truth at now + j hours (NaN if not
   in train). This guarantees train/inference consistency.
7. Ridge per lead and per coefficient set (A / B). Solar targets only where clear-sky > 40 kW.
8. Second pass with fitted coefficients: `agent._forecast(...)` → net-load errors → `err` quantiles (K = 7, at
   (k+0.5)/K). Print MAE by lead for the four series (this is the forecaster's report card).
9. Option `--holdout`: fit without the last 7 train days of each month and return the dict (for validation).

### 5.2 Validate (the number that matters is the score, not the MAE)

`monthly_blocks(df, "last")` with a model fitted WITHOUT those days, `simulate(agent, blocks, spec=HARD)`
versus `oracle_run(blocks, HARD)` (bound 22.40). Also run in the official env with the snippet's spec for the
physics. Then the value-of-information ladder, by subclassing the agent and overriding `_forecast` with truth:
(a) all perfect → must be ≈ the bound (checks the planner); (b) perfect market only; (c) perfect load/solar only.
The gaps say where to spend the remaining time.

Tune on the hold-out, in this order: `spread_scale` (0, 0.5, 1) and nowcast-only vs lead-dependent spread;
`HORIZON` 24/36/48; terminal value of stored energy (now 0); K.

### 5.3 Tests and submission checks

- `tests/test_agent_hard.py`: planner vs LP (`experiments/mpc/arb.lp_schedule` generalised, or `oracle_run` on a
  small frame with exact forecasts), 0 infractions on HARD, feasible at SOC 0 / 6000, malformed obs, string
  timestamp, 24-long lists.
- `sim/check.py --hard`: HARD spec, clamp at SOC 0/6000, timing, zip `agent.py` + `model.json` at the ZIP root →
  `submission_hard.zip`. **Time budget: ≤ 10 ms per step locally** (laptop timings swing 3–4×; limit is 60 s for
  2,016 steps). Planner cost ≈ 48 h × one interp of (K+3) × 241 points.
- `python starter_kit/check_submission.py submission_hard.zip` must say valid.

### 5.4 Submit (human only)

The web upload needs the team PIN (team "AAA"): the human does "Validació Ràpida Mode Difícil" (free) and then
"Trametre al Rànquing Mode Difícil". Announce to the team first, log it in `SUBMISSIONS.md` (add a Hard Mode table).

### 5.5 Improvements after the first submission (ranked by expected gain)

1. Whatever the ladder in 5.2 says is the biggest gap.
2. LightGBM residual models on the same features (+ lead, hour, temperature, age in week). Store boosters as text
   (`model_str`) to avoid version problems; keep the linear model as fallback; check time per step.
3. Temperature as a load feature; price/CO2 of the 3 known hours as a solar-clearness hint (national solar).
4. Holiday handling for price; Easter week (Mar 30–Apr 6) as half-holiday for load.
5. One agent for both modes (switch on `cap_max_kwh`), only if useful for the demo.

## 6. Gotchas (do not relearn these)

- Forecast lists start at the **current** hour; element 0 == `preu_actual`.
- Rescale LP costs to O(1) before HiGHS (raw w ≈ 1e-5 gives visibly wrong "optimal" solutions).
- Judge on whole-week blocks and against the bound, never on random hours, never on `synthetic_campus()`.
- Validation must exclude the validated days from every fitted parameter, profiles included.
- Telemetry at the first hour of a week (after a month jump) is the last hour of the previous month: the agent
  stores it at step i−1 and ignores it for the new week. At step 0 of the run the env gives the current hour.
- Agent code may import only numpy, pandas, scipy, scikit-learn, joblib, xgboost, lightgbm, math, datetime,
  collections, itertools, random, json, pathlib, typing. No hidden-test data, no PIN in git, never force-push.
- Bash heredocs with non-ASCII characters (º, ·) break on this Windows shell: write files with the editor tools.
- `agent/agent.py` (standard mode) must stay untouched and valid.
