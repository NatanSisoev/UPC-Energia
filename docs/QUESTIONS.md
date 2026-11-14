# Open questions

- Infraction penalty: page -0.20, FAQ/ENUNCIAT -1.00, official environment.py -0.2 points. Real evaluator probably = environment.py, but unconfirmed.
- RESOLVED: official environment.py uses export_price=0.0.
- Percent units of dCO2 / dCost (page simulator suggests values like 5.0 meaning 5 %).
- Does CO2 accounting credit exported energy? (assumed no)
- RESOLVED (natan, 2026-11-14): in the official `environment.py` the lists `preus_properes_24h` / `co2_properes_24h` **start at the current hour** (element 0 == `preu_actual`) and are **truncated** at the end of the simulation. `sim/simulator.py` now builds them the same way (`tests/test_vs_official.py`). An agent that reads them as "t+1 .. t+24" loses ~45 % of the score; our agent detects the alignment from the data.
- OPEN: is the hidden test scored as ONE 2,016 h simulation (SOC carried across the 12 weeks, CO2/cost normalised over the whole run), as `environment.py` and the FAQ say, or week by week (ENUNCIAT: SOC 50 % "at the start of each evaluation period")? The agent assumes one run; if it is per week the forecast lists are truncated at each week end and the agent handles that correctly, losing only ~0.01 from the normalisation ratio.
- OPEN: which hours form the public 50 % of each test week? `evaluate_results(mask=...)` scores only the masked hours, so the public score of an arbitrage agent depends on whether its charge or discharge hours fall in the mask - small public differences between near-identical agents are noise.
