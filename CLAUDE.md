# CLAUDE.md — Datathon FME 2026 · UPC Sostenible Battery Challenge

Team: **Natan, Aiman, Sami** (3 humans, 3 Claude agents). Repo: `NatanSisoev/Datathon-FME`.
Challenge: https://repteupc.datathon.cat/ — program a `BatteryAgent` that charges/discharges a 2 MWh campus battery hourly to cut CO2 (70 %) and cost (30 %).

Goals: **1. best leaderboard score** (MODEL track) · **2. best demo/presentation** (DEMO track — the jury weighs it decisively).

## Read first

1. [CHALLENGE.md](CHALLENGE.md) — full spec: physics, `obs` contract, scoring, data, submission limits, forbidden imports.
2. [WORKFLOW.md](WORKFLOW.md) — **mandatory** branch / merge / submission rules for the three of us and our agents.
3. `docs/HANDOFF.md` — what teammates changed recently.

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
