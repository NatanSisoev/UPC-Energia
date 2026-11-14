# AGENT HANDOFF — demo frontend "brain" workstream

This file coordinates sessions working **concurrently in this same folder**
(`demo/frontend/`, branch `sami`). Scope ownership is split to avoid conflicts.

## Owner of this workstream (you, the delegated session)

You are making the demo's **simulation brain match the contest's brain**:

1. **Bridge metrics to the real simulator.**
   Read `sim/simulator.py`, `sim/data.py` and `CHALLENGE.md` at the repo root
   (go up two levels: `../../sim/`, `../../CHALLENGE.md`). Extract the exact
   metric conventions (price/CO₂ units, export compensation 0.04 €/kWh,
   violation definition, scoring weights 70 % CO₂ / 30 % cost, percent
   handling) and rebuild the demo engine on top of them, ideally as JSON-able
   pure functions that later can be validated against `python -m sim.evaluate`.

2. **Upgrade the battery dispatch heuristic.**
   Replace the price-quantile rule in `src/sim/engine.ts::agentFleetTarget`
   with a presentation-grade dispatch: tariff arbitrage + CO₂-aware charging +
   surplus PV absorption + SOC / power safety margins (challenge clamp: SOC
   10–90 %? — confirm exact bounds from `sim/simulator.py`; the submission
   agent must have ZERO violations). It must stay deterministic (no Date.now,
   no Math.random — use `hash()` from `src/data/scenario.ts`).

## Files you own (edit freely)

- `src/sim/engine.ts` — physics + dispatch (your main file)
- `src/data/scenario.ts` — price/CO₂/clock curves may need unit fixes
- anything you add under `src/sim/` (e.g. `metrics.ts`)

## Files you must NOT edit (another session is actively working on them)

- `src/components/**` (MapView, RightPanel, KpiBar, TimeBar, Legend…)
- `src/App.tsx`, `src/routes.tsx`, `src/main.tsx`
- `src/store/useSim.ts` — glue code; it calls your engine functions. If you
  need a signature change there, make the change **self-contained**: keep old
  exported names working (wrappers are fine) and list needed store edits at
  the end of your final message instead of editing the file.

## API contract currently consumed elsewhere (keep these names)

From `src/sim/engine.ts`:
`buildingLoadKw`, `buildingSolarKw`, `installedKwp`, `agentFleetTarget`
(returns `{ fleetKw: number; reason: string }` with `fleetKw` as a fraction
of rated power), `allocateFleet(units, fleetFraction, netKw) -> number[]`
(kW per unit, +charge), `stepSoc(unit, unitKw, dtMin) -> soc`, `modelOf`,
`rteOf`, `panelKwm2`.

From `src/data/scenario.ts`: `priceAt(tMin)`, `co2At(tMin)`,
`hourOfDay`, `dayOfWeek`, `sunFactor`, `cloudAt`, `hash`, `dayLabel`,
`clockLabel`, `HISTORY_HOURS`, `FORECAST_HOURS`, `DEMO_EPOCH_MS`.

`tMin` is **absolute minutes from DEMO_EPOCH** (fixed Mon 2026-03-16 00:00,
CET) and may be negative (history playback). Keep that convention.

## Constraints

- Deterministic end-to-end: same inputs → same outputs, across reloads.
- TypeScript strict: `npx tsc -b` must pass before you declare done.
- No new runtime dependencies without writing the reason in your final message.
- Engine stays pure (no browser APIs) so it can be unit-tested and, later,
  re-checked against `sim/` outputs in pytest.

## Validation you can run

```bash
npx tsc -b                 # typecheck
npm run dev                # dev server (probably already running on :5173)
cd ../.. && pytest tests/test_sim.py   # our sim tests (python side)
```

## Done means

- `tsc -b` green, app still renders (the other session's HMR picks your
  changes up instantly — coordinateBig changes in one commit, don't dribble).
- A short summary of: which sim/ conventions you adopted, any unit errors
  you found and fixed, exact SOC bounds, and the remaining store touches.
