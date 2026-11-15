"""numpy forward of the N-HiTS style net (pasted into the submitted agent.py by experiments/nn/package.py)."""
import math

import numpy as np

try:                                                   # inside agent.py NN_REGISTRY already exists
    NN_REGISTRY
except NameError:                                      # standalone import (parity test)
    NN_REGISTRY = {}


def nn_forward_nhits(W, hist, fut, stat, cfg):
    """One sample: hist (96, C), fut (24, F), stat (S,) -> (4, 24) corrections in scaled units."""
    out = np.zeros((4, 24), dtype=np.float32)
    for s in range(len(cfg["kernels"])):
        k, ln, fp, K = cfg["kernels"][s], cfg["lens"][s], cfg["fpools"][s], cfg["knots"][s]
        h = hist[-ln:]
        f = fut
        if k > 1:
            h = h.reshape(ln // k, k, h.shape[1])
            h = h.max(axis=1) if cfg["pool"] == "max" else h.mean(axis=1)
        if fp > 1:
            f = f.reshape(24 // fp, fp, f.shape[1])
            f = f.max(axis=1) if cfg["pool"] == "max" else f.mean(axis=1)
        x = np.concatenate([h.ravel(), f.ravel(), stat]).astype(np.float32)
        p = f"stacks.{s}."
        x = (x - x.mean()) / np.sqrt(x.var() + 1e-5) * W[p + "ln.weight"] + W[p + "ln.bias"]
        for n in ("fc1", "fc2"):
            x = W[p + n + ".weight"] @ x + W[p + n + ".bias"]
            x = 0.5 * x * (1.0 + np.tanh(math.sqrt(2.0 / math.pi) * (x + 0.044715 * x ** 3)))
        c = (W[p + "out.weight"] @ x + W[p + "out.bias"]).reshape(4, K)
        out = out + c @ W[p + "M"]
    return out.astype(np.float32)


NN_REGISTRY["nhits"] = nn_forward_nhits
