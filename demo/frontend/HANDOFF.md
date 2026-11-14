# Frontend handoff — state at 2026-11-14 (end of session 2)

## Done (cumulative)
- **Challenge-exact engine in the browser** (`src/sim/challenge.ts`): physics, clamp/infractions, score (`0.7·ΔCO₂% + 0.3·ΔCost% − 0.2·viol`, export = 0, imports only), 24 h MPC, template.
  `npm run validate` → max |setpoint diff| ~4e-13 kW on all 35 real weeks. Session 2 added **optional MPC knobs** (`MpcOptions`: `alphaCo2`, `betaCost`, `horizon`); defaults reproduce Python exactly (validate unchanged).
- **Real data replay**, scene, layers, panels: see README. Session 2 added street lamps (lit after dusk), cars on the wide roads (wall-clock animated), striped pitches with markings and a running track around the big ground (`decorateGround()` in `scene/world.ts`).
- **Guided pitch** (`src/pitch/`): `P` or the **▶ Pitch** button = 3:00 automatic film (10 scenes: problem → prices → solar → strategy → agent by hour → why 24 h → live week → results → what-if → limits). `M` or the 🎤 button = **presenter mode** (same scenes, manual). Keys: `←/→`, `Space` (next in presenter / pause in auto), `A` toggle auto/presenter, `1–9,0` jump, `Home/End`, `Esc` exit. Scenes are data in `pitch/script.ts` (camera from→to drift, layers, route, speed, HUD flags); captions are functions of `Facts`, so every number comes from `replay.json` / `challenge.ts`. Presenter mode also shows per-scene speaker notes.
- **Insights view** (`/insights`, **📊 Insights** button, `components/Insights.tsx`): Price & CO₂ by hour (mean + 10–90 % band), Solar & demand (season / weekday), What the agent does (mean action by hour, all 35 weeks, vs template), Why 24 h (score vs look-ahead 1…48 h), What-if (CO₂-vs-cost weight slider re-runs the real agent on the replayed week; weight sweep; battery-size sweep). Takeaway lines are computed from the data, never typed. Heavy sweeps run in a **Web Worker** (`sim/sweeps.worker.ts` + `sweeps.core.ts`), pre-warmed 2.5 s after load.
- **Fixes**: HUD layout verified at 1280×720, 1440×900, 1920×1080 (right panel overflow; `.panel` default `position:relative` was overriding Tailwind `absolute`, now in `@layer components`); clock/sun/shares now use the real per-row timestamps (`weekMsAt`), so weeks with data gaps are right; removed unused maplibre deps; **restored `src/lib/` (format, sun)**, which a root `.gitignore` `lib/` rule had kept out of git — fresh clones did not build before.
- **Offline**: `npm run build && npx vite preview` makes zero requests outside localhost (checked with `performance.getEntriesByType('resource')`); fonts and the worker are bundled.

## Known issues / limits
1. `src/lib/format.ts` and `src/lib/sun.ts` were **re-created from their call sites** (the originals were never committed). Sun position is the NOAA algorithm with Europe/Madrid DST applied to the stored local-naive clock; sanity-checked (solstice noon ≈ 72°, winter ≈ 24°) but not diffed against the original.
2. The in-app browser pane is software-rendered (screenshots time out, scripts run slowly). Layout was verified by measuring panel rectangles at the three widths plus screenshots of scenes; **look at the pitch once on a real GPU before the demo** (frame rate was not measured).
3. Insights sweeps use 7 spread weeks (`SWEEP_WEEKS`) to stay fast; "agent action by hour" uses all 35 weeks. Numbers differ slightly from all-week means.
4. Pitch scene durations assume the sweeps finished (pre-warmed). On a very slow machine the agent/horizon scenes may show a short "Running the real agent…" bar.
5. Pitch markings assume near-rectangular pitches (stripes follow the outline, lines use the bounding box). Water, richer roofs, building entrances are not done.
6. Side-by-side compare (split view) in the 3D scene: not done (the Impact tab has the numbers).
7. HMR of `useSim.ts` recreates the store: reload the page after editing it. Dev-only `window.__app` exposes `useSim`, `usePitch`, `SCENES`, `camera` for scripted checks.
8. Bundle > 500 kB (deck.gl): fine for a local demo. `npm run lint` (oxlint) only reports Fast-Refresh export warnings.

## Backlog (highest value first)
1. Rehearse the 3-min pitch on the demo machine; trim `dur` per scene in `pitch/script.ts`; record the fallback screen video.
2. Side-by-side compare in the scene (no battery vs template vs MPC).
3. More polish toward the reference look: water, green roofs, entrances, MareNostrum chapel.
4. Hard Mode scenario (natan branch `agent_hard/`) as a second engine config.

## How to refresh data after model changes
```bash
cd demo/frontend
<repo>/.venv/Scripts/python -I scripts/export_replay.py --repo <checkout that has data/train, sim/ and agent/>   # rewrites public/data/replay.json
npm run validate          # TS port must still match Python; if agent/agent.py changed, port the change to src/sim/challenge.ts first
npm run build
```
Node ≥ 22 is required (Vite 8, `--experimental-strip-types` for validate).
