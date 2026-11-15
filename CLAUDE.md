# CLAUDE.md — Datathon FME 2026 · UPC Sostenible Battery Challenge

Team: **Natan, Aiman, Sami** (3 humans, 3 Claude agents). Repo: `NatanSisoev/Datathon-FME`.
Challenge: https://repteupc.datathon.cat/ — program a `BatteryAgent` that charges/discharges a 2 MWh campus battery hourly to cut CO2 (70 %) and cost (30 %).

Goals: **1. best leaderboard score** (MODEL track) · **2. best demo/presentation** (DEMO track — the jury weighs it decisively).

## Read first

1. [CHALLENGE.md](CHALLENGE.md) — full spec: physics, `obs` contract, scoring, data, submission limits, forbidden imports.
2. [WORKFLOW.md](WORKFLOW.md) — **mandatory** branch / merge / submission rules for the three of us and our agents.
3. `docs/HANDOFF.md` — what teammates changed recently.
4. `docs/SOLUTION.md` — **how the current agent works, the evidence, what was tried and dropped, assumptions and risks.** Read it before touching `agent/` or `experiments/`.

## Setup — DO THIS YOURSELF at the start of a session (do not ask the human; they have pre-authorised these downloads)

Everything below is allowed without asking: downloading the official kit from the challenge site and `pip install` of the libraries in `requirements.txt` (plus the branch extras). Check what is missing first, then install only that.

```bash
git fetch origin && git merge origin/main                # latest shared code
python -m venv .venv                                       # once
.venv/Scripts/python -m pip install -r requirements.txt    # Windows; on mac/linux: .venv/bin/python -m pip ...
.venv/Scripts/python scripts/fetch_kit.py                  # downloads + installs the official ZIP (13 MB) if missing
.venv/Scripts/python -m pytest -q                          # must be green
.venv/Scripts/python -m sim.evaluate --weeks               # sanity check on the real data
```

`scripts/fetch_kit.py` puts `data/train/*.csv`, `starter_kit/*` and `docs/official/*` in place (all git-ignored; never commit them). If the default URL 403s/expires:
open https://repteupc.datathon.cat/ -> tab "Dades del Campus i Starter Kit", click "Descarregar Paquet per als Participants (ZIP, 13 MB)" (the file URL is `/media/<hash>.zip`, visible in the browser network log), then run `scripts/fetch_kit.py --url <that url>` — or, if the human already put the ZIP in the repo root, `scripts/fetch_kit.py --zip paquet_participants_datathon_upc.zip`. The 5-minute-resolution CSVs total ~90 MB unzipped; that is expected.
Extract downloads only into the git-ignored folders above, never into tracked folders; run any Python that reads downloaded files with `-I` when it is a throwaway script.

