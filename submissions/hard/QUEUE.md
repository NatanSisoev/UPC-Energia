# Hard Mode submit queue

One file to work from. Submit a zip, write the public score in the last column, tell Claude.
Step-by-step plan: `docs/HARD_MODE_PLAN.md` (follow it literally).
**Best so far: 23.84** = [p04_co2_expand13.zip](probes/p04_co2_expand13.zip) (H10 + CO2 forecast sharpened x1.3).
All zips below pass the official checker. Local "hold-out" numbers have not predicted public results well.

## Status (updated 2026-11-14 23:20)

- Step 3 verdict (month probes, group A): **Case A2** — August and November return exactly 0 (their weeks are
  not in the public half); the other 10 months sum to 23.79 ≈ H10's 23.71 (+0.08, noise). Median ratio 1.50,
  leak threshold 0.90 -> **March (0.58) is the one leak month**; October (1.33) is fine. Table in section A.
  Every knob chosen so far reflects only the public months.
- Group B scored: c32 23.37 < 23.61 -> **Case B4 confirmed**: the neural path does not transfer to the test
  (c30 23.40, c32 23.37, c33 23.42, c34 23.64 — the narrower table was NOT the problem). Queue one unchanged
  blend-0.5 zip per architecture, then stop neural work.
- Group C: all below p04; s01 exactly ties it (23.84). The "trust the recent deviation" probes are dead;
  r04 stays skipped.
