# Challenge: UPC Sostenible — Battery Control (Datathon FME 2026)

Source: https://repteupc.datathon.cat/ (scraped 2026-11-14; the page is in Catalan, this is a faithful English summary).
If something here conflicts with the live page, **the page wins** — re-check it and fix this file.

## Mission

Write an agent (`BatteryAgent` in `agent.py`) that decides, **hour by hour**, the charge/discharge power of the
campus battery over **12 weeks of the year (2,016 hours)**. Objective weights:

- **Decarbonisation 70 %** — cut CO2 by not importing from the grid when the peninsular mix is dirty (combined-cycle gas).
- **Economics 30 %** — cut the net bill by charging at cheap (valley) hours and discharging/using solar at expensive (peak) hours.

## Battery & physics

| Param | Value |
|---|---|
| Capacity | 2,000 kWh |
| Max power | ±500 kW |
| Round-trip efficiency | 90 % (one-way η = sqrt(0.9) ≈ 0.9487 each way) |
| Initial SOC | 50 % (1,000 kWh) — only at hour 0 of the *whole* simulation, never reset |
| Degradation | none |
| Export price of battery energy | 0 (battery is self-consumption only; surplus injected earns 0 / no CO2 credit) |

```
Grid power (kW) = campus demand − solar generation + battery setpoint
setpoint > 0 : charging (draws energy);  setpoint < 0 : discharging (feeds campus)
Grid > 0 : campus buys at PVPC price, emits CO2 per grid mix
Grid < 0 : surplus exported; official `environment.py` uses export_price = 0.0 (page text mentions 0.04) — charge the battery with it instead
```

Rule of thumb: cycling only pays if the expensive/dirty hour is ≥ 11.1 % (1/0.9) worse than the cheap/clean hour you charged in.

## Agent contract

`agent.py` must define `class BatteryAgent` with `__init__(self)` (called once) and `act(self, obs: dict) -> float`
(called sequentially, one instance, every hour). Return kW: `>0` charge, `<0` discharge, `0` idle. `np.float64` is OK.

`obs` keys:

| Key | Type | Meaning |
|---|---|---|
| `timestamp` | pd.Timestamp | evaluation datetime |
| `hour` | int 0–23 | |
| `day_of_week` | int 0–6 | 0 = Monday |
| `soc_kwh` | float | stored energy 0–2000 |
| `soc_percent` | float | 0–100 |
| `soc_pct` | float | 0–1 |
| `preu_actual` | float | PVPC price now (€/kWh) |
| `co2_actual` | float | grid CO2 intensity now (kg/kWh) |
| `preus_properes_24h` | list[24] | **known** future prices (€/kWh) |
| `co2_properes_24h` | list[24] | **known** future CO2 intensities (kg/kWh) |
| `noves_dades_5min` | dict | `ultim_consum_kw`, `ultima_solar_kw` — telemetry measured in the last elapsed hour |

Future **demand and solar are NOT given** — that is what ML/statistics must forecast (from hour, weekday, month, recent telemetry, history in `self.historial`).

### Mandatory safety clamp (0 violations)

```python
eta = 0.9 ** 0.5
eps = 1e-4
espai = max(0.0, 2000.0 - obs["soc_kwh"])
disp  = max(0.0, obs["soc_kwh"])
max_carrega    = max(0.0, min(500.0, espai / eta - eps))
max_descarrega = max(0.0, min(500.0, disp * eta - eps))
return float(np.clip(consigna, -max_descarrega, max_carrega))
```

## Scoring

```
Score = max(0, 0.70·ΔCO2(%) + 0.30·ΔCost(%) − 0.20·Infractions)
```
- ΔCO2 / ΔCost: % reduction vs. the **same campus without battery**.
- Infraction: each physical clipping / limit violation. **Sources disagree**: web page formula −0.20, FAQ and `docs/official/ENUNCIAT.md` −1.00, official `starter_kit/environment.py` 0.002 of the score fraction (= 0.2 points). Assume the worst and keep **0 infractions**.
- Tie-break: higher score → fewer infractions → earlier registration time.
- **Jury** weighs the final presentation (technical reasoning, data analysis, strategy justification) *decisively* — leaderboard is only a quantitative guide.

## Data (`data/train/`, ZIP 13 MB from the "Dades del Campus i Starter Kit" tab)

