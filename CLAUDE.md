# CLAUDE.md — Datathon FME 2026 · UPC Sostenible Battery Challenge

Team: **Natan, Aiman, Sami** (3 humans, 3 Claude agents). Repo: `NatanSisoev/Datathon-FME`.
Challenge: https://repteupc.datathon.cat/ — program a `BatteryAgent` that charges/discharges a 2 MWh campus battery hourly to cut CO2 (70 %) and cost (30 %).

Goals: **1. best leaderboard score** (MODEL track) · **2. best demo/presentation** (DEMO track — the jury weighs it decisively).

## Read first

1. [CHALLENGE.md](CHALLENGE.md) — full spec: physics, `obs` contract, scoring, data, submission limits, forbidden imports.
2. [WORKFLOW.md](WORKFLOW.md) — **mandatory** branch / merge / submission rules for the three of us and our agents.
3. `docs/HANDOFF.md` — what teammates changed recently.

## Which branch am I on? Work ONLY there, and do YOUR assignment

Run `git branch --show-current` first. Your branch = your human. Commit and push directly to it (`git push origin <branch>`); never commit to `main` or to someone else's branch.
Start every session with `git fetch origin && git merge origin/main`, then read `PLAN.md` and `docs/HANDOFF.md`.
First time on this machine: set up the venv, `pip install -r requirements.txt`, and get the data (see `data/README.md`: official ZIP -> `data/train/`, `starter_kit/`), then `pytest`.

### Branch `natan` — MODEL track: optimizer
Owner of `agent/agent.py` and `experiments/oracle/`, `experiments/rule_v2/`, `experiments/mpc/`.
1. Perfect-foresight LP/DP upper bound on whole-week blocks (what is the max achievable score, where does the gain come from).
2. Rule-based v2 using the 24 h price+CO2 forecast (beat the template).
3. MPC agent: each hour plan 24 h (LP via scipy HiGHS or DP over SOC) with known price/CO2 + forecast load/solar, apply first action, always through the safety clamp, <25 ms/step.
4. Merge to `main` any verified better agent; run submissions (announce first).

### Branch `aiman` — MODEL track: forecasting + data analysis
Owner of `notebooks/`, `experiments/forecast/`, `agent/models/`.
1. EDA notebook: load and solar by hour/weekday/month, train-vs-last-week-of-month drift, price/CO2 patterns, solar vs irradiance. Share key findings in `docs/HANDOFF.md` (Sami uses them for the demo).
2. Forecasters for next-24 h load and solar using ONLY what the agent sees (`hour`, `day_of_week`, month, `noves_dades_5min`, `self.historial`): seasonal-naive -> ridge -> LightGBM. Validate by whole-week CV (MAE by horizon).
3. Deliver a small `Forecaster` class with `predict(obs, history) -> (load_24h, pv_24h)` + `.pkl` (<5 MB), documented in `docs/HANDOFF.md`, so Natan's MPC can plug it in. Files go in `agent/models/`; keep imports within the allowed list.

### Branch `sami` — DEMO track: frontend, story, presentation
Owner of `demo/`.
1. Pick the stack (Streamlit or static HTML/JS), build a skeleton that replays a week from `sim.simulate(agent, df).trace` (SOC, setpoint, grid import) with KPI cards (CO2 avoided, EUR saved, infractions).
2. Data-insights page with real figures (price/CO2 daily profile, solar curve, demand by weekday) — use Aiman's EDA findings.
3. Compare: no battery vs template baseline vs our best agent; optional what-if slider (CO2 vs cost weight).
4. Slides + 3-minute pitch + fallback screen-recording. Story outline is in `PLAN.md`. Save result data to `demo/data/` and document the format in `docs/HANDOFF.md`.
Sami's agent: you may read everything but only edit `demo/` (and `docs/HANDOFF.md` entries). Ask the model people for agent traces rather than editing `agent/` or `sim/`.

## Non-negotiables (summary — details in WORKFLOW.md)

- Work **only on your human's branch** (`natan` / `aiman` / `sami`). Check `git branch --show-current` first.
- Push often. Need a teammate's work → `git fetch` + merge their branch or `git checkout origin/<branch> -- <file>`.
- **Only to `main`**: new best agent (verified), shared infra, demo milestones. Never broken code, data, or the PIN.
- Never force-push. Never edit another person's branch.

## Challenge rules cheat-sheet (full text: CHALLENGE.md)

**Score** = `max(0, 0.70·ΔCO2(%) + 0.30·ΔCost(%) − penalty·infractions)`, Δ vs. the same campus with no battery. Official `environment.py`: 0.2 points per infraction; ENUNCIAT/FAQ say 1.00 → assume 1.00. Tie-break: score → fewer infractions → earlier submission.
Battery: 2,000 kWh, ±500 kW, round-trip 90 % (η = √0.9 each way), SOC0 50 %, no export revenue, no degradation.

**Submission quota — 10 per shift, 3 shifts (30 total), unused quota does not carry over:**
| Shift | Window | Quota |
|---|---|---|
| 1 | Saturday day, until 21:00 | 10 |
| 2 | Saturday night, 21:00 → Sunday 08:00 | 10 |
| 3 | Sunday 08:00 → challenge close | 10 |
Only "Trametre al Leaderboard" consumes quota; the web "Validació Ràpida" (48 h test) is free and unlimited; failed/invalid submissions don't count. Log every real submit in `SUBMISSIONS.md` and announce it first. PIN: 4+ chars, kept private, never in git.