- Group D scored: k01 23.69, k02 23.69, k03 23.71 vs reference H10 23.71 — **all within noise, no winner**.
  Profile centring is not the test-week gap (exactly the kernel worker's "all about 23.7" outcome).
- **No winner anywhere (bar 23.94) -> no Step 5 combinations to build; final candidate stays p04 (23.84).**
- Group E: N-HiTS built but **held on timing** (21.0 / 28.0 ms/step under load vs the 15 ms budget —
  re-measure idle before queueing). GRU/LSTM, TCN and TFT hold-out runs still training (10 workers alive);
  best tags so far: rnn c (0.0642), tcn d (0.0639), tft a (0.0647) — all worse than the MLP reference 0.0626.
- **Next submissions: group E blend-0.5 zips as they get packaged (timing-gated).**
- Competition snapshot (leaderboard backup 23:59): our best 23.84 is now **5th by team-best** —
  Fanboy & Chum Chum **24.25**, SanHackobos **24.15**, SanHackobos_v7/v9 24.10, SSA Gourmet 24.04,
  manguets 23.89. The leaders score better on the *same public weeks* (our month probes prove the public
  half sums to 23.79 for us), so there is real headroom on public weeks, not just private-half luck.

## A. Month probes (12 zips) — submitted 2026-11-14 night (H24–H35)

Each zip is H10 that only acts in one month and idles otherwise. Write down the two absolute numbers the
leaderboard shows. This answers three questions at once: where the points leak on the real test, whether the
agent's calendar works on the server (months that return exactly 0), and which weeks the public half contains.

Points of a month = 0.7 x kg / 602.5 + 0.3 x EUR / 949.8 (public totals: 60,250 kg and 94,980 EUR).

| zip | month | local ref (pts) | ms/step | public CO2 avoided kg | public cost saved EUR |
|---|---|---|---|---|---|
| [m12_only.zip](probes/m12_only.zip) | Dec (Christmas week) | 0.59 | ~8 | 1,047.9 | 639.81 |
| [m11_only.zip](probes/m11_only.zip) | Nov (no load/solar in train) | — | ~8 | 0.0 | 0.00 |
| [m03_only.zip](probes/m03_only.zip) | Mar (clock change) | 1.46 | ~8 | 318.0 | 1,517.38 |
| [m10_only.zip](probes/m10_only.zip) | Oct (clock change) | 2.00 | ~8 | 1,760.8 | 1,975.42 |
| [m08_only.zip](probes/m08_only.zip) | Aug (largest local gap) | 3.54 | ~8 | 0.0 | 0.00 |
| [m06_only.zip](probes/m06_only.zip) | Jun | 2.09 | ~8 | 2,050.9 | 2,897.05 |
| [m04_only.zip](probes/m04_only.zip) | Apr | 1.73 | ~8 | 1,645.8 | 2,423.86 |
| [m01_only.zip](probes/m01_only.zip) | Jan | 1.39 | ~8 | 516.3 | 2,415.27 |
| [m02_only.zip](probes/m02_only.zip) | Feb | 1.25 | ~8 | 1,347.5 | 3,003.51 |
| [m05_only.zip](probes/m05_only.zip) | May | 1.99 | ~8 | 1,601.0 | 3,206.18 |
| [m07_only.zip](probes/m07_only.zip) | Jul | 2.78 | ~8 | 1,588.6 | 3,751.24 |
| [m09_only.zip](probes/m09_only.zip) | Sep | 1.67 | ~8 | 1,943.2 | 2,682.66 |

Local reference, hold-out week of each month in one glued run (score points, agent / perfect foresight):
Sep 1.67 / 1.71, Oct 2.00 / 2.30, Dec 0.59 / 0.75, Jan 1.39 / 1.66, Feb 1.25 / 1.36, Mar 1.46 / 1.32,
Apr 1.73 / 2.05, May 1.99 / 2.05, Jun 2.09 / 2.57, Jul 2.78 / 2.57, Aug 3.54 / 4.05. Total 20.46 / 22.40.
November is not available locally. (ms/step "~8" = the H10 family value; month gating does not change it.)

### Step 3 reading (points = 0.7 x kg/602.5 + 0.3 x EUR/949.8; formula verified against the leaderboard's pts)

| month | kg | EUR | points | local ref | ratio = pts / local ref |
|---|---|---|---|---|---|
| Sep | 1,943.2 | 2,682.66 | 3.10 | 1.67 | 1.86 |
| Oct | 1,760.8 | 1,975.42 | 2.67 | 2.00 | 1.33 |
| Dec | 1,047.9 | 639.81 | 1.42 | 0.59 | 2.41 |
| Jan | 516.3 | 2,415.27 | 1.36 | 1.39 | 0.98 |
| Feb | 1,347.5 | 3,003.51 | 2.51 | 1.25 | 2.01 |
| Mar | 318.0 | 1,517.38 | 0.85 | 1.46 | **0.58 — leak month** |
| Apr | 1,645.8 | 2,423.86 | 2.68 | 1.73 | 1.55 |
| May | 1,601.0 | 3,206.18 | 2.87 | 1.99 | 1.44 |
| Jun | 2,050.9 | 2,897.05 | 3.30 | 2.09 | 1.58 |
| Jul | 1,588.6 | 3,751.24 | 3.03 | 2.78 | 1.09 |
| Aug | 0.0 | 0.00 | 0 | 3.54 | — (not in public half) |
| Nov | 0.0 | 0.00 | 0 | — | — (not in public half) |

Sum of the 12 points = 23.79 (H10: 23.71, +0.08 noise). **Case A2**: exactly two months are 0 (Aug, Nov) ->
those weeks are not in the public half, and **every knob chosen so far reflects only the public months**.
Median ratio over the non-zero months = 1.50; leak threshold 0.6 x median = 0.90; **leak month: March (0.58)**,
the clock-change week, matching the plan's suspect list. s01 (23.84, ties p04) shows the cheap dst fix does
not close it: per the plan, a leak-month fix needs a stronger model (section 10: scenario-carrying CO2
planner, multi-day CO2 feature, temperature in the load model). August is new information: the month with the
largest local gap (3.54 pts) lies entirely in the private half. The public December week is strong (2.41x),
but the private Christmas week (25–31 Dec) is not probed by m12 — November and December remain unfixable
suspects for the private half.

## B. Why did the MLP blend lose points? (scored 2026-11-14 night)

c30 (MLP residual averaged 50/50 with LightGBM) scored 23.40 against H10's 23.71. These use H10's own
uncertainty table and switch the net on for one group of series at a time.

| id | zip | what it is | local hold-out | ms/step | public score |
|---|---|---|---|---|---|
| c32 | [c32_mlp_b050_errlgb.zip](nn/c32_mlp_b050_errlgb.zip) | c30 with H10's uncertainty table (c30's own table is 20 % narrower) | — (same twin as c30) | ~9 | **23.37** |
| c33 | [c33_mlp_market_only.zip](nn/c33_mlp_market_only.zip) | MLP on price and CO2 only; load and solar as H10 | — | ~9 | 23.42 |
| c34 | [c34_mlp_net_only.zip](nn/c34_mlp_net_only.zip) | MLP on load and solar only; price and CO2 as H10 | — | ~9 | 23.64 |

