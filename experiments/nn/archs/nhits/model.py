"""N-HiTS style forecaster: 3 stacks, each pools the history at a different rate (and the 24 h exogenous
future at a different rate), an MLP emits coarse knots per series which a fixed matrix interpolates to the 24
leads; the forecast is the sum of the stacks. No backcasting (parity stays one matmul per stack)."""
import torch
from torch import nn

DEF = {"kernels": (8, 4, 1), "lens": (48, 48, 24), "fpools": (8, 4, 2), "knots": (3, 6, 24), "pool": "avg",
       "width": 64, "drop": 0.2, "lr": 3e-4, "wd": 1e-2, "batch": 128, "max_epochs": 60, "patience": 8}


def _c(**kw):
    d = dict(DEF)
    d.update(kw)
    return d


CONFIGS = {
    "a": _c(),
    "b": _c(pool="max"),
    "c": _c(lens=(96, 96, 48), width=48),
    "d": _c(drop=0.3, wd=5e-2, width=48),
    "e": _c(lr=1e-3, drop=0.3),
    "f": _c(fpools=(12, 6, 3), width=96, drop=0.3, lens=(96, 48, 24)),
}


def interp_matrix(K, H):
    """(K, H) linear interpolation of K evenly spaced knots (lead 0 .. H-1) onto H leads."""
    M = torch.zeros(K, H)
    for h in range(H):
        p = h * (K - 1) / (H - 1)
        i = min(int(p), K - 2) if K > 1 else 0
        if K == 1:
            M[0, h] = 1.0
            continue
        w = p - i
        M[i, h] += 1 - w
        M[i + 1, h] += w
    return M


class Stack(nn.Module):
    def __init__(self, cfg, dims, k, ln, fp, K):
        super().__init__()
        self.k, self.ln_len, self.fp, self.K, self.pool = k, ln, fp, K, cfg["pool"]
        self.C, self.F, self.H = dims["C"], dims["F"], dims["H"]
        d_in = (ln // k) * self.C + (self.H // fp) * self.F + dims["S"]
        w = cfg["width"]
        self.ln = nn.LayerNorm(d_in)
        self.fc1 = nn.Linear(d_in, w)
        self.fc2 = nn.Linear(w, w)
        self.out = nn.Linear(w, 4 * K)
        self.drop = nn.Dropout(cfg["drop"])
        self.act = nn.GELU(approximate="tanh")
        self.register_buffer("M", interp_matrix(K, self.H))

    def _pool(self, x, k):                              # x [B, T, C] -> [B, T//k, C]
        if k == 1:
            return x
        x = x.reshape(x.shape[0], x.shape[1] // k, k, x.shape[2])
        return x.amax(2) if self.pool == "max" else x.mean(2)

    def forward(self, hist, fut, stat):
        h = self._pool(hist[:, -self.ln_len:], self.k).flatten(1)
        f = self._pool(fut, self.fp).flatten(1)
        x = self.ln(torch.cat([h, f, stat], dim=1))
        x = self.drop(self.act(self.fc1(x)))
        x = self.drop(self.act(self.fc2(x)))
        c = self.out(x).view(-1, 4, self.K)
        return c @ self.M


class NHiTS(nn.Module):
    def __init__(self, cfg, dims):
        super().__init__()
        self.stacks = nn.ModuleList([Stack(cfg, dims, k, ln, fp, K) for k, ln, fp, K in
                                     zip(cfg["kernels"], cfg["lens"], cfg["fpools"], cfg["knots"])])

    def forward(self, hist, fut, stat):
        out = 0
        for s in self.stacks:
            out = out + s(hist, fut, stat)
        return out


def build(cfg, dims):
    return NHiTS(cfg, dims)
