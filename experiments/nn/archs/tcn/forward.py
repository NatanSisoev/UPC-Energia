"""numpy forward of the TCN (pasted into the submitted agent.py by experiments/nn/package.py)."""
import math

import numpy as np

try:                                                   # inside agent.py NN_REGISTRY already exists
    NN_REGISTRY
except NameError:                                      # standalone import (parity test)
    NN_REGISTRY = {}


def _tcn_gelu(x):
    return 0.5 * x * (1.0 + np.tanh(math.sqrt(2.0 / math.pi) * (x + 0.044715 * x ** 3)))


def _tcn_ln(x, w, b):
    m = x.mean(axis=-1, keepdims=True)
    v = ((x - m) ** 2).mean(axis=-1, keepdims=True)
    return (x - m) / np.sqrt(v + 1e-5) * w + b


def _tcn_conv(x, w, b, dil, pad_l, pad_r):
    """x (T, Cin), w (Cout, Cin, K): out[t] = sum_k xpad[t + k*dil] @ w[:, :, k].T + b (torch cross-correlation)."""
    T = x.shape[0]
    xp = np.concatenate([np.zeros((pad_l, x.shape[1]), np.float32), x, np.zeros((pad_r, x.shape[1]), np.float32)])
    out = np.zeros((T, w.shape[0]), np.float32) + b
    for k in range(w.shape[2]):
        out = out + xp[k * dil:k * dil + T] @ w[:, :, k].T
    return out


def nn_forward_tcn(W, hist, fut, stat, cfg):
    """One sample: hist (96, C), fut (24, F), stat (S,) -> (4, 24) corrections in scaled units."""
    x = hist.astype(np.float32) @ W["inp.weight"].T + W["inp.bias"]
    for i in range(cfg["blocks"]):
        p, d = f"blocks.{i}.", 2 ** i
        y = _tcn_ln(x, W[p + "ln.weight"], W[p + "ln.bias"])
        y = _tcn_conv(y, W[p + "conv.weight"], W[p + "conv.bias"], d, 2 * d, 0)
        x = x + _tcn_gelu(y)
    x = _tcn_ln(x, W["lnh.weight"], W["lnh.bias"])
    c = x[-1]
    if cfg["mean24"]:
        c = np.concatenate([c, x[-24:].mean(axis=0)])
    c = _tcn_gelu(W["ctx.weight"] @ c + W["ctx.bias"])
    s = _tcn_gelu(W["st.weight"] @ stat + W["st.bias"])
    f = _tcn_gelu(_tcn_ln(fut.astype(np.float32) @ W["fut.weight"].T + W["fut.bias"], W["lnf.weight"], W["lnf.bias"]))
    z = np.concatenate([f, np.zeros((24, c.shape[0]), np.float32) + c, np.zeros((24, s.shape[0]), np.float32) + s],
                       axis=1)
    if cfg["dec"] == "head":
        o = _tcn_gelu(z @ W["h1.weight"].T + W["h1.bias"]) @ W["h2.weight"].T + W["h2.bias"]
    else:
        z = _tcn_gelu(_tcn_conv(z, W["c1.weight"], W["c1.bias"], 1, 1, 1))
        z = _tcn_gelu(_tcn_conv(z, W["c2.weight"], W["c2.bias"], 1, 1, 1))
        o = z @ W["c3.weight"][:, :, 0].T + W["c3.bias"]
    return np.asarray(o, np.float32).T.reshape(4, 24)


NN_REGISTRY["tcn"] = nn_forward_tcn
