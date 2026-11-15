"""Reduced Temporal Fusion Transformer: embeddings + static context, LSTM encoder/decoder with gated skip,
causal self-attention over [encoder; decoder] outputs, gated residual network, linear head -> [B,4,24]."""
import torch
from torch import nn

_B = {"d": 16, "heads": 2, "drop": 0.2, "attn": True, "hist_len": 48, "lr": 3e-4, "wd": 1e-2,
      "batch": 128, "max_epochs": 60, "patience": 8}
CONFIGS = {
    "a": dict(_B),
    "b": dict(_B, d=24, drop=0.3),
    "c": dict(_B, attn=False),
    "d": dict(_B, d=24, heads=4, drop=0.3, wd=5e-2),
    "e": dict(_B, lr=1e-3, drop=0.3),
    "f": dict(_B, d=20, heads=4, drop=0.1, lr=5e-4),
}


class GatedSkip(nn.Module):
    """LayerNorm(sigmoid(W x) * x_out + skip)."""
    def __init__(self, d):
        super().__init__()
        self.gate = nn.Linear(d, d)
        self.norm = nn.LayerNorm(d)

    def forward(self, out, skip):
        return self.norm(torch.sigmoid(self.gate(out)) * out + skip)


class TFT(nn.Module):
    def __init__(self, cfg, dims):
        super().__init__()
        d, H = cfg["d"], dims["H"]
        self.d, self.H, self.T, self.heads = d, H, cfg["hist_len"], cfg["heads"]
        self.use_attn = cfg["attn"]
        sc = torch.ones(dims["F"])
        sc[16:19] = 0.2                                     # uncentred base channels (~5) -> ~1
        self.register_buffer("fut_scale", sc)
        self.emb_h = nn.Linear(dims["C"], d)
        self.emb_f = nn.Linear(dims["F"], d)
        self.emb_s = nn.Linear(dims["S"], d)
        self.drop = nn.Dropout(cfg["drop"])
        self.enc = nn.LSTM(d, d, batch_first=True)
        self.dec = nn.LSTM(d, d, batch_first=True)
        self.skip_e = GatedSkip(d)
        self.skip_d = GatedSkip(d)
        if self.use_attn:
            self.q = nn.Linear(d, d)
            self.k = nn.Linear(d, d)
            self.v = nn.Linear(d, d)
            self.o = nn.Linear(d, d)
            self.skip_a = GatedSkip(d)
            m = torch.zeros(H, self.T + H)                  # decoder t sees all encoder rows and decoder <= t
            m[:, self.T:] = torch.triu(torch.full((H, H), -1e9), diagonal=1)
            self.register_buffer("mask", m)
        self.g1 = nn.Linear(d, d)
        self.g2 = nn.Linear(d, d)
        self.gg = nn.Linear(d, d)
        self.grn_norm = nn.LayerNorm(d)
        self.head = nn.Linear(d, 4)

    def forward(self, hist, fut, stat):
        B = hist.shape[0]
        s = self.emb_s(stat).unsqueeze(1)
        eh = self.drop(self.emb_h(hist[:, -self.T:]) + s)
        ef = self.drop(self.emb_f(fut * self.fut_scale) + s)
        enc, (h, c) = self.enc(eh)
        enc = self.skip_e(self.drop(enc), eh)
        dec, _ = self.dec(ef, (h, c))
        dec = self.skip_d(self.drop(dec), ef)
        if self.use_attn:
            mem = torch.cat([enc, dec], dim=1)              # [B, T+H, d]
            dh = self.d // self.heads
            q = self.q(dec).view(B, self.H, self.heads, dh).transpose(1, 2)
            k = self.k(mem).view(B, -1, self.heads, dh).transpose(1, 2)
            v = self.v(mem).view(B, -1, self.heads, dh).transpose(1, 2)
            a = torch.softmax(q @ k.transpose(-1, -2) / dh ** 0.5 + self.mask, dim=-1)
            att = (a @ v).transpose(1, 2).reshape(B, self.H, self.d)
            dec = self.skip_a(self.drop(self.o(att)), dec)
        z = self.g2(self.drop(nn.functional.elu(self.g1(dec))))
        z = self.grn_norm(torch.sigmoid(self.gg(z)) * z + dec)
        return self.head(z).transpose(1, 2)                 # [B,4,H]


def build(cfg, dims):
    return TFT(cfg, dims)
