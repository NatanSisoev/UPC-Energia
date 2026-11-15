"""numpy forward of the reference MLP (pasted into the submitted agent.py by experiments/nn/package.py)."""
import math

import numpy as np

try:                                                   # inside agent.py NN_REGISTRY already exists
    NN_REGISTRY
except NameError:                                      # standalone import (parity test)
    NN_REGISTRY = {}


def nn_forward_mlp(W, hist, fut, stat, cfg):
    """One sample: hist (96, C), fut (24, F), stat (S,) -> (4, 24) corrections in scaled units."""
    x = np.concatenate([hist[-cfg["last"]:].ravel(), fut.ravel(), stat]).astype(np.float32)
    for k in (0, 2):
        x = W[f"net.{k}.weight"] @ x + W[f"net.{k}.bias"]
        x = 0.5 * x * (1.0 + np.tanh(math.sqrt(2.0 / math.pi) * (x + 0.044715 * x ** 3)))
    x = W["net.4.weight"] @ x + W["net.4.bias"]
    return x.reshape(4, 24)


NN_REGISTRY["mlp"] = nn_forward_mlp
