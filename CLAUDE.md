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
- Leaderboard quota is 10/shift — only submit what's on `main`, after local eval + free web quick-validation, and announce it.
- Agent code must **never import `os`, `sys`, `subprocess`, `inspect`, `socket`, `urllib`, `requests`, nor use `eval`/`exec`**; only numpy, pandas, scipy, scikit-learn, joblib, xgboost, lightgbm + stdlib listed in CHALLENGE.md.
- Agent must always apply the SOC safety clamp (0 violations) and run in well under 60 s for 2,016 steps.

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

- The simulator in `sim/` is **our approximation** of the unreleased evaluator (details such as export compensation 0.04 €/kWh, percent units, violation definition are inferred from the page). When the official `starter_kit/environment.py` is available locally, validate against it and update `sim/` so scores match, then log it in `docs/HANDOFF.md`.
- Page inconsistency: infraction penalty stated as −0.20 (formula) and −1.00 (FAQ). Treat any violation as very costly.
- Avoid overfitting: train has ~first 3 weeks of each month; test = last week of each month (hidden 50 % private). Validate with whole-week blocks, never random hour splits.
- Prices/CO2 for the next 24 h are given; demand & solar are not and must be forecast.
- Keep code clean and commented where non-obvious — the jury audits all submitted code.