**Server limits:** 60 s total per simulation, 25 MB max file, `agent.py` at the ZIP root, models via `Path(__file__).parent`.

**AST scanner (auto-reject)** — forbidden modules: `os, sys, shutil, subprocess, socket, urllib, requests, http, ftplib, paramiko, telnetlib, pty, posix, ctypes, importlib, inspect, gc, builtins, fcntl, signal, threading, multiprocessing, aiohttp`; forbidden calls: `eval, exec, __import__, compile, breakpoint, globals, locals, vars, system, popen, rmtree, currentframe, stack`; forbidden attributes: `__code__, __globals__, __builtins__, __subclasses__, f_back, f_locals, f_globals`. Allowed (exact web list): numpy, pandas, scipy, scikit-learn, joblib, xgboost, lightgbm + stdlib math, datetime, collections, itertools, random, json, pathlib, typing. (ENUNCIAT.md also mentions functools/heapq/bisect/re/copy/pickle/dataclasses, but the web page does not list them - do NOT use them.) Mirrored in `sim/check.py`.

**0-infractions guarantee:** every `act()` must return through the clamp (see `BatteryAgent._clamp` in `agent/agent.py`):
`max_charge = min(500, (2000 − soc_kwh)/η − 1e-4)`, `max_discharge = min(500, soc_kwh·η − 1e-4)`, return `clip(setpoint, −max_discharge, max_charge)`; also return a finite float (never NaN). `tests/test_sim.py` checks it at SOC 0 / full, and `python -m sim.evaluate` must report `violations=0` on all train weeks.

**Pre-submit checklist (every real submit):**
1. `pytest` green and `python -m sim.evaluate --weeks` → better than current `main` on whole-week CV, `violations=0`.
2. `python -m sim.check agent/agent.py --zip` → PASS (AST scan, clamp at extreme SOC, timing <60 s for 2,016 h).
3. `python starter_kit/check_submission.py submission.zip` → valid (official smoke test).
4. Web "Validació Ràpida" (free) passes.
5. Announce to the team, then submit, then log in `SUBMISSIONS.md`.

- **Agent code (`agent/` and anything inside `submission.zip`) may import ONLY the allowed libraries above** — nothing else, ever (no torch, matplotlib, statsmodels, cvxpy, ortools, requests...). `sim/check.py` enforces this whitelist and fails otherwise. Training/EDA scripts, notebooks and `demo/` may use anything, but models must be saved so they load with the allowed libs only (joblib + sklearn/xgboost/lightgbm; keep versions matching `requirements.txt`).
- Never use or embed hidden-test data; the jury audits the code.

## Repo layout

```
agent/agent.py        # The submittable agent (copy of official template + safe clamp). Must stay valid on main.
agent/models/         # .pkl files loaded via Path(__file__).parent (keep small, <25 MB zip)
sim/                  # Local simulator + metric + submission checker (shared infra)
  data.py             #   loads data/train/*.csv into the hourly campus dataframe
  simulator.py        #   battery physics + scoring (our reimplementation; replace/validate vs official environment.py)
  evaluate.py         #   python -m sim.evaluate [agent path] [--weeks]
  check.py            #   python -m sim.check agent/agent.py  (AST scan, clamp test, timing, builds submission.zip)
demo/                 # DEMO track: app, figures, slides
notebooks/            # exploration (MODEL track)
experiments/          # per-experiment code (experiments/<name>/)
tests/                # pytest
data/                 # NOT in git. Put the official ZIP contents here (data/train/*.csv). See data/README.md
starter_kit/          # NOT in git (official kit, ignored) — drop it here if you downloaded it
docs/                 # HANDOFF.md, QUESTIONS.md
SUBMISSIONS.md        # log of leaderboard submissions
```

## Commands

```bash
pip install -r requirements.txt
pytest                                   # tests (synthetic data, no download needed)
python -m sim.evaluate                   # score baseline agent on data/train (or synthetic if absent)
python -m sim.evaluate path/to/agent.py  # score another agent
python -m sim.check agent/agent.py       # AST/clamp/timing check; --zip builds submission.zip
```

## Engineering notes

- `sim/` is validated against the official `starter_kit/environment.py` (`tests/test_vs_official.py`): export price 0, baseline = max(load − pv, 0), CO2/cost on grid import only. If you change `sim/`, that test must still pass and the change goes through `main`.
- Baseline template scores ≈ 1.3 on the real train data (dCO2 ≈ 0.9 %, dCost ≈ 2.2 %) — gains are small; judge changes on whole-week blocks.
- Avoid overfitting: train = first ~3 weeks of each month; hidden test = last 7 days of each month (public 50 % on the leaderboard, private 50 % for the final verdict). Never random hour splits.
- Month jumps: if `obs["timestamp"] − previous > 2 h`, reset short rolling windows. SOC may or may not restart at 50 % for each test week (docs disagree) — don't depend on it.
- Prices/CO2 for the next 24 h are given; demand & solar are not and must be forecast.
- Keep code clean and commented where non-obvious — the jury audits all submitted code.