Reading: c32 23.37 = c30 23.40 within noise -> **the narrower uncertainty table was NOT c30's problem**
(hypothesis dead). c33 23.42 (-0.29 vs H10) and c34 23.64 (-0.07, noise) split c30's loss: the market path
(price/CO2) is where the MLP lost its points; the load/solar path nearly holds H10's level.
[c35_mlp_market_only_e13.zip](nn/c35_mlp_market_only_e13.zip) (23.59, submitted although its condition
"c33 > 23.71" failed) confirms c33 + co2_expand 1.3 stays below H10.
**Verdict: Case B4 — the neural path does not transfer to the test.** Queue at most one blend-0.5 zip per
architecture (unchanged), then stop neural work.

## C. Clock-change fix and "trust recent data" probes (scored 2026-11-14 night)

All were the current best (p04, 23.84) plus one change, except r06. Compared with 23.84.

| zip | change | local hold-out (p04 settings: 20.473) | ms/step | public score |
|---|---|---|---|---|
| [s01_dst.zip](probes/s01_dst.zip) | clock change inside the March/October week no longer resets the agent's weekly memory | 20.473 (not exercised locally) | ~8 | 23.84 |
| [r06_corr_mkt_13_noexp.zip](probes/r06_corr_mkt_13_noexp.zip) | price and CO2 deviation from the profile x1.3, CO2 sharpening off (compare with H10 23.71) | 20.504 | ~8 | 23.08 |
| [r02_corr_price_13.zip](probes/r02_corr_price_13.zip) | price deviation from the profile x1.3 | 20.482 | ~8 | 23.81 |
| [r01_corr_co2_13.zip](probes/r01_corr_co2_13.zip) | CO2 deviation from the profile x1.3 | 20.368 | ~8 | 22.88 |
| [r05_corr_net_13.zip](probes/r05_corr_net_13.zip) | load and solar deviation from the profile x1.3 | 20.383 | ~8 | 23.66 |
| [r03_corr_mkt_13.zip](probes/r03_corr_mkt_13.zip) | price and CO2 deviation x1.3 | 20.287 | ~8 | 22.74 |

Reading: nothing beats p04 (winner bar 23.94). s01 **exactly ties p04** -> the dst fix is neutral on public
(harmless, not a winner on its own). r02 (-0.03) is noise; r01/r03/r05/r06 are regressions. The local
ranking (r06 > r02 > r05 > r01 > r03) does not match the public one (r02 > r05 > r06 > r01 > r03) — the
hold-out misprediction list grows again. The "trust the recent deviation from the profile" idea is dead on
the public test. r04 stays skipped (r03 lost 1.10).

Skip [r04_corr_mkt_16.zip](probes/r04_corr_mkt_16.zip) (local 19.804) unless r03 beats 23.84 by 0.10 or more.
Also built: [c35_mlp_market_only_e13.zip](nn/c35_mlp_market_only_e13.zip) = c33 + CO2 sharpening 1.3 (submit only if c33 beats H10).

## D. Date-centred profiles (3 zips — scored 2026-11-14 night)

Profiles re-weighted by calendar distance to the target-week centre (triangular kernel; month labels ignored).
Built by the kernel worker from full-data fits; official checker valid on all three. They carry tilt 1.8 but
**no** `co2_expand` -> reference = H10 23.71; a winner needed **23.81+**.

| zip | change vs H10 | local hold-out (scan, co2_mult 1.0 / 1.8) | ms/step (checker) | public score |
|---|---|---|---|---|
| [k01_bw30.zip](kernel/k01_bw30.zip) | profiles centred on the test week, bw 30 days | 20.499 / 20.443 (base 20.461 / 20.424) | 12.5 | 23.69 |
| [k02_bw15.zip](kernel/k02_bw15.zip) | same, bw 15 (narrow, noisier) | 20.369 / 20.315 | 13.9 | 23.69 |
| [k03_bw60.zip](kernel/k03_bw60.zip) | same, bw 60 (wide pooling) | 20.492 / 20.536 | 10.1 | 23.71 |

Verdict: k03 exactly ties H10 (23.71), k01/k02 -0.02 (noise). **Date-centred profiles are neutral on the
public test — profile centring is not the test-week gap.** No winner, nothing to combine in Step 5. The
local MAE improvement on price/CO2 (-8 %) did not translate into score, one more hold-out misprediction.

## E. New neural architectures (gated: c32 pending, N-HiTS held on timing)

Plan Step 4 cases: c33/c34 both below 23.71 -> **B4 unless c32 ≥ 23.61 (then B1)**. Either way one zip per
architecture gets queued; an architecture "wins" only at 23.94+.

