"""Paths of the trained weights of an "arch:tag" member."""
from pathlib import Path

RUNS = Path(__file__).resolve().parent / "runs"


def member_files(member, mode):
    arch, tag = member.split(":")
    paths = sorted((RUNS / f"{arch}_{tag}" / mode).glob("weights_s*.npz"))
    if not paths:
        raise SystemExit(f"no {mode} weights for {member}: run experiments.nn.run first")
    return paths
