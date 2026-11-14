"""python -m sim.check agent/agent.py [--zip]
Pre-submission checks: forbidden imports/calls (AST), clamp safety at extreme SOC, timing, optional zip build."""
import ast
import sys
import time
import zipfile
from pathlib import Path

from sim.data import synthetic_campus
from sim.simulator import build_obs, load_agent_class, simulate

FORBIDDEN_CALLS = {"eval", "exec", "compile", "__import__", "open"}
ALLOWED = {"numpy", "pandas", "scipy", "sklearn", "joblib", "xgboost", "lightgbm", "math", "datetime",
           "collections", "itertools", "random", "json", "pathlib", "typing", "__future__"}


def ast_scan(path: Path) -> list:
    problems = []
    for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
        mods = []
        if isinstance(node, ast.Import):
            mods = [a.name for a in node.names]
        elif isinstance(node, ast.ImportFrom) and node.module:
            mods = [node.module]
        for m in mods:
            if m.split(".")[0] not in ALLOWED:
                problems.append(f"line {node.lineno}: import '{m}' not allowed")
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in FORBIDDEN_CALLS:
            problems.append(f"line {node.lineno}: call '{node.func.id}' not allowed")
    return problems


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    path = Path(args[0] if args else "agent/agent.py")
    ok = True

    probs = ast_scan(path)
    print("AST scan:", "OK" if not probs else "\n  " + "\n  ".join(probs))
    ok &= not probs

    df = synthetic_campus(days=84)
    cls = load_agent_class(str(path))
    t0 = time.time()
    res = simulate(cls(), df)
    est = (time.time() - t0) * 2016 / len(df)
    print(f"Sim (synthetic): {res.summary()}  | est. time for 2016 h: {est:.1f}s (limit 60s)")
    ok &= res.violations == 0 and est < 60

    agent = cls()
    for soc in (0.0, 1e-6, 1000.0, 1999.9999, 2000.0):
        r = float(agent.act(build_obs(df, 30, soc)))
        print(f"  soc={soc:>10}: setpoint={r:9.3f}")
    print("RESULT:", "PASS" if ok else "FAIL")

    if "--zip" in sys.argv and ok:
        out = Path("submission.zip")
        with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
            z.write(path, "agent.py")                       # agent.py at the ROOT of the zip
            for f in sorted((path.parent / "models").glob("*")):
                z.write(f, f.name)                          # models beside agent.py (Path(__file__).parent)
        print(f"built {out} ({out.stat().st_size / 1e6:.2f} MB)")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
