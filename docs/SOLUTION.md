# SOLUTION — how our agent works, why, and what we tried

Written 2026-11-14 by natan (claude). This is the single place that explains the MODEL-track solution end to end.
Short log entries live in `docs/HANDOFF.md`; unresolved doubts in `docs/QUESTIONS.md`.

## 1. Status

| | |
|---|---|
| Agent | `agent/agent.py` — exact 24 h look-ahead optimiser (MPC). numpy only, no model file, ~200 lines. |
| Train year, one 5,993 h run | **5.667** (template 1.271). Perfect-foresight bound 5.675 → 99.85 %. |
| Whole-week CV (35 train weeks) | mean **6.09**, bound 6.11. |
| Test-shaped sample, official `environment.py` | **6.09** (bound 6.115). Last 7 days of each train month glued into one run. |
| Infractions | 0 everywhere. |
| Speed | 1–6 ms per decision on Natan's laptop → 3–16 s for 2,016 h (limit 60 s). |
| Checks | `pytest` (21), `python -m sim.check agent/agent.py --zip`, `starter_kit/check_submission.py submission.zip` all pass. |
| Leaderboard | **Nothing submitted yet.** `SUBMISSIONS.md` is empty. |

There is essentially nothing left to gain in the model: we are at the physical optimum for information any causal
agent can have. Remaining work is submitting (early — see §7) and the demo.

## 2. The three facts the solution rests on

**Fact 1 — the battery never makes the campus export.** On the train set net load (demand − solar) is never
negative and is below the battery's 500 kW in 0.52 % of hours. Solar peaks at 144 kW; demand averages 1,123 kW.
So `grid import = net load + setpoint` holds (no `max(·, 0)` kink) and the score is **linear** in the setpoint:

```
score = 100 · Σ_t w_t · (−setpoint_t)        w_t = 0.7·co2_t / CO2_base + 0.3·price_t / COST_base
```

`CO2_base`, `COST_base` are the no-battery totals of the whole evaluation. The task is therefore pure energy
arbitrage on one blended signal `w_t`: buy (charge) when `w` is low, sell (discharge) when it is high, lose 10 % per
round trip. **Demand and solar forecasts cannot change the decisions** — that is why there is no ML model.

**Fact 2 — the agent already knows `w` for the next 24 h.** `preus_properes_24h` and `co2_properes_24h` are given.

**Fact 3 — 24 h is enough to be optimal.** The battery (2,000 kWh, 500 kW) fills or empties in ~4 h. The best action
now depends only on `w` up to the next moment the battery is full or empty, which is always well inside 24 h.
Measured on all 6,768 train hours of price/CO2: re-planning every hour with 24 h look-ahead scores 5.7237, the
perfect-foresight optimum scores 5.7237. A terminal value or a 48 h extended horizon changes nothing.

## 3. What `act()` does, step by step

1. **Read the SOC.** If it is missing or not a number, return 0 (idling can never be an infraction).
2. **Build the window of known hours.** The official environment starts both lists at the *current* hour
   (`list[0] == preu_actual`) and truncates them when the run is about to end. The agent does not assume this: it
   keeps two running mismatch sums (`_lists_start_now`) — list[0] vs the current values, and the *previous* step's
   list[0] vs the current values — and picks the hypothesis with less error. If the lists start at t+1 it prepends
   the current hour. Consecutive hours never share both price and CO2 in the data, so this locks on at step 1.
3. **Learn from the last hour's telemetry** (`_learn`): net load of the hour that just ended, and the running
   no-battery CO2 and cost totals per calendar month.
4. **Compute the weights** (`_weights`): `0.7 / CO2_base` and `0.3 / COST_base`, where each base = what was observed
   so far + a monthly prior (constants `CO2_RATE`, `COST_RATE`, from the train weeks) for the hours still to come,
   assuming one 168 h block per calendar month. Only the *ratio* of the two matters.
5. **Blend** `w = k_co2·co2 + k_cost·price` and rescale it to mean 1.
6. **Export guard:** discharge at most `last net load − 50 kW` this hour (battery energy exported earns nothing).
   In practice this only bites during meter outages, when demand and solar both read 0.