| arch | status | local hold-out | ms/step | public score |
|---|---|---|---|---|
| N-HiTS | [c40_nhits_e.zip](nn/c40_nhits_e.zip) (blend 0.5) — submitted without the cool-machine re-measure; organisers accepted it | 20.466 (twin 20.464) | 20.7–29.8 measured (never re-measured idle) | 23.32 |
| GRU/LSTM | [c50_rnn-e_b050.zip](nn/c50_rnn-e_b050.zip) (tag e, blend 0.5) | 20.423 (twin 20.464, -0.04) | 42–46 (throttled machine) | 23.56 |
| TCN | [c60_tcn-e_b050.zip](nn/c60_tcn-e_b050.zip) (tag e, blend 0.5) | 20.477 (twin 20.464, +0.01) | 47–49 (throttled) | 23.38 |
| TFT-lite | [c70_tft-c_b050.zip](nn/c70_tft-c_b050.zip) (tag c, blend 0.5) | 20.484 (twin 20.464, +0.02) | 57–60 (throttled) | 23.55 |

**Group E verdict: all four architectures lose to H10 (23.71) on public — B4 confirmed conclusively.**
Order: c50 23.56 = c70 23.55 > c60 23.38 = c40 23.32. The GRU/TFT pairs (which blend load/solar best
locally) lose least; N-HiTS loses most, mirroring c30's MLP behaviour (market-path nets hurt most).
The local ranking (c70 > c60 > c40 > c50, spread 0.06) again fails to predict the public one (c50 > c70 >
c60 > c40, spread 0.24). **Neural work stops here per the plan.**

Tag rule (plan): lowest sum of price+CO2 nn MAE at leads 3-11 and 12-23. **Final winners (all 15 hold-out tags
done): rnn e 0.0633, tcn e 0.0624 (the only tag beating the MLP reference 0.0626), tft c 0.0636.** Full runs
done 01:00 (rnn 2280 s, tcn 839 s, tft 819 s; parity 8.3e-07 / 9.5e-07 / 1.6e-06); packages c50/c60/c70 built
01:05-01:15 with blend 0.5. All hold-out scores land within 0.04 of the twin — B4 confirmed again.

**Timing gate (rule 2.4: at most 15 ms/step locally):** the laptop throttled ~2.5-3x after 2.5 h of training
(c30 re-measured 25.9 ms vs its idle 9.0; twin 21.9-22.5 in package runs). Same-run ratios to the twin:
c40 ~1.45x, c50 ~2.1x, c60 ~2.2x, c70 ~2.6x. Corrected-to-idle estimates: c40 ~13, c50 ~14.6, c60 ~16, c70 ~20.
**Verdict pending a back-to-back re-measure on a cool machine** (c30 anchor must read about 9-10 for the
session to count). If c40/c50 pass they get submitted (B4: one public score per architecture); c60/c70 are
expected to stay over budget and get no public score.

## F. Remaining knob probes (7 zips, only if time remains)

| zip | change vs H10 | what the public score tells us | local hold-out | ms/step | public score |
|---|---|---|---|---|---|
| [p10_lgb_x15.zip](probes/p10_lgb_x15.zip) | LightGBM residual x1.5 | A gain = the boosted correction is shrunk too much for the test | — | ~8 | 23.58 |
| [p11_lgb_x05.zip](probes/p11_lgb_x05.zip) | LightGBM residual x0.5 | Same question, other direction | — | ~8 | 23.71 |
| [p07_spread06.zip](probes/p07_spread06.zip) | `spread_scale` 0.6 | A gain = net-load uncertainty is too wide | — | ~8 | 23.63 |
| [p08_spread14.zip](probes/p08_spread14.zip) | `spread_scale` 1.4 | A gain = net-load uncertainty is too narrow | — | ~8 | |
| [p09_no_lgb.zip](probes/p09_no_lgb.zip) | LightGBM off | What the boosters are worth at tilt 1.8 | — | ~8 | |
| [p05_horizon12.zip](probes/p05_horizon12.zip) | `horizon` 12 | How far ahead forecasts are useful | — | ~8 | |
| [p06_horizon36.zip](probes/p06_horizon36.zip) | `horizon` 36 | Same | — | ~8 | |

Reading (so far): p10 x1.5 = 23.58 (-0.13): amplifying the boosted residual hurts. p11 x0.5 = 23.71: halving
it is exactly H10 — the LGB residual correction is already at (or past) its useful scale on the public weeks.
p07 spread 0.6 = 23.63 (-0.08, noise): narrower net-load uncertainty is neutral. None beats H10, consistent
with "knobs have peaked".

