"""python -m sim.check agent/agent.py [--zip]
Pre-submission checks: forbidden imports/calls (AST), clamp safety at extreme SOC, timing, optional zip build."""
import ast
import sys
import time
import zipfile
from pathlib import Path

from sim.data import synthetic_campus
from sim.simulator import build_obs, load_agent_class, simulate

# Same rules as the official starter_kit/check_submission.py (AST scanner on the server).
FORBIDDEN_MODULES = {
    "os", "sys", "shutil", "subprocess", "socket", "urllib", "requests", "http", "ftplib", "paramiko", "telnetlib",
    "pty", "posix", "ctypes", "importlib", "inspect", "gc", "builtins", "fcntl", "signal", "threading",
    "multiprocessing", "aiohttp",
}
FORBIDDEN_CALLS = {"system", "popen", "spawn", "rmtree", "get_objects", "currentframe", "stack"}
FORBIDDEN_BUILTINS = {"eval", "exec", "__import__", "compile", "breakpoint", "globals", "locals", "vars"}
FORBIDDEN_ATTRS = {"f_back", "f_locals", "f_globals", "__subclasses__", "__builtins__", "__globals__", "__code__"}


def ast_scan(path: Path) -> list:
    problems = []
    for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
        if isinstance(node, ast.Import):
            for a in node.names:
                if a.name.split(".")[0] in FORBIDDEN_MODULES:
                    problems.append(f"line {node.lineno}: import '{a.name}' not allowed")
        elif isinstance(node, ast.ImportFrom) and node.module:
            if node.module.split(".")[0] in FORBIDDEN_MODULES:
                problems.append(f"line {node.lineno}: import from '{node.module}' not allowed")
        elif isinstance(node, ast.Attribute) and node.attr in FORBIDDEN_ATTRS:
            problems.append(f"line {node.lineno}: attribute '{node.attr}' not allowed")
        elif isinstance(node, ast.Call):
            f = node.func
            if isinstance(f, ast.Attribute) and f.attr in FORBIDDEN_CALLS:
                problems.append(f"line {node.lineno}: call '{f.attr}()' not allowed")
            elif isinstance(f, ast.Name) and f.id in FORBIDDEN_BUILTINS:
                problems.append(f"line {node.lineno}: call '{f.id}()' not allowed")
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