| File | Subsystem | Freq | Key variable |
|---|---|---|---|
| `contador.csv` | transformer (fiscal meter) | 15 min | demand = `-(Contador - POTENCIA ACTIVA EXPORTADA (kW))`, `.clip(0, 5000)` |
| `inversor.csv` | 3 PV inverters | 5 min | solar = sum of the `POTENCIA ACTIVA` columns (no `FASE`), `.clip(lower=0)` |
| `meteo.csv` | rooftop weather station | 5 min | IRRADIANCIA (W/m²), TEMPERATURA AMBIENTE (°C), VELOCIDAD VIENTO |
| `entradas_salidas.csv` | industrial PLC | 5 min | binary machinery signals DI_00…DI_07 |
| `precio_pvpc.csv` | electricity market | 1 h | `precio_eur_per_kwh` |
| `co2_red.csv` | REE generation mix | 1 h | `co2_kg_per_kwh` |

All CSVs index on column `Fecha`. Resample sensor data with `.resample("1h").mean()` (mean kW ≡ kWh per hour).
Package layout: `data/train/`, `starter_kit/{tutorial.ipynb, agent.py, environment.py, check_submission.py}`, `docs/`.

**Train/test split:** test = whole 7-day blocks (the last week of each month); train has the first ~3 weeks of each month.
Test = 1,008 h public (leaderboard) + hidden private half used for the final verdict (anti-overfitting) → timestamps
**jump between months**: if `obs["timestamp"] - prev_ts > 2 h`, reset short rolling windows / lags in `self.historial`.

## Submission rules

- Upload `agent.py` or `submission.zip` (agent.py **at the zip root**, no subfolder, + `.pkl` models) at the "Lliurament" tab.
- Load models with `Path(__file__).parent / "model.pkl"` — never absolute paths.
- Quick validation (48 h, **free & unlimited**) before each real submit. Local: `python starter_kit/check_submission.py agent.py`.
- **Submit quota: 10 per shift × 3 shifts** — Sat day until 21:00, Sat night 21:00→Sun 08:00, Sun 08:00→close. Unused quota does not carry over.
- First submission asks for team name, **4-char PIN** and member names. Keep the PIN in the team's private chat, never in git.
- Timeout **60 s** total, isolated subprocess. Max file **25 MB**.
- Allowed libs: numpy, pandas, scipy, scikit-learn, joblib, xgboost, lightgbm, math, datetime, collections, itertools, random, json, pathlib, typing.
- AST scanner rejects: network (`requests`, `urllib`, `socket`), `os`, `sys`, `subprocess`, `inspect`, `eval`, `exec`. **Do not import `os`/`sys` in agent code.**
- All solutions are archived for jury code review. Public leaderboard = 50 % of each test week; private 50 % hidden.

## Strategic hints (from us)

- Prices and CO2 are known 24 h ahead → this is a 24 h look-ahead scheduling problem (LP / DP / greedy over price+CO2 spread). Only demand & solar need forecasting.
- CO2 has 70 % weight: the objective is mostly "shift imports to low-CO2 hours", cost is secondary. A blended signal `0.7·co2_norm + 0.3·price_norm` is a natural start.
- Battery export earns nothing → never discharge more than the campus net load in that hour (forecast it!).
- 60 s for 2,016 steps ≈ 30 ms per `act` — an LP solve per step with scipy `linprog`/`HiGHS` fits, but measure it.

## Extra info from the organisers' kickoff presentation (transcript)

- Organised by AEET with UPC Sostenible. Campus = Campus Nord; goal is to cover campus consumption with solar, grid or battery.
- Battery has 3 states: charging (from grid), discharging (to campus), idle.
- At decision time we know: temporal context, historical campus consumption, battery state, and Red Electrica's 24 h forecast of price and CO2.
- dCO2 and dCost components **can be negative** (worse than no battery); the **total score cannot** (floored at 0). Penalties apply for impossible states (overcharging above capacity, discharging below 0).
- Train data = first three weeks of each month (representative of seasons and weekdays). Demand varies by hour, weekday and season.
- Jury values the presentation and reasoning alongside the leaderboard.

## Tools: Helmcode (free OpenCode access for participants)

