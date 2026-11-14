# demo/ — DEMO track

Goal: win the jury. They weigh the presentation, clarity of reasoning, data analysis and strategy justification decisively.

Ideas to own here (owner TBD, see WORKFLOW.md):
- Story: problem -> data insights (CO2/price/solar/demand patterns) -> strategy -> results vs no-battery baseline -> what we'd do next.
- Interactive app (Streamlit/Gradio/static HTML) replaying a week: battery SOC, grid import, CO2 avoided, cost saved.
- Figures exported from `sim.simulate(...).trace` so numbers match the leaderboard model.
- Slides + a 3-minute pitch script.

Demo code may use any libs (it is not submitted), but it must read results produced by `sim/` so it stays consistent with the model track.
