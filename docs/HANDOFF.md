# HANDOFF log (append-only, newest at the bottom)

Format: `YYYY-MM-DD · who · what changed · how to use it · score`

- 2026-11-14 · natan (claude) · Initial repo: CLAUDE.md, CHALLENGE.md, WORKFLOW.md, `sim/` (simulator, evaluate, check), baseline `agent/agent.py` (official heuristic + safe clamp), tests. · `pytest`, `python -m sim.evaluate`, `python -m sim.check agent/agent.py` · baseline on synthetic data only (real data not downloaded yet).
- 2026-11-14 · natan (claude) · `experiments/oracle/oracle_lp.py`: perfect-foresight LP upper bound per whole train week (resets SOC to 50 % each week). **Mean oracle = 6.11 (range 3.2-12.2); template = 1.85.** Leaderboard (public test weeks) was seen at 6.43 -> top teams are already near the perfect-foresight level of train weeks, so remaining headroom is small unless test weeks are easier (summer weeks reach 8-12). `scripts/fetch_kit.py` downloads the official kit. · `python -m experiments.oracle.oracle_lp`
