"""numpy forward of the GRU/LSTM forecaster (pasted into the submitted agent.py). Gate layouts follow PyTorch: GRU (r,z,n), LSTM (i,f,g,o)."""
import math

import numpy as np

try:                                                   # inside agent.py NN_REGISTRY already exists
    NN_REGISTRY
except NameError:                                      # standalone import (parity test)
    NN_REGISTRY = {}


def _rnn_gelu(x):
    return 0.5 * x * (1.0 + np.tanh(math.sqrt(2.0 / math.pi) * (x + 0.044715 * x ** 3)))


def _rnn_sig(x):
    return 1.0 / (1.0 + np.exp(-x))


def _rnn_run(W, p, X, h, c, cell):
    """Run one recurrent layer over X (T, in). Returns (outputs (T, hd), final h, final c)."""
    hd = h.shape[0]
    gi = X @ W[p + ".weight_ih_l0"].T + W[p + ".bias_ih_l0"]     # all input projections at once
    whh, bhh = W[p + ".weight_hh_l0"], W[p + ".bias_hh_l0"]
    outs = []
    for t in range(X.shape[0]):
        gh = whh @ h + bhh
        g = gi[t]
        if cell == "gru":
            r = _rnn_sig(g[:hd] + gh[:hd])
            z = _rnn_sig(g[hd:2 * hd] + gh[hd:2 * hd])
            n = np.tanh(g[2 * hd:] + r * gh[2 * hd:])
            h = (1.0 - z) * n + z * h
        else:
            a = g + gh
            i = _rnn_sig(a[:hd])
            f = _rnn_sig(a[hd:2 * hd])
            gg = np.tanh(a[2 * hd:3 * hd])
            o = _rnn_sig(a[3 * hd:])
            c = f * c + i * gg
            h = o * np.tanh(c)
        outs.append(h)
    return np.array(outs, dtype=np.float32), h, c


def nn_forward_rnn(W, hist, fut, stat, cfg):
    """One sample: hist (96, C), fut (24, F), stat (S,) -> (4, 24) corrections in scaled units."""
    cell = cfg["cell"]
    hd = W["enc.weight_hh_l0"].shape[1]
    x = _rnn_gelu(hist[-cfg["last"]:] @ W["emb.weight"].T + W["emb.bias"])
    z0 = np.zeros(hd, dtype=np.float32)
    _, h, _ = _rnn_run(W, "enc", x.astype(np.float32), z0, z0, cell)
    f = (fut * W["fscale"]).astype(np.float32)
    if cfg["dec"] == "head":
        w1 = W["h1.weight"]
        a = f @ w1[:, hd:hd + f.shape[1]].T + (w1[:, :hd] @ h + w1[:, hd + f.shape[1]:] @ stat + W["h1.bias"])
        a = _rnn_gelu(a)                                          # (24, mlp)
        return (a @ W["h2.weight"].T + W["h2.bias"]).T.astype(np.float32)
    h0 = np.tanh(W["init.weight"] @ np.concatenate([h, stat]) + W["init.bias"]).astype(np.float32)
    o, _, _ = _rnn_run(W, "dec", f, h0, z0, cell)
    return (o @ W["out.weight"].T + W["out.bias"]).T.astype(np.float32)


NN_REGISTRY["rnn"] = nn_forward_rnn
