# Campus Nord Energy Twin — demo frontend

Game-style 3D digital twin of UPC Campus Nord that replays real challenge weeks and lets the audience change the campus (solar, battery) and watch the real
challenge agent and score react. Stack: Vite 8 · React 19 · TypeScript · deck.gl 9 (standalone `Deck`, no basemap tiles) · Tailwind 4 · zustand · recharts · Nunito (bundled).

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # tsc -b && vite build (must stay green)
npm run validate   # TS engine vs Python results on all 35 real weeks (must stay green)
```

## Architecture

```
src/sim/challenge.ts   PURE port of sim/simulator.py + agent/agent.py (24 h MPC) + template agent. No imports. Units/sign = challenge (kW, kWh, EUR/kWh, kg/kWh, + = charge).
src/sim/engine.ts      per-building disaggregation of the REAL campus load, per-building solar from the real plant yield, battery-fleet -> one equivalent battery, occupancy model.
src/store/useSim.ts    zustand store. Playback clock over one real week; `recompute()` re-runs mpc/template/none simulations when week/solar/battery/agent change;
                       `snapshotAt(tMin)` derives everything shown (cumulative KPIs, soc, sun, weather). Heavy arrays live in `derived.current`, not in React state.
src/scene/geo.ts       local metric frame + polygon helpers.
src/scene/network.ts   buried cable network: MST over substation/battery/buildings, orthogonal routing on the street grid, true subtree power flows per cable.
src/scene/world.ts     static geometry (buildings, PV candidates, trees, roads, substation, battery yard, clouds) + `buildLayers()` per-frame deck.gl layer factory (layers, day/night, heatmap, people, weather).
src/components/        MapView (Deck, camera, lighting, render loop) · KpiBar · Advisor · TimeBar · RightPanel (Campus/Solar/Battery/Impact) · Controls (camera, X-ray, Sun, Layers, Charts) · Dashboard · Legend · ui
scripts/               export_replay.py · build-campus-data.mjs · build-ground-data.mjs · validate.ts
public/data/           replay.json · campus.json · ground.json (see ../README.md)
```

## Conventions

- Numbers on screen must come from `challenge.ts` (the same formulas as `sim/`). Never add a "demo-only" metric formula.
- Deterministic: no `Math.random`/`Date.now` in sim or scene geometry (use `hash()` from `src/data/scenario.ts`).
- Scene layers are rebuilt ~30 fps; keep `data` arrays referentially stable (build once in `buildWorld`) and use `updateTriggers`.
- Per-building load/solar are an illustrative split of the real campus totals; campus totals are real. As-built PV = 160 kWp (assumption from the ~144 kW peak in the data).
- `AgentKind` `none` = no battery, `template` = organisers' rules, `mpc` = our agent.

Known limits and the backlog: see [HANDOFF.md](HANDOFF.md).
