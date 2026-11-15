"""GRU / LSTM forecaster: encoder over the last `last` rows of hist, decoder per lead ("head") or a second recurrent net over fut ("seq")."""
import torch
from torch import nn

_B = {"lr": 3e-4, "wd": 5e-2, "batch": 128, "max_epochs": 40, "patience": 6, "last": 48, "emb": 16, "mlp": 48}
CONFIGS = {
    "a": {**_B, "cell": "gru", "dec": "head", "hidden": 32, "drop": 0.2},
    "b": {**_B, "cell": "lstm", "dec": "head", "hidden": 32, "drop": 0.2},
    "c": {**_B, "cell": "gru", "dec": "seq", "hidden": 32, "drop": 0.2},
    "d": {**_B, "cell": "lstm", "dec": "seq", "hidden": 32, "drop": 0.2},
    "e": {**_B, "cell": "gru", "dec": "head", "hidden": 24, "drop": 0.3},
    "f": {**_B, "cell": "gru", "dec": "head", "hidden": 48, "drop": 0.1},
}
_RNN = {"gru": nn.GRU, "lstm": nn.LSTM}


class RNNNet(nn.Module):
    def __init__(self, cfg, dims):
        super().__init__()
        self.cfg, self.H = cfg, dims["H"]
        hd, E, F, S = cfg["hidden"], cfg["emb"], dims["F"], dims["S"]
        self.emb = nn.Linear(dims["C"], E)
        self.enc = _RNN[cfg["cell"]](E, hd, batch_first=True)
        fs = torch.ones(F)
        fs[16:19] = 0.2                                    # uncentred base channels, ~5 in magnitude
        self.register_buffer("fscale", fs)
        self.drop = nn.Dropout(cfg["drop"])
        if cfg["dec"] == "head":
            self.h1 = nn.Linear(hd + F + S, cfg["mlp"])
            self.h2 = nn.Linear(cfg["mlp"], 4)
        else:
            self.init = nn.Linear(hd + S, hd)
            self.dec = _RNN[cfg["cell"]](F, hd, batch_first=True)
            self.out = nn.Linear(hd, 4)

    def forward(self, hist, fut, stat):
        cfg = self.cfg
        x = nn.functional.gelu(self.emb(hist[:, -cfg["last"]:]), approximate="tanh")
        _, st = self.enc(x)
        h = st[0][0] if cfg["cell"] == "lstm" else st[0]   # (B, hd)
        h = self.drop(h)
        f = fut * self.fscale
        if cfg["dec"] == "head":
            B = h.shape[0]
            z = torch.cat([h.unsqueeze(1).expand(B, self.H, h.shape[1]), f, stat.unsqueeze(1).expand(B, self.H, stat.shape[1])], dim=2)
            z = self.drop(nn.functional.gelu(self.h1(z), approximate="tanh"))
            return self.h2(z).transpose(1, 2)              # (B, 4, 24)
        h0 = torch.tanh(self.init(torch.cat([h, stat], dim=1))).unsqueeze(0).contiguous()
        if cfg["cell"] == "lstm":
            o, _ = self.dec(f, (h0, torch.zeros_like(h0)))
        else:
            o, _ = self.dec(f, h0)
        return self.out(self.drop(o)).transpose(1, 2)


def build(cfg, dims):
    return RNNNet(cfg, dims)
