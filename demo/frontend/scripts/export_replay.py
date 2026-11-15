"""Export the REAL campus weeks + the Python reference results for the demo.

    python scripts/export_replay.py --repo C:/Users/natan/Datathon-FME

Writes public/data/replay.json:
  weeks[i] = {start, load[168], pv[168], price[168], co2[168],            # exactly the hourly frame sim/ scores
              mpc: {sp[168], soc[168], score, dco2, dcost, viol, co2_base, co2_agent, cost_base, cost_agent},
              template: {...same...}}
The TypeScript engine (src/sim/challenge.ts) re-runs both agents on these arrays and
scripts/validate.mts checks it reproduces the Python numbers to float precision.
Needs the official data in <repo>/data/train (git-ignored) and the repo's .venv (pandas).
"""
import argparse
import json
import sys
import time
from pathlib import Path


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", required=True, help="checkout that has data/train, sim/ and agent/")
    ap.add_argument("--agent", help="agent.py to run in the `mpc` slot (default <repo>/agent/agent.py)")
    ap.add_argument("--out", help="output json (default public/data/replay.json)")
    ap.add_argument("--name", help="label stored in the file's `source` field")
    ap.add_argument("--hard-obs", action="store_true", help="give the agent the Hard Mode observation (3 h price/CO2 window, weather telemetry, battery size) "
                    "on the standard 2 MWh campus battery; needed for agent_hard/")
    ap.add_argument("--progress", action="store_true", help="print one JSON line per finished week (used by model_tool.py)")
    a = ap.parse_args()
    repo = Path(a.repo).resolve()
    sys.path.insert(0, str(repo))
    from sim.data import load_campus_hourly, load_meteo_hourly, week_blocks
    from sim.simulator import STANDARD, Spec, load_agent_class, simulate
    spec = Spec(capacity=STANDARD.capacity, power=STANDARD.power, horizon=3, hard=True) if a.hard_obs else STANDARD

    agent_path = Path(a.agent).resolve() if a.agent else repo / "agent" / "agent.py"
    mpc = load_agent_class(str(agent_path))
    tpl = load_agent_class(str(repo / "experiments" / "baseline" / "template_agent.py"))
    df = load_campus_hourly()
    meteo = load_meteo_hourly()

    def timed(wk):
        nonlocal t_agent, n_steps
        t0 = time.perf_counter()
        res = simulate(mpc(), wk, spec=spec)
        t_agent += time.perf_counter() - t0
        n_steps += len(wk)
        return res

    def pack(res):
        return {
            "sp": [float(x) for x in res.trace["setpoint_kw"].values],
            "soc": [float(x) for x in res.trace["soc_kwh"].values],
            "score": res.score, "dco2": res.d_co2_pct, "dcost": res.d_cost_pct, "viol": res.violations,
            "co2_base": res.co2_base, "co2_agent": res.co2_agent,
            "cost_base": res.cost_base, "cost_agent": res.cost_agent,
        }

    weeks = []
    t_agent = 0.0
    n_steps = 0
    blocks = week_blocks(df)
    for wk in blocks:
        weeks.append({
            "start": wk.index[0].strftime("%Y-%m-%dT%H:%M"),
            # naive local wall time of every row as epoch-ms (some weeks contain data gaps, so start+i hours is not exact)
            "ms": [int(t.value // 1_000_000) for t in wk.index],
            "load": [float(x) for x in wk["load_kw"]],
            "pv": [float(x) for x in wk["pv_kw"]],
            "price": [float(x) for x in wk["precio_eur_per_kwh"]],
            "co2": [float(x) for x in wk["co2_kg_per_kwh"]],
            # weather station of the campus (irradiance W/m2, ambient temperature C); 0 / 15 where the station has gaps
            "irr": [round(float(x), 1) for x in meteo["irradiancia_wm2"].reindex(wk.index).fillna(0).clip(lower=0)],
            "temp": [round(float(x), 1) for x in meteo["temp_ambient_c"].reindex(wk.index).ffill().bfill().fillna(15)],
            "mpc": pack(timed(wk)),
            "template": pack(simulate(tpl(), wk)),
        })
        if a.progress:
            print(json.dumps({"week": len(weeks), "of": len(blocks)}), flush=True)
        print(weeks[-1]["start"], "mpc %.3f  template %.3f" % (weeks[-1]["mpc"]["score"], weeks[-1]["template"]["score"]))
    out = Path(a.out) if a.out else Path(__file__).resolve().parent.parent / "public" / "data" / "replay.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    meta = {"source": a.name or "sim/ + agent/agent.py", "ms_per_step": round(1000 * t_agent / max(n_steps, 1), 3)}
    out.write_text(json.dumps({**meta, "weeks": weeks}, separators=(",", ":")), encoding="utf-8")
    print("wrote", out, f"{out.stat().st_size/1e3:.0f} kB")


if __name__ == "__main__":
    main()
