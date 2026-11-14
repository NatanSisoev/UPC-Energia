# Hard Mode submit queue

One file to work from. Submit a zip, write the public score in the last column, tell Claude.
**Best so far: 23.84** = [p04_co2_expand13.zip](probes/p04_co2_expand13.zip) (H10 + CO2 forecast sharpened x1.3).
All zips below pass the official checker. Local "hold-out" numbers have not predicted public results well.

## A. Submit next: month probes (12 zips)

Each zip is H10 that only acts in one month and idles otherwise. Write down the two absolute numbers the
leaderboard shows. This is now the most useful thing to submit, because it answers three questions at once:
where the points leak on the real test, whether the agent's calendar works on the server (months that
return exactly 0), and which weeks the public half contains.

Points of a month = 0.7 x kg / 602.5 + 0.3 x EUR / 949.8 (public totals: 60,250 kg and 94,980 EUR).

| zip | month | public CO2 avoided kg | public cost saved EUR |
|---|---|---|---|
| [m12_only.zip](probes/m12_only.zip) | Dec (Christmas week) | | |
| [m11_only.zip](probes/m11_only.zip) | Nov (no load/solar in train) | | |
| [m03_only.zip](probes/m03_only.zip) | Mar (clock change) | | |
| [m10_only.zip](probes/m10_only.zip) | Oct (clock change) | | |
| [m08_only.zip](probes/m08_only.zip) | Aug (largest local gap) | | |
| [m06_only.zip](probes/m06_only.zip) | Jun | | |
| [m04_only.zip](probes/m04_only.zip) | Apr | | |
| [m01_only.zip](probes/m01_only.zip) | Jan | | |
| [m02_only.zip](probes/m02_only.zip) | Feb | | |
| [m05_only.zip](probes/m05_only.zip) | May | | |
| [m07_only.zip](probes/m07_only.zip) | Jul | | |
| [m09_only.zip](probes/m09_only.zip) | Sep | | |

Local reference, hold-out week of each month in one glued run (score points, agent / perfect foresight):
Sep 1.67 / 1.71, Oct 2.00 / 2.30, Dec 0.59 / 0.75, Jan 1.39 / 1.66, Feb 1.25 / 1.36, Mar 1.46 / 1.32,
Apr 1.73 / 2.05, May 1.99 / 2.05, Jun 2.09 / 2.57, Jul 2.78 / 2.57, Aug 3.54 / 4.05. Total 20.46 / 22.40.
November is not available locally.

## B. Then: why did the MLP blend lose points? (3 zips)

c30 (MLP residual averaged 50/50 with LightGBM) scored 23.40 against H10's 23.71. These use H10's own
uncertainty table and switch the net on for one group of series at a time.

| id | zip | what it is | public score |
|---|---|---|---|
| c32 | [c32_mlp_b050_errlgb.zip](nn/c32_mlp_b050_errlgb.zip) | c30 with H10's uncertainty table (c30's own table is 20 % narrower) | |
| c33 | [c33_mlp_market_only.zip](nn/c33_mlp_market_only.zip) | MLP on price and CO2 only; load and solar as H10 | |
| c34 | [c34_mlp_net_only.zip](nn/c34_mlp_net_only.zip) | MLP on load and solar only; price and CO2 as H10 | |

## C. Remaining knob probes (lower priority)

| zip | change vs H10 | what the public score tells us | public score |
|---|---|---|---|
| [p10_lgb_x15.zip](probes/p10_lgb_x15.zip) | LightGBM residual x1.5 | A gain = the boosted correction is shrunk too much for the test | |
| [p11_lgb_x05.zip](probes/p11_lgb_x05.zip) | LightGBM residual x0.5 | Same question, other direction | |
| [p07_spread06.zip](probes/p07_spread06.zip) | `spread_scale` 0.6 | A gain = net-load uncertainty is too wide | |
| [p08_spread14.zip](probes/p08_spread14.zip) | `spread_scale` 1.4 | A gain = net-load uncertainty is too narrow | |
| [p09_no_lgb.zip](probes/p09_no_lgb.zip) | LightGBM off | What the boosters are worth at tilt 1.8 | |
| [p05_horizon12.zip](probes/p05_horizon12.zip) | `horizon` 12 | How far ahead forecasts are useful | |
| [p06_horizon36.zip](probes/p06_horizon36.zip) | `horizon` 36 | Same | |

## C2. Clock-change fix and "trust recent data" probes (submit before section C)

All are the current best (p04, 23.84) plus one change, except r06. Compare with 23.84.

| zip | change | local hold-out (p04 settings: 20.473) | public score |
|---|---|---|---|
| [s01_dst.zip](probes/s01_dst.zip) | clock change inside the March/October week no longer resets the agent's weekly memory | 20.473 (not exercised locally) | |
| [r06_corr_mkt_13_noexp.zip](probes/r06_corr_mkt_13_noexp.zip) | price and CO2 deviation from the profile x1.3, CO2 sharpening off (compare with H10 23.71) | 20.504 | |
| [r02_corr_price_13.zip](probes/r02_corr_price_13.zip) | price deviation from the profile x1.3 | 20.482 | |
| [r01_corr_co2_13.zip](probes/r01_corr_co2_13.zip) | CO2 deviation from the profile x1.3 | 20.368 | |
| [r05_corr_net_13.zip](probes/r05_corr_net_13.zip) | load and solar deviation from the profile x1.3 | 20.383 | |
| [r03_corr_mkt_13.zip](probes/r03_corr_mkt_13.zip) | price and CO2 deviation x1.3 | 20.287 | |
| [r04_corr_mkt_16.zip](probes/r04_corr_mkt_16.zip) | price and CO2 deviation x1.6 (skip unless r03 gains) | 19.804 | |

Also built: [c35_mlp_market_only_e13.zip](nn/c35_mlp_market_only_e13.zip) = c33 + CO2 sharpening 1.3 (submit only if c33 beats H10).

## D. Pending (workers running)

Step-by-step plan for whoever continues: `docs/HARD_MODE_PLAN.md`.

- Date-centred profiles: 3 candidate zips.
- N-HiTS, GRU/LSTM, TCN, TFT-lite: 2 zips each.
- [c31_mlp_b100.zip](nn/c31_mlp_b100.zip) (MLP replaces LightGBM) is built but not worth a submission until section B is answered.

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