7. **Plan** (`_plan`, §4) and take the first action.
8. **Safety clamp** (`_clamp`): the mandatory formula with the 1e-4 margin → 0 infractions guaranteed.

Any exception inside steps 2–7 results in setpoint 0, never a crash.

## 4. The planner: dynamic programming on the marginal value of stored energy

The 24 h problem is a linear programme. Instead of calling a solver, the agent solves it exactly with a backward
recursion on one curve: `q_t(s)` = how much one more stored kWh is worth at the start of hour `t` when the SOC is
`s`. It decreases with `s` (the fuller the battery, the less an extra kWh is worth).

- Storing 1 kWh in hour `t` costs `w_t / η`; releasing 1 kWh earns `w_t · η` (η = √0.9).
- One hour moves the SOC by at most `UP = 500·η` (charging) or `DOWN = 500/η` (discharging) kWh.
- Start from `q_end(s) = 0` (energy left after the last known hour is worth nothing) and go backwards:

```
q_t(s) = min( q_{t+1}(s − DOWN),  max( q_{t+1}(s + UP),  clip(q_{t+1}(s), w_t·η, w_t/η) ) )
```

Reading it: if a kWh is still worth more than `w_t/η` even after charging at full power, charge fully; else charge
until it is worth exactly `w_t/η`; else idle; and the mirror image for discharging. Out-of-range SOC is `+∞` below
empty and `−∞` above full. The curve lives on a 1 kWh grid (`SOC_STEP`), shifted with `np.interp`.

The first action moves the real SOC to where `q_1` crosses today's buy threshold `w_0/η` or sell threshold `w_0·η`,
limited by 500 kW and by the export guard.

Why no terminal value: with 24 h of window the first action is already right (Fact 3), and when the list is
truncated the run really is ending, so emptying the battery is exactly correct.

Verified two ways: `tests/test_agent.py::test_planner_reproduces_the_lp_optimum` (random windows vs HiGHS) and
the full train year (DP agent 5.6665, LP agent 5.6666).

## 5. Evidence and how to reproduce it

| Command | What it shows |
|---|---|
| `python -m sim.evaluate --weeks` | score on the train set and per week (our simulator) |
| `python -m experiments.oracle.oracle_lp` | agent vs perfect-foresight LP bound, whole run and per week |
| `python -m experiments.mpc.validate` | same with the OFFICIAL `environment.py` on three samples + timing |
| `python -m experiments.mpc.arb` | 24 h MPC vs oracle on price/CO2 alone (6,768 h, incl. November); slow, ~1 min per line |
| `python -m experiments.mpc.sensitivity` | what each implementation detail costs (below); slow, ~10 min |
| `python -m sim.evaluate experiments/baseline/template_agent.py` | the old template baseline (1.271) |

What each detail is worth (arbitrage bench unless noted; reference 5.7237):

| Mistake | Loss (points) |
|---|---|
| Reading the forecast lists one hour off (as t+1…t+24) | **2.52** |
| Optimising price only | 1.49 |
| CO2:price weight ratio wrong by ×2 / ×0.5 | 0.085 / 0.067 |
| No export guard (real train data, because of the outages) | 0.014 |
| Not emptying the battery at the end of the run | 0.010 |
| Weight ratio wrong by 25 % / 10 % | 0.008 / 0.001 |
| Terminal value, 48 h horizon | 0.000 |

Where the missing 0.15 % goes: two meter outages (2026-06-17 17:00 → 06-18 06:00, 14 h; 2026-08-06 08:00, 1 h) in
which demand and solar read 0. The oracle "knows" them in advance; no causal agent can. The week of 17 June is the
only week clearly below the bound (96.3 %).

Per-week CV also shows February at ~98 %: that is not a defect. Scoring a single week normalises CO2 and cost with
that week's totals, whose ratio differs from the yearly one the agent targets (see §7, assumption A).

What the agent actually does (mean setpoint by hour over the train year): charges 12–17 h (peak 14–16 h, clean
midday grid) and 0–4 h; discharges 18–23 h (peak 20–21 h) and 6–8 h; ~1.4 full cycles per day. Over the 250 train
days it avoids ~29 t CO2 and ~62 k EUR.

