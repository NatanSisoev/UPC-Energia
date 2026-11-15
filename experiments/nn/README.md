# Neural forecasters for the Hard Mode agent

A net is trained offline (torch), exported as float32 npz and executed in the agent with pure numpy.
It predicts a RESIDUAL on top of the *linear* forecast: `y = (truth - lin) / scale`, shape [4,24] (price, co2, load, pv x leads 0..23).
In the agent (`agent_hard_nn/agent.py::_nn_apply`): `final = lin + (1-b)*(lgb-lin) + b*scale*out` (b=1: NN replaces LightGBM).

## Architecture contract (copy `archs/mlp/`)
- `archs/<name>/model.py`: `build(cfg, dims) -> nn.Module`, forward(hist[B,96,11], fut[B,24,24], stat[B,21]) -> [B,4,24]; `CONFIGS = {tag: cfg}`.
  `dims = {L:96, C:11, H:24, F:24, S:21}`. Training keys read from cfg: lr, wd, batch, max_epochs, patience (defaults 1e-3, 1e-2, 128, 60, 8).
- `archs/<name>/forward.py`: imports numpy + math ONLY. `nn_forward_<name>(W, hist, fut, stat, cfg)` for ONE sample -> (4,24);
  W = dict of float32 arrays keyed by `state_dict()` names. Last line `NN_REGISTRY["<name>"] = ...`. File is pasted verbatim into agent.py:
  no `np.stack`, `eval/exec/compile/vars/globals/locals`, no os/sys/importlib/inspect. Use tanh-GELU (`GELU(approximate="tanh")`) so numpy matches torch.
  Only use state_dict entries (parameters/buffers); put any constants in buffers.

## Commands (repo root, `PYTHONPATH=.`, `.venv/Scripts/python -m ...`)
    experiments.nn.dataset [--which eval holdout full] [--rescale]   # builds data/nn/ds_*.npz + scale.json (already built, ~2 min)
    experiments.nn.run --arch NAME --tag TAG --mode holdout --seeds 3    # early stop on months 2/6/10, refit on all, report + parity
    experiments.nn.run --arch NAME --tag TAG --mode full    --seeds 3    # reuses the epochs of holdout mode
    experiments.nn.package --id cNN --members NAME:TAG [A:T ...] --blend 0.5 [--name X]  # hold-out score vs H10 twin + submission zip
    experiments.nn.equiv_test                                         # agent_hard_nn without "nn" == agent_hard (max diff 0)
Outputs: `experiments/nn/runs/<arch>_<tag>/<mode>/`, `experiments/nn/packages/<id>/`, `submissions/hard/nn/<id>_<name>(.zip)`.
Use a NEW id every package run (it refuses to overwrite). Ensemble weight = 1/(members x seeds), all averaged before the blend.

## Data (data/nn/, float32; N = 9408 holdout / ~15k full / 1848 eval rows; Nov has no load/solar -> no rows)
hist [N,96,11], fut [N,24,24], stat [N,21], y/lin/truth [N,4,24] (+ lgb in ds_eval), known, month (calendar), block, step, ts.
`y` is NaN for: missing truth, market leads < known (3), meter outage, pv at night, days the split must not see. Loss = masked Huber.
scale.json = std(truth - lin) over ds_holdout (price .0246, co2 .0194, load 111, pv 277), computed in pass 1 with scale 1, then used by all features.
Pseudo-weeks: 168 rows from every 48th row of a month's allowed rows, fresh agent per block, profiles+kbar leave-BLOCK-out (exact block days dropped).
ds_holdout allowed rows = before each month's hold-out week; ds_full = all rows. ds_eval = hold-out weeks as ONE glued run with the twin.
Reference MLP: best epoch 2 of 10 (overfits fast: rows overlap, ~9k rows), 16 s for 3 seeds; parity 1.8e-6.

## Channels
hist (oldest first; rows before the week start = 0): 0 price res, 1 co2 res, 2 load res (val-base)/scale; 3 (pv-kbar*clear)/scale_pv;
4 clear/1700; 5 irradiance/1000; 6 (Tamb-15)/10; 7 price known, 8 load known; 9,10 sin/cos hour.
fut F=24: 0 lead/24; 1,2 sin/cos hour; 3-6 loadtype one-hot (4); 7-9 daytype one-hot (3); 10 clear/1700; 11 kbar;
12-14 (lin-base)/scale price, co2, load; 15 (lin_pv-kbar*clear)/scale_pv; 16-18 base/scale price, co2, load (NOT centred: raw, ~5 in magnitude);
19 known flag (lead<3); 20-23 hol_cls/4, bridge, to_off/8, since_off/8.
stat S=21: 0 hours since week start/168 (cap 1); 1,2 sin/cos month; 3-14 per series price, co2, load: f1, f1_ok, f2, f2_ok (last / 24 h mean residual);
15-18 k_last, ok, k_day, ok; 19 last Tamb, 20 24 h mean Tamb ((x-15)/10).

## Gotchas
- fut 16-18 are uncentred: add a LayerNorm / input standardisation in your net.
- Evaluate with `report` on ds_eval only; ds_holdout days never overlap it. `err_nn` (net-load scenario table) is fitted on ds_eval itself (shape of err_lgb) -> small optimism in the hold-out score.
- The local H10 twin is the stripped model (wmult, wmult_pow removed), co2_mult 1.0: 20.464. Shipped zips use agent_hard/model_lgb.json (co2_mult 1.8).
- Hold-out Aug week (days 10-16) overlaps days 10-14 used by the twin's ridge/boosters (their protocol).
- Timings swing 3-4x on this laptop; MLP adds ~1.5 ms/step. Check `package_info.json` after packaging.
- Missing weather values = 0 with a flag only for price/load known; Tamb has no flag.
