# Hard Mode: state, submit queue and step-by-step plan

Written 2026-11-14 (night) by Natan's planning session. **Follow this file literally.** It replaces the session
context. The human (Natan) does every leaderboard upload; you prepare zips and keep two files up to date:
`submissions/hard/QUEUE.md` (what to submit, in order) and `SUBMISSIONS.md` (log of what was submitted).

## 1. Where we stand

- Best public score: **23.84** = `submissions/hard/probes/p04_co2_expand13.zip` (H10 + `co2_expand` 1.3).
  H10 = `submission_hard_10.zip` = 23.71. Safe fallback: either of these two.
- The organisers confirmed we are at about 80 % of the perfect-foresight score on the test: the public
  ceiling is about 29.8. Locally (hold-out) we reach 91 % of the bound. **About 3 points leak on the real test
  weeks that our local validation does not show.** Finding that leak is the goal; small knob gains are not.
- Facts established on the public leaderboard (full table at the bottom of `submissions/hard/QUEUE.md`):
  1. Knobs have peaked: `co2_mult` 1.8, `co2_expand` 1.3, `price_expand` 1.0 to 1.3. Do not tune them further.
  2. The price forecast beyond the 3 published hours is worth at least 1.5 points (flat forecast = 22.17).
  3. Reference neural net (MLP averaged 50/50 with LightGBM, `c30`) scored 23.40 = -0.31 vs H10, although
     the local hold-out said +0.08.
  4. The local hold-out has now mispredicted three changes. **Never trust a local gain below 0.2. Never
     claim an improvement without a public score.**
- Noise rule: **public differences below 0.10 are noise.** Do not act on them.

## 2. Rules (never break these)

1. Never modify, overwrite or delete: `agent/`, `agent_hard/`, `agent_hard_nn/agent.py`, `sim/`, `tests/`,
   `starter_kit/`, `data/train/`, any existing zip, any existing folder under `submissions/`. New versions get
   new names. `make_probe.py` and `make_variant.py` refuse to overwrite; do not work around that.
2. Work on git branch `natan` only. Never force-push. Never commit data, zips or the PIN.
3. Code inside a zip may import only: numpy, pandas, scipy, sklearn, joblib, xgboost, lightgbm, math, datetime,
   collections, itertools, random, json, pathlib, typing. Forbidden call names: eval, exec, compile, globals,
   locals, vars, system, popen, stack (so no `np.stack`).
4. Every zip: `agent.py` at the zip root, official checker says valid, at most 15 ms/step locally.
5. Never use hidden-test data. Leaderboard scores may be used to choose settings.
6. Commands run from the repo root with Git Bash: `PYTHONPATH=. .venv/Scripts/python ...`.
   Write files with an editor tool, not with bash heredocs (non-ASCII characters break).
7. If a step fails or a result fits none of the cases below: stop, write what happened under
   "Open problems" in `QUEUE.md`, and tell the human. Do not improvise a fix in agent code.

## 3. Tools you have (all tested)

| Tool | Use |
|---|---|
| `experiments/hard/make_probe.py --name N --set key=json [--agent FILE]` | New zip from H10's files with model.json changes, into `submissions/hard/probes/` |
| `experiments/nn/make_variant.py --src FOLDER --name N [--out PARENT] [--set k=json] [--drop-err-nn] [--blend-market X] [--blend-net X] [--agent FILE]` | New zip derived from ANY existing submission folder. Read its docstring |
| `experiments/hard/probe_holdout_v2.py [--only a,b]` | Local hold-out score of knob settings (rough guide only) |
| `python -m experiments.nn.run --arch A --tag T --mode holdout\|full --seeds 3` | Train a neural forecaster (see `experiments/nn/README.md`) |
| `python -m experiments.nn.package --id cNN --members A:T --blend 0.5` | Package a neural forecaster into `submissions/hard/nn/` + hold-out score |
| `.venv/Scripts/python starter_kit/check_submission.py ZIP` | Official checker (both make_* tools already run it) |

Agents (base files for zips):
- `submissions/hard/_base_h10/` = H10 exactly.
- `submissions/hard/_base_h10_knobs/agent.py` = H10 + knobs `co2_expand`, `price_expand`.
- `submissions/hard/_base_v2/agent.py` = the above + `corr_scale` (dict per series) + `dst_continuous` (0/1).
- `agent_hard_nn/agent.py` = H10 + knobs + neural path. It does NOT have `corr_scale` / `dst_continuous`.

Local twin for hold-out runs: `experiments/hard/model_holdout_lgb_cal.json` with keys `wmult` and
`wmult_pow` deleted in memory, `co2_mult` 1.0. It scores 20.464. (With `wmult` it scores 20.67: wrong baseline.)

## 4. Step 1: inventory what the background workers left

Five workers were still running when this was written. Check their output on disk:

```bash
ls submissions/hard/kernel/*.zip submissions/hard/nn/*.zip submissions/hard/probes/*.zip
ls experiments/nn/runs/ experiments/nn/packages/
```