OpenAI-compatible inference API at `https://api.helmcode.com/v1` (docs: https://helmcode.com/docs). The shared participant API key is distributed
in the organisers' Discord/announcement - **never commit it**; keep it in env var `HELMCODE_API_KEY`.
Models (plan-covered): `glm5.3-flash`, `deepseek-v4-flash`, `qwen3.6`, `gemma4`; `glm5.3` is a paid add-on; frontier Claude/GPT/Gemini ids need prepaid credit.

## Verified against the official kit (`starter_kit/environment.py`, in `docs/official/` + git-ignored `starter_kit/`)

- `export_price = 0.0`; baseline (no battery) grid = max(load − pv, 0); CO2 counted on grid import only.
- Score in points = 100·(0.7·dCO2 + 0.3·dCost) − 0.2·infractions (a power clip and a capacity clip in the same hour count separately).
- Future price/CO2 lists **start at the current hour** (`preus_properes_24h[0] == preu_actual`, so they hold now + the next 23 h) and are **truncated** (not padded) when fewer than 24 steps of the simulation remain. Within one run they cross the month jumps (the entries after a week's last hour are the next test week's first hours).
- Our `sim/simulator.py` matches the official env (see `tests/test_vs_official.py`). Baseline heuristic on the full train set: **score ≈ 1.27**, so realistic scores are small numbers; improvements must be measured on whole weeks.
- Hidden test: `data/test_hidden/`, last 7 days of each of 12 months = 2,016 h.

## Extra details from the official kit docs (`docs/official/`)

- Train CSV range: 2025-09-01 → 2026-09-01 (price/CO2 files have 6,768 h; hourly merged table with load+pv has ~5,993 h because the last 7 days of each month are removed for the hidden test).
- ENUNCIAT says SOC0 = 50 % "at the start of each evaluation period"; the FAQ says only at hour 0 of the whole simulation. Unknown whether each test week restarts at 50 % → don't rely on carry-over SOC across weeks.
- Failed submissions (syntax error, missing class) do **not** consume quota.
- AST scanner is broader than listed on the web page: also forbids `http`, `gc`, `builtins`, `signal`, `threading`, `multiprocessing`, `globals()/locals()/vars()/compile()/breakpoint()`, and attributes like `__code__`, `__globals__`, `f_back`. `sys.exit()` is forbidden. `functools`, `heapq`, `bisect`, `re`, `copy`, `pickle`, `dataclasses` are mentioned as OK in ENUNCIAT but NOT on the web list: avoid them. `sim/check.py` now mirrors the official scanner.
- The hidden-test path is off limits: do not try to read `data/test_hidden` or embed test-week data; the jury audits code.
- Official helper: `python starter_kit/check_submission.py agent.py` (24-step smoke test) — run it as well as `python -m sim.check`.

## Website re-check (2026-11-14, ~13:00) and hard bounds

Re-scraped all 5 tabs (Bases, Dades, Lliurament, Leaderboard, FAQ) with every expander opened: **content identical to the first scrape**; leaderboard still empty.
Not extractable as text: the interactive data inspector and sensor dictionary (canvas tables, "20 variables"); their content is in `docs/official/GUIA_VARIABLES.md`.
Other page details: the leaderboard tab offers a CSV backup download of the public ranking; the page also has dark/light mode only (no rules).

### DO NOT go out of bounds (checklist for every agent)

1. **Scoring/physics:** never request beyond ±500 kW or beyond the SOC room; always return through the clamp; return a finite float (no NaN/None/arrays).
2. **Information:** use only `obs` (+ own `self.historial` + models in the zip). Future demand/solar are not given - forecast them. Do not look for, read, embed or derive anything from the hidden test weeks or from price/CO2 values of held-out weeks.
3. **Imports:** only the web whitelist (numpy, pandas, scipy, scikit-learn, joblib, xgboost, lightgbm, math, datetime, collections, itertools, random, json, pathlib, typing). No file/network/system access, no `open()` of absolute paths, no `eval/exec/compile/globals/...`.
4. **Paths:** models/params only via `Path(__file__).parent / "<file>"`; `agent.py` at ZIP root; no subfolders needed.
5. **Resources:** whole simulation < 60 s (2,016 steps + model loading); ZIP <= 25 MB; one `BatteryAgent` instance, `act()` called hourly in order; no threads/multiprocessing.
6. **State:** don't assume SOC resets or carries across test weeks; detect time jumps (> 2 h) in `obs["timestamp"]` and reset short windows.
7. **Quota/identity:** 10 real submits per shift (Sat <21:00, Sat 21:00-Sun 08:00, Sun 08:00-close); quick validation is free; team PIN never in git or docs; first submit requires team name + members; every submit is archived and audited by the jury.
8. **Conflicts between sources** (penalty 0.2 vs 1.0, SOC reset, export price 0 vs 0.04): take the stricter interpretation.
