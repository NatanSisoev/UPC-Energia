"""Reference architecture: MLP on [last `last` rows of hist, fut, stat] flattened -> two hidden layers -> 4 x 24 corrections."""
import torch
from torch import nn

CONFIGS = {"base": {"hidden": 128, "last": 24, "lr": 1e-3, "wd": 1e-2, "batch": 128, "max_epochs": 60, "patience": 8}}


class MLP(nn.Module):
    def __init__(self, cfg, dims):
        super().__init__()
        self.last, d_in = cfg["last"], cfg["last"] * dims["C"] + dims["H"] * dims["F"] + dims["S"]
        h = cfg["hidden"]
        self.net = nn.Sequential(nn.Linear(d_in, h), nn.GELU(approximate="tanh"), nn.Linear(h, h),
                                 nn.GELU(approximate="tanh"), nn.Linear(h, 4 * dims["H"]))
        self.H = dims["H"]

    def forward(self, hist, fut, stat):
        x = torch.cat([hist[:, -self.last:].flatten(1), fut.flatten(1), stat], dim=1)
        return self.net(x).view(-1, 4, self.H)


def build(cfg, dims):
    return MLP(cfg, dims)