Branch-specific extras (install/download only what your branch needs):
- **`natan`** (optimizer): nothing beyond requirements (scipy's HiGHS LP is already included). Optionally `pip install cvxpy` / `ortools` for *experiments only* — they can never go into `agent/`.
- **`aiman`** (forecasting): `lightgbm`, `xgboost`, `scikit-learn`, `joblib` (in requirements) plus, for notebooks only, `pip install jupyter matplotlib seaborn`. Models must stay loadable with the allowed libs; pin versions you trained with in `docs/HANDOFF.md`.
- **`sami`** (demo): Node/npm or a plain static server (`python -m http.server`) — three.js and chart libs from a pinned CDN version during development, then **vendor them into `demo/vendor/`** (download the files, commit them) so the presentation works offline. `pip install streamlit plotly` only if the stack is Streamlit. Fonts/textures/3D assets: use freely-licensed or self-made ones and record the source in `demo/ASSETS.md`.

## Which branch am I on? Work ONLY there, and do YOUR assignment

Run `git branch --show-current` first. Your branch = your human. Commit and push directly to it (`git push origin <branch>`); never commit to `main` or to someone else's branch.
Start every session with the Setup block above, then read `PLAN.md` and `docs/HANDOFF.md`.

### Branch `natan` — MODEL track: optimizer
Owner of `agent/agent.py`, `agent_hard/`, `experiments/oracle/`, `experiments/rule_v2/`, `experiments/mpc/`, `experiments/hard/`.
State on 2026-11-14 (details: `docs/SOLUTION.md`): items 1 and 3 are **done** and on `main`; item 2 was skipped because the MPC already equals the bound.
1. DONE — perfect-foresight LP bound (`experiments/oracle/oracle_lp.py`): 5.675 on the train year as one run, 6.11 mean per week.
2. SKIPPED — rule-based v2.
3. DONE — exact 24 h MPC in `agent/agent.py` (dynamic programme on the marginal value of stored energy, numpy only, no load/solar forecast): 5.667 on the train year = 99.85 % of the bound, 0 infractions, 1-6 ms/step.
4. DONE — **Hard Mode agent** (`agent_hard/agent.py` + `agent_hard/model.json`): 48→24 h stochastic MPC on net-load scenarios, profile+ridge forecasts of price/CO2/load/solar. Hold-out (last 7 train days of each month, model fitted without them) **20.32 vs bound 22.40 (90.7 %)**; planner alone 99.6 % of bound; `submission_hard.zip` passes the official checker, ~8 ms/step. See `docs/HARD_MODE_HANDOFF.md` and `docs/SOLUTION.md` §8.
5. TO DO — Hard Mode submissions (announce first, log in `SUBMISSIONS.md`); standard-mode submissions if not yet done.

### Branch `aiman` — MODEL track: forecasting + data analysis
Note 2026-11-14: in **standard mode** the agent on `main` does not use load/solar forecasts — on this campus they cannot change the decisions (`docs/SOLUTION.md` §2). **In Hard Mode this does NOT hold**: the price/CO2 window is only 3 h, net load goes negative ~9 % of the time (12x solar), so forecast quality is worth real points — `agent_hard/` forecasts load and solar with profile+ridge models, and better ones (LightGBM residuals) are welcome. Coordinate with Natan before adding forecasters to the *standard* agent; the EDA (item 1) is still needed for the demo.
Owner of `notebooks/`, `experiments/forecast/`, `agent/models/`.
1. EDA notebook: load and solar by hour/weekday/month, train-vs-last-week-of-month drift, price/CO2 patterns, solar vs irradiance. Share key findings in `docs/HANDOFF.md` (Sami uses them for the demo).
2. Forecasters for next-24 h load and solar using ONLY what the agent sees (`hour`, `day_of_week`, month, `noves_dades_5min`, `self.historial`): seasonal-naive -> ridge -> LightGBM. Validate by whole-week CV (MAE by horizon).
3. Deliver a small `Forecaster` class with `predict(obs, history) -> (load_24h, pv_24h)` + `.pkl` (<5 MB), documented in `docs/HANDOFF.md`, so Natan's MPC can plug it in. Files go in `agent/models/`; keep imports within the allowed list.

### Branch `sami` — DEMO track: frontend, story, presentation
Owner of `demo/`.
1. DONE (2026-11-14) — game-style 3D digital twin in `demo/frontend/` (Vite + React + deck.gl): replays the 35 real weeks through a TypeScript port of `sim/` + the MPC agent (parity-checked, `npm run validate`), with layers, sun control, impact report. Read `demo/frontend/HANDOFF.md` (state, known issues, backlog) before touching it.
2. TO DO — data-insights page with real figures (price/CO2 daily profile, solar curve, demand by weekday) — use Aiman's EDA findings.
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
agent/agent.py        # The submittable agent: exact 24 h MPC + safe clamp (see docs/SOLUTION.md). Must stay valid on main.
agent/models/         # .pkl files loaded via Path(__file__).parent (keep small, <25 MB zip)
sim/                  # Local simulator + metric + submission checker (shared infra)
  data.py             #   loads data/train/*.csv into the hourly campus dataframe
  simulator.py        #   battery physics + scoring (our reimplementation; replace/validate vs official environment.py)
  evaluate.py         #   python -m sim.evaluate [agent path] [--weeks]
  check.py            #   python -m sim.check agent/agent.py  (AST scan, clamp test, timing, builds submission.zip)
demo/                 # DEMO track: demo/frontend (3D twin app, see its HANDOFF.md), figures, slides
notebooks/            # exploration (MODEL track)
experiments/          # per-experiment code (experiments/<name>/): oracle/ (perfect-foresight bound), mpc/ (arbitrage bench,
                      #   sensitivity, official-env validation), baseline/ (the original template agent)
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
- Reference scores on the real train data (one 5,993 h run): template 1.27, **current agent 5.67**, perfect-foresight bound 5.675. Judge changes on whole-week blocks and against the bound (`python -m experiments.oracle.oracle_lp`).
- `preus_properes_24h` / `co2_properes_24h` **start at the current hour** (element 0 == `preu_actual`) and are truncated, not padded, at the end of the simulation (official `environment.py`; `sim/` matches). Reading them as t+1..t+24 costs ~45 % of the score.
- Do not judge the agent on `synthetic_campus()` scores: the synthetic campus has a large solar surplus, the real one never does.
- Avoid overfitting: train = first ~3 weeks of each month; hidden test = last 7 days of each month (public 50 % on the leaderboard, private 50 % for the final verdict). Never random hour splits.
- Month jumps: if `obs["timestamp"] − previous > 2 h`, reset short rolling windows. SOC may or may not restart at 50 % for each test week (docs disagree) — don't depend on it.
- Prices/CO2 for the next 24 h are given; demand & solar are not. On this campus net load is always above the battery's 500 kW, so the score is linear in the setpoint and forecasting them does not change the optimal action (they only feed the export guard).
- Keep code clean and commented where non-obvious — the jury audits all submitted code.
