# PLAN — 24 h datathon (started Sat 2026-11-14 ~12:00, closes ~Sun 12:00)

Roles (agreed): **Natan = model (optimizer)**, **Aiman = model (forecasting)**, **Sami = demo + frontend + presentation**.
Everyone merges `origin/main` hourly. Quota: 10 submits/shift (Sat <21:00, night 21:00-08:00, Sun 08:00-close).

Reality check: baseline heuristic scores only ~1.3 on train (dCO2 ~0.9 %, dCost ~2.2 %). The battery is small vs. the campus load, so
gains are modest and **CO2 dominates (70 %)**. Every % matters; whole-week CV and 0 infractions matter more than leaderboard noise.

## Phase 0 — Setup (Sat 12:30-13:30) — everyone
- [ ] Each person: `git fetch && git checkout <name> && git merge origin/main`, create venv, `pip install -r requirements.txt`, unzip official kit (already done for Natan: `starter_kit/`, `data/train/`; others copy from the zip or re-download), `pytest` green.
- [ ] Read `CLAUDE.md`, `CHALLENGE.md`, `WORKFLOW.md`, `docs/official/ENUNCIAT.md`.
- [ ] Each person run `python -m sim.evaluate --weeks` and note the baseline.

## Phase 1 — Understand & bound (Sat 13:30-16:00)
**Natan (optimizer)**
- [ ] `experiments/oracle/`: perfect-foresight LP/DP (knows true load & solar) on whole-week blocks → **upper bound** of achievable score and the shape of optimal behaviour. Tells us where the gain is (CO2 vs price weighting, solar-surplus charging).
- [ ] `experiments/rule_v2/`: improved rule-based policy using 24 h price+CO2 forecast only (no load forecast): rank next-24 h hours by blended signal, charge in cheapest/cleanest, discharge in dirtiest, respecting the 1/0.9 spread rule. Target: clearly beat the template.
**Aiman (forecasting)**
- [ ] `notebooks/eda.ipynb`: load/solar patterns by hour, weekday, month; train vs. "last week of month" drift; price & CO2 correlation; solar vs. irradiance.
- [ ] `experiments/forecast/`: baselines for next-24 h load and solar from only what the agent sees (`hour`, `day_of_week`, month, `noves_dades_5min`, `self.historial`): seasonal-naive → ridge/LightGBM. Evaluate by whole-week CV (MAE per hour of horizon).
**Sami (demo)**
- [ ] `demo/`: choose stack (Streamlit or static HTML/JS), define the story (see below), build the skeleton that replays a week from `sim.simulate(...).trace`. Mock data first, real data from Natan's/Aiman's output when available.
- [ ] Make a data-insights page with real figures (price/CO2 daily profiles, solar duck curve, demand by weekday).

## Phase 2 — First real agent (Sat 16:00-20:00)
- [ ] Natan: **MPC agent** — at each hour solve a 24 h plan (LP via `scipy.optimize.linprog`/HiGHS or DP over discretised SOC) with known price/CO2 and *forecast* load/solar, apply the first action, always through the safety clamp. Objective `0.7·CO2 + 0.3·cost` normalised. Timing budget: < 25 ms/step.
- [ ] Aiman: package best forecaster as `agent/models/*.pkl` + a small `Forecaster` class; interface agreed in `docs/HANDOFF.md` (`predict(obs, history) -> (load_24h, pv_24h)`).
- [ ] Integrate on `main` as soon as it beats the baseline on whole-week CV with 0 infractions (`python -m sim.check agent/agent.py --zip`).
- [ ] **First leaderboard submission before 21:00** (use Shift 1 quota; 1-2 submits max, log in `SUBMISSIONS.md`). Always free quick-validation first.
- [ ] Sami: interactive replay with the real agent trace; KPI cards (CO2 kg avoided, € saved, cycles, infractions = 0); compare "no battery vs baseline vs ours".

## Phase 3 — Improve (Sat 21:00 - Sun 08:00; shifts 2)
- Use quota deliberately (3-5 submits). Candidates: blended objective weights, forecast quality, terminal SOC value (don't end the horizon empty/full wrongly), robustness at month jumps (`timestamp` gap > 2 h → reset windows), shrinking forecasts toward safe values to avoid exporting battery energy.
- Natan/Aiman sleep in shifts (one stays on). Sami continues demo + slides; record a fallback video of the demo.
- Compare each change on whole-week CV; keep an `experiments/` log of what failed (good material for the jury).

## Phase 4 — Freeze & present (Sun 08:00 - 12:00)
- [ ] 08:00 **model freeze** unless a clear win. Final candidate chosen by CV + public score, check timing & AST (`sim.check`), clean code + comments (jury audits it), final submit(s) in shift 3.
- [ ] Demo rehearsal x2, slides, 3-min pitch script, Q&A prep (why this objective, why trust the forecast, what about overfitting).
- [ ] Tag the final commit on `main`: `git tag final`.

## Demo story (for the jury)
1. Problem & stakes (campus, solar, grid CO2).
2. What the data says (peak CO2 hours, price valleys, surplus solar).
3. Strategy: forecast + 24 h optimisation, safety guarantees (0 infractions).
4. Results vs. no battery / template baseline on whole-week CV; honest about public vs private leaderboard.
5. Live replay of a week; what-if sliders (e.g. weight CO2 vs cost) if time allows.
6. Limits and next steps (real deployment, uncertainty-aware control).

## Dependencies / contracts
- Optimizer (Natan) ← forecaster (Aiman): `Forecaster.predict(...)` API; until it exists use seasonal-naive.
- Demo (Sami) ← traces: `sim.simulate(agent, df).trace` (setpoint_kw, soc_kwh) + the hourly df. Agree a saved results format (`demo/data/*.parquet`) in HANDOFF.
- Nobody edits `sim/` without telling the others (scores must stay comparable).