## 6. What we tried and dropped

| Idea | Outcome |
|---|---|
| HiGHS LP inside the agent (`scipy.optimize.linprog`) | Same score (5.6666 vs 5.6665) but 3× slower and timing erratic (4–14 ms/solve). Dropped from the agent; kept as the reference in tests and experiments. |
| DP on a SOC *state* grid (10 kWh, value function) | 5.6599 — worse than the marginal-value DP and slower at fine grids. Replaced. |
| Marginal-value DP grid 0.5 / 1 / 2 / 5 kWh | 5.6666 / 5.6665 / 5.6665 / 5.6661. Kept 1 kWh. |
| Fixed weight ratio vs online estimate | 5.6669 vs 5.6665 on train (the prior was fitted on train, so this is in-sample). Kept online: it converges to the evaluator's exact ratio on unseen weeks. |
| Export-guard margin 0 / 50 / 100 / 200 kW | 5.6665 / 5.6665 / 5.6664 / 5.6659. Kept 50. |
| Forecasting demand/solar for the plan | Not built: Fact 1 says it cannot change the decisions. |
| Handling solar surplus (charge for free) | Not built: never happens on this campus. On the *synthetic* test campus (900 kW solar) the agent is ~6 % under the bound — partly this, partly because the synthetic price/CO2 levels do not match the real-campus weight prior. Irrelevant for the real data, but do not judge the agent on synthetic scores. |

Two gotchas worth remembering:
- **LP scaling.** In raw score units `w ≈ 1e-5`, the same order as HiGHS' tolerances; the solver then returns
  visibly sub-optimal "optimal" plans (our first oracle was 0.04 % too low and the MPC "beat" it). Always rescale
  costs to O(1) (`experiments/mpc/arb.py`, `experiments/oracle/oracle_lp.py`, and the agent all do).
- **Timing on Natan's laptop** swings 3–4× between a short burst and a sustained run. Judge the 60 s limit against
  the slow figure.

## 7. Assumptions and risks

- **A. One 2,016 h run.** We assume the hidden test is one simulation: SOC carried across the 12 weeks, CO2 and cost
  normalised over the whole run, forecast lists crossing the month jumps — as `environment.py` and the FAQ say.
  ENUNCIAT hints at a per-week evaluation instead. In that case the lists are truncated at each week end and the
  agent empties the battery correctly; the only loss is the normalisation ratio, ~0.01 points.
- **B. Lists truncated at the end.** If a server *padded* them instead, the agent could not see the end of the run and
  would leave energy unused (−0.010).
- **C. Outages in the test weeks** cost whatever they cost; the guard limits the damage to the first hour.
- **D. Public leaderboard = a 50 % mask of hours.** `evaluate_results(mask=…)` scores only masked hours, so the public
  score depends on whether our charge or discharge hours fall inside the mask. Small public differences between
  near-identical agents are noise; do not tune to them.
- **E. Ties.** The leaderboard top seen so far (6.43) is at perfect-foresight level and scores are rounded to 2
  decimals, so teams with an exact optimiser tie. Tie-break: fewer infractions, then **earlier submission**.

## 8. Files added or changed for this solution

| Path | Purpose |
|---|---|
| `agent/agent.py` | the submitted agent |
| `sim/simulator.py` (`_future`) | forecast lists now built exactly like the official env (was: started at t+1, padded) |
| `tests/test_agent.py` | behaviour tests: 0 violations, ends empty, equals the LP, alignment detection, export guard, malformed obs |
| `tests/test_vs_official.py` | + observation-by-observation comparison with the official env |
| `experiments/oracle/oracle_lp.py` | perfect-foresight bound for a whole run (sparse LP) and per week |
| `experiments/mpc/arb.py` | arbitrage bench on price/CO2 only: LP scheduler, oracle, MPC variants |
| `experiments/mpc/sensitivity.py` | the loss table of §5 |
| `experiments/mpc/validate.py` | official-env validation on test-shaped samples + timing |
| `experiments/baseline/template_agent.py` | the original template + clamp, for comparisons and the demo |
| `agent_hard/agent.py` + `agent_hard/model.json` | **Hard Mode** agent + fitted parameters (see §10) |
| `experiments/hard/build_model.py` | fits all Hard Mode parameters (profiles, sun envelope, ridge, error quantiles) |
| `experiments/hard/validate.py`, `tune.py` | hold-out validation, value-of-information ladder, knob grid |
| `tests/test_agent_hard.py` | 20 tests: clamp at extreme SOC, malformed obs, planner ≈ LP with perfect forecasts |

