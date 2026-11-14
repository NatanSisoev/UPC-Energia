# demo/ — DEMO track (owner: Sami)

**Decision: an interactive 3D visualization of the campus with full user control.** The jury weighs the presentation, clarity of
reasoning, data analysis and strategy justification decisively, so the 3D scene must *explain* the strategy, not just look good.

## Concept

A 3D Campus Nord scene (stylised buildings, rooftop PV, a battery container, the grid connection) driven by the real hourly trace.
Energy flows animate between solar, campus buildings, battery and grid; the battery fills/empties; the grid line glows by CO2 intensity.

**Controls (full control):** orbit/pan/zoom camera + preset views; play/pause/speed; timeline scrubber (hour/day/week); pick any train week;
toggle layers (solar, battery, grid, CO2 heat, price); compare mode (no battery / template baseline / our agent, side by side or toggled);
click any element (building, PV, battery, grid) for live numbers; what-if panel (CO2 vs cost weight, battery size) if time allows.

**Overlay HUD:** current hour, SOC bar, setpoint kW, grid import, CO2 intensity, price, cumulative CO2 and € saved vs no battery, infractions = 0.

## Suggested stack

Static site (no build step, runs from `file://` or any static host): **three.js** (`cdnjs`/`jsdelivr`, pinned version) + OrbitControls, vanilla JS or small Vite app.
Charts with a light lib (uPlot/Chart.js) in side panels. Load data from `demo/data/trace_<name>.json`. Keep it offline-capable for the presentation
(vendor the libs into `demo/vendor/` before the final day) and record a fallback video.

## Data contract (from the model side)

`python -m sim.export_trace agent/agent.py --name baseline` writes `demo/data/trace_<name>.json`:

```
{ meta, summary:{score,d_co2_pct,d_cost_pct,violations,co2_saved_kg,cost_saved_eur},
  weeks:[{start,end,score,d_co2_pct,d_cost_pct,violations}],
  cols:{t[],load_kw[],pv_kw[],price[],co2[],setpoint_kw[],soc_kwh[],grid_kw[],grid_base_kw[]} }   # hourly, columnar
```
`setpoint_kw > 0` = charging, `< 0` = discharging. Capacity 2,000 kWh, ±500 kW. Natan re-exports with `--name mpc` when a better agent lands; build the viewer to load several traces for compare mode.
A baseline trace is already in `demo/data/` (generated from the real train data).

## Story the scene must support (see PLAN.md)

1. Problem and stakes → 2. what the data says (CO2/price peaks, solar surplus) → 3. strategy (forecast + 24 h optimisation, zero infractions) →
4. results vs no battery / template → 5. live replay of a week → 6. limits and next steps. Prepare a 3-minute pitch and a fallback screen recording.

## Rules

Demo code may use any libs (it is not submitted), but read results produced by `sim/` so numbers match the leaderboard model. Only edit `demo/`.
Missing data or a new field in the trace? Ask Natan/Aiman, don't edit `sim/`.