Expected when finished:
- Date-centred profiles: 3 zips `submissions/hard/kernel/k01_*.zip`, `k02_*`, `k03_*`; code in `experiments/hardk/`.
- N-HiTS: `c40_*` (blend 0.5), `c41_*` (blend 1.0). GRU/LSTM: `c50_*`, `c51_*`. TCN: `c60_*`, `c61_*`.
  TFT-lite: `c70_*`, `c71_*`. All in `submissions/hard/nn/`; local score in
  `experiments/nn/packages/<id>/holdout_score.json`; timing in `<folder>/package_info.json`.

If an architecture has no zip yet, finish it mechanically (arch names: `nhits`, `rnn`, `tcn`, `tft`):
1. Look at `experiments/nn/runs/<arch>_<tag>/holdout/metrics.json` for every tag. Pick the tag with the lowest
   sum of the price and CO2 MAE at leads 3-11 and 12-23 (neural net alone).
2. If `experiments/nn/runs/<arch>_<tag>/full/` does not exist for that tag:
   `PYTHONPATH=. .venv/Scripts/python -m experiments.nn.run --arch <arch> --tag <tag> --mode full --seeds 3`
   (about 15 minutes; run one at a time).
3. Package: `PYTHONPATH=. .venv/Scripts/python -m experiments.nn.package --id c60 --members <arch>:<tag> --blend 0.5`
   and again with the next id and `--blend 1.0`.
Known at handoff: TCN had only tag `a` finished in holdout mode (tags b-f were still training, logs may be in
`experiments/nn/runs/tcn_*`), no full run, no zip. If an architecture has no finished `holdout` run at all:
leave it and note "not finished" in `QUEUE.md`. Do not rewrite its code.

For every zip found, add a row to `QUEUE.md` (zip link, what it is, local hold-out, ms/step, empty score cell).

## 5. Step 2: what the human submits, in this order

Keep `QUEUE.md` in this order. After each score: fill the cell in `QUEUE.md`, add a row to `SUBMISSIONS.md`
(next H number; columns as the existing rows: score, CO2 %, cost %, zip name, one-line reading).

| Order | Zips | Why |
|---|---|---|
| A | `probes/m12_only`, `m11`, `m03`, `m10`, `m08`, `m06`, `m04`, `m01`, `m02`, `m05`, `m07`, `m09` | Per-month contribution on the real test: locates the leak |
| B | `nn/c32_mlp_b050_errlgb`, `nn/c33_mlp_market_only`, `nn/c34_mlp_net_only` | Why the MLP blend lost 0.31 |
| C | `probes/s01_dst`, `probes/r06_corr_mkt_13_noexp`, `probes/r02_corr_price_13`, `probes/r01_corr_co2_13`, `probes/r05_corr_net_13`, `probes/r03_corr_mkt_13` | Clock-change fix; "trust recent data more than the profile" |
| D | `kernel/k01..k03` | Profiles centred on the test week |
| E | One zip per architecture, chosen by the rule in step 4 | New architectures |
| F | `probes/p10_lgb_x15`, `p11`, `p07`, `p08`, `p09`, `p05`, `p06` | Leftover knob probes, only if time remains |

Skip `r04_corr_mkt_16` unless `r03` beats 23.84 by 0.10 or more.

## 6. Step 3: read the month probes (group A)

For each month: `points = 0.7 * kg / 602.5 + 0.3 * EUR / 949.8` (public totals are 60,250 kg and 94,980 EUR).
Write a table in `QUEUE.md`: month, kg, EUR, points, local reference, ratio = points / local reference.
Local reference (points): Sep 1.67, Oct 2.00, Dec 0.59, Jan 1.39, Feb 1.25, Mar 1.46, Apr 1.73, May 1.99,
Jun 2.09, Jul 2.78, Aug 3.54. November has no local reference.

Then apply the first case that matches:

- **Case A1: months 4 to 12 all return exactly 0 kg and 0 EUR while months 1 to 3 do not.** The agent's clock
  is not reading the server's timestamp (`_time` in agent.py falls back to a counter starting 2026-01-01).
  This would explain most of the missing points. STOP. Report to the human at once; this needs a stronger model.
- **Case A2: some months return exactly 0, without the A1 pattern.** Those weeks are not in the public half.
  List them. Every knob chosen so far reflects only the public months; say so in `QUEUE.md`. Continue.
- **Case A3: the 12 values sum to about 23.7 and no month is 0.** The public half is spread over all weeks.
- In cases A2 and A3: compute the median ratio over the non-zero months. Any month whose ratio is below
  **0.6 x the median** is a "leak month". Record them. Known suspects and their probes:
  - March, October (clock change inside the test week): compare `s01_dst` with p04 (23.84).
  - November (no load/solar in train) and December (Christmas closure, Dec 25-31): no fix exists yet.
  - Report the leak months to the human; a fix for a leak month needs a stronger model.

