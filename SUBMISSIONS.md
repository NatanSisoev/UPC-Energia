# Leaderboard submissions log

Quota: 10 per shift (Sat day <21:00, Sat night 21:00-08:00, Sun 08:00-close). Announce before submitting. Never write the PIN here.

| # | Shift | Who | Commit | Local score | Leaderboard score | Notes |
|---|---|---|---|---|---|---|
| 1 | 1 (Sat day) | Natan | f645c68 | 5.667 (train year, one run) | 6.43 | Exact 24 h MPC. Team name "AAA". 12 hidden test weeks: CO2 -5.97 % (4,289.3 kg of 71,816), cost -7.5 % (8,907.60 EUR of 118,746.34), 0 infractions. |

## Hard Mode (separate quota: 10 per shift)

Zip: `submission_hard.zip` = `agent_hard/agent.py` + `agent_hard/model.json` (built by `python -m sim.check --hard --zip`).
Local reference: hold-out (last 7 train days of each month) 20.32, perfect-foresight bound 22.40, official checker VALID.

| # | Shift | Who | Commit | Local score | Leaderboard score | Notes |
|---|---|---|---|---|---|---|
| H1 | 1 (Sat day) | Natan | bd278ae | 20.32 (hold-out, 90.7 % of bound) | 22.95 (public, 0 infractions) | First Hard Mode submit. Stochastic 24 h MPC + profile/ridge forecasts, 0 infractions, ~8 ms/step. |
| H2 | 1 (Sat day) | Natan | see git log | 20.48 (hold-out, 91.4 % of bound) | **23.18** (public, 0 infractions) | `submission_hard_02.zip`: H1 + LightGBM residual forecasters (price/co2/load/pv, per-lead shrinkage, month-blind) + full-data profiles. +0.23 over H1 on the public weeks. Zip = agent.py + model_lgb.json as model.json + lgb_*.txt. |
