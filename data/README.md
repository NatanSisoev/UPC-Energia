# data/

**Not committed** (see `.gitignore`). Each of us downloads it once:

1. Open https://repteupc.datathon.cat/ → tab "Dades del Campus i Starter Kit" → "Descarregar Paquet per als Participants (ZIP, 13 MB)".
2. Unzip so that you get:
   ```
   data/train/{contador,inversor,meteo,entradas_salidas,precio_pvpc,co2_red}.csv
   starter_kit/{tutorial.ipynb, agent.py, environment.py, check_submission.py}   # also git-ignored
   docs/ (official) -> keep outside git or in docs/official/
   ```
3. `python -m sim.evaluate` will automatically use the real data when `data/train/contador.csv` exists (synthetic fake data otherwise).
4. Then compare our `sim/simulator.py` against `starter_kit/environment.py` and fix discrepancies (log it in `docs/HANDOFF.md`).
