"""Date-centred (kernel) weights for the Hard Mode profiles -- experiments only.

A profile cell for target month m is a weighted mean over train days; the weight of a day depends only on its calendar
distance (days) to the centre date of the TARGET WEEK of that month:
    triangular:  max(0, 1 - dist / bw)          gaussian:  exp(-0.5 (dist / (bw / 2))^2), truncated at dist >= bw
Month membership is ignored: neighbouring months are pooled by distance alone.  bw None = off (the callers then run
the original, month-indexed code path untouched, so outputs are bit-identical to experiments/hard).

Centre of the target week, per month m (0-based, Sep..Dec = 2025, Jan..Aug = 2026):
  centre_final    middle of the last 7 calendar days of the month (the real hidden-test week)
  centre_holdout  middle of the hold-out week = last 168 h of the month in the campus df (the last 7 TRAIN days);
                  months without load data (November) use the market signals' last 168 h
  centre_chunk    middle of the left-out chunk (days 1-7 / 8-14 / 15-end of the train data) of that month
"""
import calendar

import numpy as np
import pandas as pd

EPOCH = pd.Timestamp("2025-01-01")


def year_of(m):
    return 2025 if m >= 8 else 2026


def ordinal(ts):
    return float((pd.Timestamp(ts).normalize() - EPOCH) / pd.Timedelta("1D"))


def day_ord(index):
    """Day ordinal (days since 2025-01-01) of every row."""
    return ((index.normalize() - EPOCH) // pd.Timedelta("1D")).values.astype(float)


def centre_final(m):
    y = year_of(m)
    return ordinal(pd.Timestamp(y, m + 1, calendar.monthrange(y, m + 1)[1] - 3))


def centre_holdout(m, df, sig):
    y = year_of(m)
    for src in (df, sig):
        sel = src[(src.index.year == y) & (src.index.month == m + 1)]
        if len(sel) >= 168:
            return float(np.mean(day_ord(sel.index[-168:])))
    raise ValueError(f"no data for month {m}")


def centre_chunk(m, c, sig):
    """Middle of chunk c (0: days 1-7, 1: 8-14, 2: 15..end of data) of month m, from the days present in sig."""
    y = year_of(m)
    sel = sig[(sig.index.year == y) & (sig.index.month == m + 1)]
    d = sel.index.day.values
    chunk = np.where(d <= 7, 0, np.where(d <= 14, 1, 2))
    return float(np.mean(day_ord(sel.index[chunk == c])))


class Kernel:
    def __init__(self, bw, cyclic=False, kind="tri"):
        self.bw, self.cyclic, self.kind = float(bw), bool(cyclic), kind

    def weights(self, index, centres):
        """(12, N) weight of every row for each target month's centre."""
        d = np.abs(day_ord(index)[None, :] - np.asarray(centres, float)[:, None])
        if self.cyclic:
            d = d % 365.0
            d = np.minimum(d, 365.0 - d)
        if self.kind == "gauss":
            w = np.exp(-0.5 * (d / (self.bw / 2.0)) ** 2)
            return np.where(d < self.bw, w, 0.0)
        return np.maximum(0.0, 1.0 - d / self.bw)

    def tag(self):
        return f"{self.kind}{self.bw:g}{'c' if self.cyclic else ''}"


def centres_final():
    return np.array([centre_final(m) for m in range(12)])


def centres_holdout(df, sig):
    return np.array([centre_holdout(m, df, sig) for m in range(12)])


def centres_chunk(c, sig):
    return np.array([centre_chunk(m, c, sig) for m in range(12)])
