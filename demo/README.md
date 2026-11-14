# demo/ — DEMO track (owner: Sami)

The jury weighs the presentation, clarity of reasoning, data analysis and strategy justification decisively, so the demo must *explain* the
strategy, not just look good.

## What exists (state 2026-11-14)

**`demo/frontend/` — an interactive, game-style 3D digital twin of UPC Campus Nord** (Vite + React + TypeScript + deck.gl + Tailwind 4 + zustand + recharts).
Run it: `cd demo/frontend && npm install && npm run dev` → http://localhost:5173. Details, architecture and the next-session backlog:
[`frontend/README.md`](frontend/README.md) and [`frontend/HANDOFF.md`](frontend/HANDOFF.md).

Key points:
- It replays **real campus weeks** (35 whole-week blocks, the same blocks `python -m sim.evaluate --weeks` scores) from `frontend/public/data/replay.json`.
- A **TypeScript port of `sim/simulator.py`, `agent/agent.py` (24 h MPC) and the template agent** (`frontend/src/sim/challenge.ts`) re-runs the agents in the browser, so
  KPIs, savings and the score use the challenge's exact formulas and units, and what-ifs (battery size, solar) re-run the real agent. `node --experimental-strip-types scripts/validate.ts`
  (in `frontend/`) proves it reproduces the Python results to ~1e-13 on all 35 weeks.
- Scene: OSM-based buildings with floors/windows/rooftop plant/PV arrays, streets, parks, trees, substation, battery yard, **buried cable network** whose flows are the real
  subtree power sums; day/night from the real sun position; layers (power heatmap, people, weather, solar roofs, cables, shadows, trees, labels); sun freeze; rotate/tilt.
- HUD: resource pills, challenge-score coin, the agent's explanation of each decision, week ribbon (day/night, price, battery action), Campus/Solar/Battery/Impact tabs, charts drawer.

## Data contracts

| File | Produced by | Used for |
|---|---|---|
| `frontend/public/data/replay.json` | `frontend/scripts/export_replay.py --repo <checkout with data/train>` (runs the real `sim/` + agents) | the engine's inputs (load, PV, price, CO2, weather, per-row timestamps) and the Python reference results used by `validate.ts` |
| `frontend/public/data/campus.json` | `frontend/scripts/build-campus-data.mjs` from `frontend/data-raw/campus-overpass.json` (OSM) | campus building footprints + metadata |
| `frontend/public/data/ground.json` | `frontend/scripts/build-ground-data.mjs` from `frontend/data-raw/ground-overpass.json` (OSM) | roads, green areas, neighbouring buildings (clipped to the map box) |
| `demo/data/trace_<name>.json` | `python -m sim.export_trace ...` (model side) | legacy columnar trace of the whole train year; **not used by the current frontend** (kept for slides/figures) |

Regenerate `replay.json` whenever `agent/agent.py` or `sim/` changes: the TS port must then be updated too, and `validate.ts` must be green.

## Presenting

`P` (or ▶ Pitch) runs the 3-minute automatic tour, `M` (or 🎤) the keyboard-driven presenter mode; 📊 Insights has the data figures. `npm run build && npx vite preview` works fully offline. Details: [`frontend/HANDOFF.md`](frontend/HANDOFF.md).

## Story the demo must support (see PLAN.md)

1. Problem and stakes → 2. what the data says (CO2/price peaks, solar surplus) → 3. strategy (forecast + 24 h optimisation, zero infractions) →
4. results vs no battery / template → 5. live replay of a week → 6. limits and next steps. Prepare a 3-minute pitch and a fallback screen recording.

## Rules

Demo code may use any libs (it is not submitted), but numbers must come from `sim/`-equivalent code so they match the leaderboard model. Only edit `demo/`
(and `docs/HANDOFF.md` entries). Missing data or a new field? Ask Natan/Aiman, don't edit `sim/` or `agent/`.
