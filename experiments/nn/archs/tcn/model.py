"""TCN forecaster: dilated causal residual conv encoder over the 96 h history + per-lead decoder ("head" MLP or "conv").

cfg keys: ch (channels), blocks (dilations 1,2,4,..), dec ("head"|"conv"), hid, emb, drop, mean24 (also use the mean
of the last 24 encoder steps), lr, wd, batch, max_epochs, patience.
"""
import torch
import torch.nn.functional as Fn
from torch import nn

_B = {"ch": 24, "blocks": 5, "dec": "head", "hid": 64, "emb": 24, "drop": 0.2, "mean24": True,
      "lr": 3e-4, "wd": 5e-2, "batch": 128, "max_epochs": 60, "patience": 8}

CONFIGS = {
    "a": dict(_B),
    "b": dict(_B, dec="conv"),
    "c": dict(_B, ch=32, drop=0.3, hid=96),
    "d": dict(_B, blocks=4, drop=0.1, lr=1e-3),
    "e": dict(_B, dec="conv", ch=32, drop=0.3, mean24=False),
    "f": dict(_B, ch=16, emb=16, hid=48, drop=0.1, wd=1e-1),
}


class Block(nn.Module):
    """x + dropout(gelu(conv(LN(x)))), causal dilated conv, channels-last tensors [B,T,C]."""

    def __init__(self, ch, dil, drop):
        super().__init__()
        self.dil = dil
        self.ln = nn.LayerNorm(ch)
        self.conv = nn.Conv1d(ch, ch, 3, dilation=dil)
        self.drop = nn.Dropout(drop)

    def forward(self, x):
        y = self.ln(x).transpose(1, 2)
        y = self.conv(Fn.pad(y, (2 * self.dil, 0))).transpose(1, 2)
        return x + self.drop(Fn.gelu(y, approximate="tanh"))


class TCN(nn.Module):
    def __init__(self, cfg, dims):
        super().__init__()
        ch, e, hid, dr = cfg["ch"], cfg["emb"], cfg["hid"], cfg["drop"]
        self.cfg, self.H = cfg, dims["H"]
        self.inp = nn.Linear(dims["C"], ch)
        self.blocks = nn.ModuleList([Block(ch, 2 ** i, dr) for i in range(cfg["blocks"])])
        self.lnh = nn.LayerNorm(ch)
        cdim = ch * (2 if cfg["mean24"] else 1)
        self.ctx = nn.Linear(cdim, e)
        self.fut = nn.Linear(dims["F"], e)
        self.lnf = nn.LayerNorm(e)
        self.st = nn.Linear(dims["S"], e)
        self.drop = nn.Dropout(dr)
        d_in = 3 * e
        if cfg["dec"] == "head":
            self.h1 = nn.Linear(d_in, hid)
            self.h2 = nn.Linear(hid, 4)
        else:
            self.c1 = nn.Conv1d(d_in, hid, 3, padding=1)
            self.c2 = nn.Conv1d(hid, hid, 3, padding=1)
            self.c3 = nn.Conv1d(hid, 4, 1)

    def forward(self, hist, fut, stat):
        x = self.inp(hist)
        for b in self.blocks:
            x = b(x)
        x = self.lnh(x)
        c = x[:, -1]
        if self.cfg["mean24"]:
            c = torch.cat([c, x[:, -24:].mean(1)], dim=1)
        c = Fn.gelu(self.ctx(c), approximate="tanh")
        s = Fn.gelu(self.st(stat), approximate="tanh")
        f = Fn.gelu(self.lnf(self.fut(fut)), approximate="tanh")           # [B,24,e]
        z = torch.cat([f, c[:, None].expand(-1, self.H, -1), s[:, None].expand(-1, self.H, -1)], dim=2)
        z = self.drop(z)
        if self.cfg["dec"] == "head":
            o = self.h2(self.drop(Fn.gelu(self.h1(z), approximate="tanh")))  # [B,24,4]
            return o.transpose(1, 2)
        z = z.transpose(1, 2)
        z = self.drop(Fn.gelu(self.c1(z), approximate="tanh"))
        z = Fn.gelu(self.c2(z), approximate="tanh")
        return self.c3(z)


def build(cfg, dims):
    return TCN(cfg, dims)
