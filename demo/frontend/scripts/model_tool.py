"""Validate + simulate an uploaded challenge-format ZIP for the demo's model selector.

    python -I scripts/model_tool.py --repo <repo> --zip upload.zip --dir .uploads/<id> [--hard-obs]

LOCAL DEMO TOOL ONLY: it runs user-provided agent code on this machine. Nothing from the ZIP is imported or executed
before (1) the archive is extracted with zip-slip / symlink / size guards and (2) every .py inside passes the AST
scan of sim/check.py (allowed-library whitelist + forbidden calls). Then: clamp test at extreme SOC, timing on the
synthetic campus, and the whole-week simulation via export_replay.py in a child process (the caller enforces a hard timeout).
Prints one JSON object per line: {"stage": ...} progress, a final {"done": true, "ok": bool, ...}.
"""
import argparse
import json
import subprocess
import sys
import time
import zipfile
from pathlib import Path, PurePosixPath

MAX_ZIP = 25 * 1024 * 1024
MAX_UNZIPPED = 120 * 1024 * 1024


def emit(**kw):
    print(json.dumps(kw), flush=True)


def fail(msg, **kw):
    emit(done=True, ok=False, error=msg, **kw)
    sys.exit(0)


def safe_extract(zpath: Path, dest: Path) -> None:
    if zpath.stat().st_size > MAX_ZIP:
        fail("ZIP is larger than 25 MB")
    dest.mkdir(parents=True, exist_ok=True)
    root = dest.resolve()
    try:
        z = zipfile.ZipFile(zpath)
    except zipfile.BadZipFile:
        fail("not a valid ZIP file")
    with z:
        infos = z.infolist()
        if sum(i.file_size for i in infos) > MAX_UNZIPPED:
            fail("ZIP expands to more than 120 MB")
        names = [i.filename for i in infos]
        if "agent.py" not in names:
            fail("agent.py must be at the ROOT of the ZIP" + (" (found it inside a folder)" if any(n.endswith("/agent.py") for n in names) else ""))
        for i in infos:
            p = PurePosixPath(i.filename.replace("\\", "/"))
            if p.is_absolute() or ".." in p.parts or (p.parts and ":" in p.parts[0]):
                fail(f"unsafe path in ZIP: {i.filename}")
            if (i.external_attr >> 16) & 0o170000 == 0o120000:
                fail(f"symlink in ZIP not allowed: {i.filename}")
            target = (root / Path(*p.parts)).resolve()
            if root not in target.parents and target != root:
                fail(f"unsafe path in ZIP: {i.filename}")
            if i.is_dir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with z.open(i) as src, open(target, "wb") as out:
                    out.write(src.read())


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", required=True)
    ap.add_argument("--zip", required=True)
    ap.add_argument("--dir", required=True)
    ap.add_argument("--hard-obs", action="store_true")
    a = ap.parse_args()
    repo, work = Path(a.repo).resolve(), Path(a.dir).resolve()
    sys.path.insert(0, str(repo))

    emit(stage="extract")
    src = work / "src"
    safe_extract(Path(a.zip), src)

    emit(stage="scan")
    from sim.check import ast_scan  # the repo's own checker; the agent is NOT imported yet
    problems = []
    for f in sorted(src.rglob("*.py")):
        problems += [f"{f.relative_to(src).as_posix()}: {p}" for p in ast_scan(f)]
    if problems:
        fail("AST scan rejected the agent (forbidden import / call)", problems=problems)

    emit(stage="check")  # clamp at extreme SOC + timing, same logic as `python -m sim.check`
    from sim.data import synthetic_campus
    from sim.simulator import STANDARD, Spec, build_obs, load_agent_class, simulate
    spec = Spec(capacity=STANDARD.capacity, power=STANDARD.power, horizon=3, hard=True) if a.hard_obs else STANDARD
    clamp = []
    try:
        cls = load_agent_class(str(src / "agent.py"))
        df = synthetic_campus(days=28)
        t0 = time.time()
        res = simulate(cls(), df, spec=spec)
        est = (time.time() - t0) * 2016 / len(df)
        agent = cls()
        for soc in (0.0, 1e-6, spec.capacity / 2, spec.capacity - 1e-4, spec.capacity):
            r = float(agent.act(build_obs(df, 30, soc, spec)))
            lo = -min(spec.power, soc * 0.9 ** 0.5) - 1e-3
            hi = min(spec.power, (spec.capacity - soc) / 0.9 ** 0.5) + 1e-3
            if not (lo <= r <= hi):
                clamp.append(f"soc={soc}: setpoint {r:.2f} outside [{lo:.2f}, {hi:.2f}]")
    except Exception as e:  # noqa: BLE001 - report any agent crash to the dialog
        fail(f"agent crashed during the check: {type(e).__name__}: {e}")
    if clamp:
        fail("clamp test failed", problems=clamp)
    if est >= 60:
        fail(f"too slow: estimated {est:.0f} s for 2016 h (limit 60 s)")
    if res.violations:
        fail(f"{res.violations} infractions on the synthetic campus")
    emit(stage="simulate", est_s=round(est, 1))

    out = work / "replay.json"
    cmd = [sys.executable, "-I", str(Path(__file__).with_name("export_replay.py")), "--repo", str(repo), "--agent", str(src / "agent.py"),
           "--out", str(out), "--name", "uploaded", "--progress"] + (["--hard-obs"] if a.hard_obs else [])
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, cwd=str(work))
    tail = []
    for line in p.stdout:
        line = line.strip()
        if line.startswith("{"):
            emit(stage="simulate", **json.loads(line))
        else:
            tail.append(line)
    if p.wait() != 0:
        fail("simulation failed: " + " | ".join(tail[-4:]))
    j = json.loads(out.read_text(encoding="utf-8"))
    w = [x["mpc"] for x in j["weeks"]]
    emit(done=True, ok=True, meanScore=sum(x["score"] for x in w) / len(w), violations=sum(x["viol"] for x in w), msPerStep=j["ms_per_step"])


if __name__ == "__main__":
    main()
