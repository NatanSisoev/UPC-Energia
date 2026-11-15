"""numpy forward of the reduced TFT (pasted into the submitted agent.py by experiments/nn/package.py)."""
import math

import numpy as np

try:                                                   # inside agent.py NN_REGISTRY already exists
    NN_REGISTRY
except NameError:                                      # standalone import (parity test)
    NN_REGISTRY = {}


def _tft_lin(W, name, x):
    return x @ W[name + ".weight"].T + W[name + ".bias"]


def _tft_sig(x):
    return 1.0 / (1.0 + np.exp(-x))


def _tft_ln(W, name, x):
    mu = x.mean(-1, keepdims=True)
    var = ((x - mu) ** 2).mean(-1, keepdims=True)
    return (x - mu) / np.sqrt(var + 1e-5) * W[name + ".weight"] + W[name + ".bias"]


def _tft_skip(W, name, out, skip):
    return _tft_ln(W, name + ".norm", _tft_sig(_tft_lin(W, name + ".gate", out)) * out + skip)


def _tft_lstm(W, name, x, h, c):
    """x (T, d); torch gate order i, f, g, o. Returns outputs (T, d) and final (h, c)."""
    d = x.shape[1]
    xp = x @ W[name + ".weight_ih_l0"].T + W[name + ".bias_ih_l0"] + W[name + ".bias_hh_l0"]
    whh = W[name + ".weight_hh_l0"].T
    out = np.empty_like(x)
    for t in range(x.shape[0]):
        g = xp[t] + h @ whh
        i, f, gg, o = _tft_sig(g[:d]), _tft_sig(g[d:2 * d]), np.tanh(g[2 * d:3 * d]), _tft_sig(g[3 * d:])
        c = f * c + i * gg
        h = o * np.tanh(c)
        out[t] = h
    return out, h, c


def nn_forward_tft(W, hist, fut, stat, cfg):
    """One sample: hist (96, C), fut (24, F), stat (S,) -> (4, 24) corrections in scaled units."""
    d, T, heads = cfg["d"], cfg["hist_len"], cfg["heads"]
    s = _tft_lin(W, "emb_s", stat.astype(np.float32))
    eh = _tft_lin(W, "emb_h", hist[-T:]) + s
    ef = _tft_lin(W, "emb_f", fut * W["fut_scale"]) + s
    z0 = np.zeros(d, dtype=np.float32)
    enc, h, c = _tft_lstm(W, "enc", eh, z0, z0)
    enc = _tft_skip(W, "skip_e", enc, eh)
    dec, _, _ = _tft_lstm(W, "dec", ef, h, c)
    dec = _tft_skip(W, "skip_d", dec, ef)
    if cfg["attn"]:
        mem = np.concatenate([enc, dec], axis=0)
        dh = d // heads
        q = _tft_lin(W, "q", dec).reshape(24, heads, dh).transpose(1, 0, 2)
        k = _tft_lin(W, "k", mem).reshape(-1, heads, dh).transpose(1, 0, 2)
        v = _tft_lin(W, "v", mem).reshape(-1, heads, dh).transpose(1, 0, 2)
        sc = q @ k.transpose(0, 2, 1) / math.sqrt(dh) + W["mask"]
        sc = sc - sc.max(-1, keepdims=True)
        a = np.exp(sc)
        a = a / a.sum(-1, keepdims=True)
        att = (a @ v).transpose(1, 0, 2).reshape(24, d)
        dec = _tft_skip(W, "skip_a", _tft_lin(W, "o", att), dec)
    z = _tft_lin(W, "g1", dec)
    z = np.where(z > 0, z, np.exp(np.minimum(z, 0.0)) - 1.0)
    z = _tft_lin(W, "g2", z)
    z = _tft_ln(W, "grn_norm", _tft_sig(_tft_lin(W, "gg", z)) * z + dec)
    return _tft_lin(W, "head", z).T.astype(np.float32)


NN_REGISTRY["tft"] = nn_forward_tft
