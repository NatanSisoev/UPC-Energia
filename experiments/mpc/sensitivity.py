"""Which implementation details are worth leaderboard points? (experiments only)

Everything is measured against the perfect-foresight optimum on the 6,768 train hours of price/CO2.
Run:  python -m experiments.mpc.sensitivity
"""
import numpy as np

from experiments.mpc.arb import default_weights, load_signals, mpc_gain, oracle_gain

if __name__ == "__main__":
    df = load_signals()
    k_co2, k_price = default_weights(df)
    co2, price = df["co2"].values, df["price"].values
    w = k_co2 * co2 + k_price * price
    orc = oracle_gain(w)
    print(f"oracle: {orc:.4f} points\n")

    def report(name, g):
        print(f"{name:46s}: {g:.4f}  loss {orc - g:+.4f} pts  ({100 * g / orc:.2f} %)")

    report("MPC 24 h (reference)", mpc_gain(w))
    report("  + terminal value mean(w)", mpc_gain(w, tv_fn=lambda t, e: float(np.mean(e))))
    report("  + extend with repeat-last-day", mpc_gain(w, extend=lambda t, k: k[-24:]))
    report("list read as starting at t+1 (misaligned)", mpc_gain(w, offset=1))
    report("end of simulation hidden (padded list)", mpc_gain(w, endgame=False))
    print("\nwrong CO2:price weight ratio (plan on w', score on w):")
    for f in (0.0, 0.5, 0.8, 0.9, 1.1, 1.25, 2.0, 1e6):
        wp = k_co2 * co2 + f * k_price * price
        label = "CO2 only" if f == 0 else "price only" if f > 1e3 else f"price weight x{f}"
        report("  " + label, mpc_gain(w, w_plan=wp))