## 9. Before a real submission

`CLAUDE.md` pre-submit checklist, steps 1–3 are done for the current `main`. Still to do by a human: step 4 (web
"Validació Ràpida", free), then announce, submit, and log it in `SUBMISSIONS.md`.

## 10. HARD MODE (`agent_hard/`, design and evidence: `docs/HARD_MODE_HANDOFF.md`)

Written 2026-11-14 evening, same day. The organisers opened a Hard Mode: **6,000 kWh / ±1,500 kW battery, solar × 12
(midday surplus up to ~1,000 kW, export earns 0), and only 3 h of market visibility** (current + next 2 h) instead
of 24. Own leaderboard, own quota. Perfect-foresight bound: 22.40 on the test-shaped sample (last 7 train days of
every month), 20.67 on the whole train year.

Why the standard agent does not transfer: with 12× solar the net load goes **negative** ~9 % of the time, so grid
import is `max(net + setpoint, 0)` — the score is no longer linear in the setpoint, discharging into a surplus is
paid in full, and the real net load of the *current* hour is unknown. The optimal discharge becomes a **quantile of
the net-load forecast distribution**, not a point optimisation.

**Design** (`agent_hard/agent.py`, numpy + stdlib only, ~340 lines):

1. **Forecasts, 48 h** (all parameters fitted offline by `experiments/hard/build_model.py` into `model.json`):
   price, CO2, load = `month × day-type × hour` profile + a 3-feature linear correction from what the agent has
   measured in the current week (last residual, 24 h mean residual, same-hour residual of the previous day);
   ridge fitted per lead, per feature set (A/B). Solar = clear-sky kW from the sun's position (DST-aware basis
   shared between build and agent) × a clearness index that persists from recent daytime hours. Net-load
   scenarios = point forecast + empirical error quantiles per lead bucket × clear-sky bin (K = 7).
2. **Planner**: backward DP on the marginal value of stored energy `q_t(s)`, generalised to the expected cost over
   scenarios — one backward step is `q_t(s) = min over breakpoints b of max(q_{t+1}(s + b), level(b))` on a 121-point
   SOC grid; the first hour is chosen by direct minimisation of expected cost + cost-to-go over ~300 candidates.
   With one scenario it reduces to the standard-mode DP. Every return goes through the mandatory clamp.
3. **Tuned on the hold-out** (never on train day-fits): full spread beats half (20.32 vs 20.16) and none (19.59);
   lead-dependent vs flat spread is a tie; terminal value 0; HORIZON 24 (not 48) and 121-grid points — same score,
   ~4× faster. All knobs live in `model.json`.

**Evidence** (`python -m experiments.hard.validate [--ladder]`):

| Run (1,848 h test-shaped, model fitted WITHOUT those days) | Score | % of bound |
|---|---|---|
| Perfect-foresight LP bound | 22.40 | 100 % |
| Agent, all forecasts perfect (planner check) | 22.32 | 99.6 % |
| Agent, perfect market only | 21.34 | 95.2 % |
| Agent, perfect load/solar only | 21.16 | 94.5 % |
| **Agent as submitted** | **20.32** | **90.7 %** |

0 violations everywhere; ~8 ms/step fresh-process (≈16 s for 2,016 steps, limit 60 s); `tests/test_agent_hard.py`
(20 tests) green; `python -m sim.check --hard --zip` PASS; `starter_kit/check_submission.py submission_hard.zip`
VALID. The two forecast gaps (~1 point each) are the next lever — LightGBM residuals on the same features is
prepared work for shifts 2–3.