## 7. Step 4: neural forecasters (groups B and E)

Reference values: H10 = 23.71, c30 = 23.40. Apply the first case that matches after B is scored:

- **Case B1: `c32` is at least 23.61.** The loss came from the narrower uncertainty table. For every
  architecture build and queue ONE zip from its blend-0.5 folder (replace the folder name by the real one):
  `make_variant.py --src submissions/hard/nn/<c40 folder> --name c42_nhits_e13 --drop-err-nn --set co2_expand=1.3`
  (ids: N-HiTS c42, GRU/LSTM c52, TCN c62, TFT c72).
- **Case B2: `c33` is at least 23.81 and `c34` is below 23.71.** Neural nets help on price/CO2 only. Build per
  architecture: `... --name c43_nhits_market --blend-market 0.5 --blend-net 0 --drop-err-nn --set co2_expand=1.3`
  (ids c43, c53, c63, c73).
- **Case B3: `c34` is at least 23.81 and `c33` is below 23.71.** Help on load/solar only: same command with
  `--blend-market 0 --blend-net 0.5`, names `*_net` (ids c44, c54, c64, c74).
- **Case B4: none of c32, c33, c34 reaches 23.71.** The neural path does not transfer to the test. Queue at
  most one zip per architecture (its blend-0.5 zip, unchanged) so each has one public score on record, then
  stop neural work. Write that verdict in `QUEUE.md`.

An architecture "wins" only if its public score is at least 23.94 (best + 0.10).

## 8. Step 5: combine the winners

A change is a "winner" if its zip beat its own reference by 0.10 or more on public
(reference: p04 = 23.84 for r/s/k zips built with `co2_expand` 1.3; H10 = 23.71 for zips without it).
Build combinations into `submissions/hard/final/` with `make_variant.py --out submissions/hard/final`:

| Winner | How to add it to a source folder |
|---|---|
| clock-change fix | `--agent submissions/hard/_base_v2/agent.py --set dst_continuous=1` |
| `corr_scale` | `--agent submissions/hard/_base_v2/agent.py --set 'corr_scale={"price": 1.3}'` (the winning dict) |
| date-centred profiles | use the winning `submissions/hard/kernel/k0X_*` folder as `--src` (it carries its own model.json and boosters), then add `--set co2_expand=1.3` and the rows above |
| neural architecture | use its folder as `--src`. It cannot take `corr_scale` or `dst_continuous` (its agent lacks them): do not combine those; note it under "Open problems" |

Name them `f01_...`, `f02_...`. Add one winner at a time and have each combination scored: a combination
counts only if it beats the best of its parts. Timing: any combination that changes `horizon` or `n_grid` or
uses a neural folder must show at most 15 ms/step (`package_info.json`, or `probe_holdout_v2.py`).

## 9. Step 6: final choice

- Final candidate = the highest public score among zips whose change has a stated reason (not a lucky knob).
  If the best is less than 0.10 above 23.84, keep **p04** as the final.
- Ask the human which submission counts for the final ranking (best or last). If "last", the human
  re-submits the final candidate at the end.
- Then: write the final table in `QUEUE.md`, update `SUBMISSIONS.md`, commit and push branch `natan`
  (`git add docs submissions/hard/QUEUE.md SUBMISSIONS.md experiments agent_hard_nn`; never `git add -A`:
  the folders under `submissions/hard/` hold large copies and stay untracked).

## 10. What local diagnosis found (context for a stronger model)

- Local gap to perfect foresight is 1.94 points: perfect price/CO2 alone recovers 1.09, perfect load/solar 0.77.
  By month: Aug 0.51, Jun 0.48, Apr 0.32, Oct 0.30, Jan 0.27, Dec 0.16.
- Main cause: the daily CO2 level moves 25-40 % from day to day and the agent sees 3 hours.
  Also: solar clearness reverts to the monthly mean too fast (March); load ignores temperature (Sep, Jun).
- Clock change: without `dst_continuous` the agent starts a new "week" at the March jump and then mis-reads
  the end of the month. The October case (repeated hour) is handled only for a 0 h step.
- Ideas not tried: a planner that carries several CO2-level scenarios (regime-aware dynamic programme);
  learning the value of stored energy directly from perfect-foresight solutions; a multi-day CO2 level
  feature; clearness regression on the last 3-6 h; temperature in the linear load model.
- Scripts: `experiments/hard_diag/` (per-month ladder, glued run, December/March/September deep dives).

## 11. Files

`submissions/hard/QUEUE.md` queue and results table · `SUBMISSIONS.md` log (H1-H23) ·
`experiments/nn/README.md` neural scaffold contract · `experiments/nn/archs/<mlp|nhits|rnn|tcn|tft>/` ·
`experiments/hardk/` date-centred profiles · `experiments/hard_diag/` diagnosis ·
`docs/HARD_MODE_HANDOFF.md` rules of Hard Mode and the agent's design · `docs/SOLUTION.md` section 10.