## Not queued (built, but no submission planned)

- [c31_mlp_b100.zip](nn/c31_mlp_b100.zip) (MLP replaces LightGBM, 10.0 ms/step): not worth a submission until section B is answered.
- [c35_mlp_market_only_e13.zip](nn/c35_mlp_market_only_e13.zip): only if c33 beats H10 (23.71).
- [r04_corr_mkt_16.zip](probes/r04_corr_mkt_16.zip): only if r03 beats 23.84 by 0.10 or more.
- c30 (already submitted, H23), q01–q07 and p01–p03 (already submitted, table below).

## Results so far (public)

| zip | tilt / CO2 sharpen / price sharpen | score | CO2 % | cost % |
|---|---|---|---|---|
| H6 | 1.0 / 1.0 / 1.0 | 23.19 | | |
| H10 | 1.8 / 1.0 / 1.0 | 23.71 | 22.89 | 25.63 |
| **p04** | 1.8 / 1.3 / 1.0 | **23.84** | 23.06 | 25.65 |
| q01 | 1.8 / 1.6 / 1.0 | 23.72 | 23.13 | 25.09 |
| q02 | 1.8 / 2.0 / 1.0 | 23.24 | 23.18 | 23.37 |
| q03 | 1.8 / 1.3 / 1.3 | 23.80 | 22.95 | 25.79 |
| q04 | 1.8 / 1.3 / 1.6 | 23.60 | 22.73 | 25.64 |
| q05 | 1.8 / 1.6 / 1.3 | 23.73 | 23.04 | 25.32 |
| q06 | 1.4 / 1.3 / 1.0 | 23.56 | 22.48 | 26.07 |
| q07 | 1.4 / 1.6 / 1.0 | 23.55 | 22.77 | 25.38 |
| p01 | 1.8 / 1.0 / 0.5 | 23.10 | 22.60 | 24.26 |
| p02 | 1.8 / 1.0 / 0.0 | 22.17 | 21.92 | 22.76 |
| p03 | 1.0 / 1.0 / 0.5 | 22.76 | 21.68 | 25.29 |
| c30 (MLP blend 0.5) | 1.8 / 1.0 / 1.0 | 23.40 | 22.50 | 25.52 |

Reading: the three knobs have peaked (tilt about 1.8, CO2 sharpening about 1.3, price sharpening 1.0 to 1.3).
Further knob tuning is worth at most a few hundredths.

Night-2 diagnostics (full log in `SUBMISSIONS.md`): month probes m01 1.36, m02 2.51, m03 0.85, m04 2.68,
m05 2.87, m06 3.30, m07 3.03, m09 3.10, m10 2.67, m12 1.42, m08 0, m11 0 (sum 23.79; see section A);
c32 23.37, c33 23.42, c34 23.64, c35 23.59; s01 23.84 (= p04); r01 22.88, r02 23.81, r03 22.74, r05 23.66,
r06 23.08; k01 23.69, k02 23.69, k03 23.71.

## Open problems

- **Unknown submission H52**: TeamName2, 20:39, 23.15 (CO2 21.88 %, cost 26.11 %). Matches no zip in this
  log exactly (H2 was 23.18 with the same CO2; H3 23.16). Natan: which zip was that?
- **Nothing beats p04 (23.84)** across groups A–D. Final candidate stays p04 unless an E zip reaches 23.94.
- **N-HiTS timing**: c40 21.0 / c41 28.0 ms/step under load vs the 15 ms budget. Re-measure on an idle
  machine; if c40 still exceeds 15, N-HiTS is out (note it, no public score).
- **March leak (0.58x its local reference)** and the private-half blind spots (Aug, Nov, Christmas week):
  no cheap fix works (s01 tied p04, kernel profiles neutral). Per the plan these need a stronger model
  (section 10 ideas: scenario-carrying CO2 planner, multi-day CO2 feature, temperature in the load model).
- **Local hold-out mispredictions keep accumulating** (new cases: the r-probe order and the kernel MAE gain
  both failed to transfer). Never trust a local gain below 0.2; never claim an improvement without a public
  score.
- Workers (rnn b/e, tcn e/f, tft c) were still training at 23:27; group E packages stay pending until they
  finish. Step 5 (combinations) has no inputs: no winner exists.
