# Frontend handoff — state at 2026-11-14 (end of session 1)

## Done
- **Challenge-exact engine in the browser** (`src/sim/challenge.ts`): physics, clamp/infractions, score (`0.7·ΔCO₂% + 0.3·ΔCost% − 0.2·viol`, export = 0, imports only), 24 h MPC, template.
  `npm run validate` → max |setpoint diff| ~4e-13 kW on all 35 real weeks (needs `public/data/replay.json` including the `ms` per-row timestamps; weeks can contain data gaps).
- **Real data replay**: 35 whole-week blocks; campus totals (load, PV, price, CO2, irradiance, temperature) are real; per-building split is illustrative.
- **Scene**: OSM buildings with floors/windows (lit at night by occupancy), parapets, rooftop plant, PV arrays that scale with the Solar tab; streets, parks, trees, neighbours;
  substation + battery yard (+ SOC beacon); buried cable network with live flows/pulses; real sun (lighting, projected shadows, CSS sky); diorama plate; camera limits (no void/underside).
- **Controls**: play/speed, scrubbable week ribbon, camera presets, rotate (right-drag, ⟲⟳, Q/E) and tilt, X-ray, **Sun freeze** (+ time-of-day slider), **Layers** (power heatmap, people, weather, solar, cables, shadows, trees, labels), charts drawer.
- **Panels**: Campus (inspector, top consumers), Solar lab (per-roof coverage/tilt, panel tech), Battery depot (catalogue, derate), Impact (no-battery vs template vs MPC for the week, formula, 35-week bars), Agent card (decision + reason + 24 h plan).

## Known issues / limits (fix first)
1. **Layout never visually verified after the last responsive pass** at 1024×768 and ≥1440 (bottom row = Legend · TimeBar · Controls; right panel 340–360 px). The in-app browser pane was flaky (screenshots time out); verify in a normal browser, test 1280/1440/1920 and fix overlaps.
2. **Layers menu, Sun popover, rotate/tilt buttons, charts drawer, Solar/Battery/Impact tabs were not exercised in a browser** — only compiled. Click through every control and fix what is broken (people/weather/heat layers especially).
3. **Clock/sun/building-share use `start + tMin`**, but some weeks contain data gaps (the simulation uses the true per-row `ms`). Labels and sun can be off by hours in those weeks. Use `week.ms[h]` (+ interpolation) in `snapshotAt`, `buildLoadShares`, TimeBar ribbon.
4. Clouds are a visual proxy (derived from irradiance vs clear-sky); at night cloudiness is a constant 0.25.
5. HMR of `useSim.ts` recreates the store and leaves the loader up — reload the page after editing the store.
6. `maplibre-gl` and `@deck.gl/mapbox` are no longer used (standalone Deck) → remove from package.json. Bundle > 500 kB warning (deck.gl): ok for a local demo.
7. SOLAR: `PV_ASBUILT_KWP = 160` is an assumption; the real plant peaks at ~144 kW in the data.
8. No unit tests besides `scripts/validate.ts`; `npm run lint` not run.

## Backlog for the jury story (highest value first)
1. **Guided pitch mode**: a 3-minute scripted tour (camera moves + overlays + narration captions) following PLAN.md's story: problem → data insights → strategy → live week → results → limits. One button, fully automatic, with a keyboard-controlled "presenter" version.
2. **Data-insights page** (real figures): daily price/CO2 profile, solar curve, demand by weekday, "why 24 h look-ahead is enough", agent action by hour of day (see docs/HANDOFF.md findings; Aiman's EDA when available).
3. **What-if sliders** for the strategy: CO₂ vs cost weight (needs the TS MPC `ALPHA_CO2/BETA_COST` exposed), battery size sweep curve (score vs MWh/MW).
4. **Compare mode side-by-side / split view** (no battery vs template vs MPC) in the scene, not only in the Impact tab.
5. Polish the diorama toward the reference renders: stronger pitches with running tracks and markings, cars on roads, water, richer roofs (green roofs, blue panels), street lamps lit at night, building entrances/canopies, MareNostrum chapel detail.
6. **Offline-proof**: `npm run build` + `vite preview` must work with no network (fonts are bundled; no tile servers are used). Verify, then record a fallback screen video.
7. Hard Mode (natan branch, `agent_hard/`): 3 h look-ahead, 6 MWh / 1.5 MW, 12× solar. Optional second scenario in the engine (needs a TS port of that agent + weather telemetry).

## How to refresh data after model changes
```bash
cd demo/frontend
<repo>/.venv/Scripts/python -I scripts/export_replay.py --repo <checkout that has data/train, sim/ and agent/>   # rewrites public/data/replay.json
npm run validate          # TS port must still match Python; if agent/agent.py changed, port the change to src/sim/challenge.ts first
```
