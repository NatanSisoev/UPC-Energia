# Datathon FME 2026 — UPC Sostenible battery challenge

Team: Natan, Aiman, Sami. See [CLAUDE.md](CLAUDE.md) (entry point for humans and agents), [CHALLENGE.md](CHALLENGE.md), [WORKFLOW.md](WORKFLOW.md).

```bash
python -m venv .venv && source .venv/Scripts/activate   # Windows git-bash; or .venv\Scripts\Activate.ps1
pip install -r requirements.txt
pytest
python -m sim.evaluate
python -m sim.check agent/agent.py --zip
```
