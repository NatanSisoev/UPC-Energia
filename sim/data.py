"""Load the official training CSVs into one hourly campus dataframe.

Columns: load_kw, pv_kw, precio_eur_per_kwh, co2_kg_per_kwh (index = hourly Timestamp).
Follows the pipeline published on the challenge page. If data/train is missing,
`synthetic_campus()` gives a plausible fake year so tests and the baseline run without a download.
"""
from pathlib import Path

import numpy as np
import pandas as pd

DATA_DIR = Path(__file__).resolve().parent.parent / "data" / "train"
CONTADOR_COL = "Contador - POTENCIA ACTIVA EXPORTADA (kW)"
PV_SCALE_HARD = 12.0                                   # Hard Mode: 12x the solar plant
METEO_KEYS = {                                         # substring of the meteo.csv column -> Hard Mode telemetry key
    "IRRADIANCIA (W/m2)": "irradiancia_wm2",
    "TEMPERATURA AMBIENTE": "temp_ambient_c",
    "TEMPERATURA PANEL": "temp_panel_c",
    "VELOCIDAD VIENTO": "vent_ms",
}


def data_available(data_dir: Path = DATA_DIR) -> bool:
    return (Path(data_dir) / "contador.csv").exists()


def _read(data_dir: Path, name: str) -> pd.DataFrame:
    return pd.read_csv(Path(data_dir) / name, parse_dates=["Fecha"]).set_index("Fecha")


def load_meteo_hourly(data_dir: Path = DATA_DIR) -> pd.DataFrame:
    """Hourly means of the weather station, columns named like the Hard Mode telemetry keys."""
    meteo = _read(data_dir, "meteo.csv")
    cols = {next(c for c in meteo.columns if c.endswith(k) or k in c and "SENSOR" in c): v
            for k, v in METEO_KEYS.items()}
    return meteo[list(cols)].rename(columns=cols).resample("1h").mean()


def load_campus_hourly(data_dir: Path = DATA_DIR, hard: bool = False) -> pd.DataFrame:
    """hard=True gives the Hard Mode campus: solar x12 plus the hourly weather columns (NaN where the station
    has no reading). Use it with sim.simulator.HARD."""
    if hard:
        df = load_campus_hourly(data_dir)
        df["pv_kw"] *= PV_SCALE_HARD
        return df.join(load_meteo_hourly(data_dir), how="left")
    contador = _read(data_dir, "contador.csv")
    load = (-contador[CONTADOR_COL]).clip(lower=0, upper=5000).resample("1h").mean().dropna()

    inversor = _read(data_dir, "inversor.csv")
    cols = [c for c in inversor.columns if "POTENCIA ACTIVA" in c and "FASE" not in c]
    pv = inversor[cols].sum(axis=1).clip(lower=0).resample("1h").mean().dropna()

    pvpc = _read(data_dir, "precio_pvpc.csv")
    co2 = _read(data_dir, "co2_red.csv")
    return pd.DataFrame({
        "load_kw": load,
        "pv_kw": pv,
        "precio_eur_per_kwh": pvpc["precio_eur_per_kwh"],
        "co2_kg_per_kwh": co2["co2_kg_per_kwh"],
    }).dropna()


def synthetic_campus(days: int = 84, seed: int = 0) -> pd.DataFrame:
    """Fake but shaped-like-real hourly data (NOT for model selection, only for plumbing/tests)."""
    rng = np.random.default_rng(seed)
    idx = pd.date_range("2025-01-06", periods=days * 24, freq="h")
    h = idx.hour.values
    weekday = (idx.day_of_week.values < 5).astype(float)
    load = 600 + 500 * weekday * ((h >= 8) & (h <= 19)) + rng.normal(0, 40, len(idx))
    pv = np.clip(900 * np.sin(np.pi * (h - 6) / 12), 0, None) * rng.uniform(0.6, 1.0, len(idx))
    price = 0.08 + 0.10 * ((h >= 18) & (h <= 22)) + 0.03 * ((h >= 8) & (h <= 14)) + rng.normal(0, 0.01, len(idx))
    co2 = 0.12 + 0.10 * ((h >= 19) & (h <= 22)) - 0.06 * ((h >= 11) & (h <= 16)) + rng.normal(0, 0.01, len(idx))
    return pd.DataFrame({
        "load_kw": load.clip(50), "pv_kw": pv,
        "precio_eur_per_kwh": price.clip(0.01), "co2_kg_per_kwh": co2.clip(0.01),
    }, index=idx)


def week_blocks(df: pd.DataFrame, hours: int = 168) -> list:
    """Split into contiguous whole-week blocks (use these for CV; never random hour splits)."""
    return [df.iloc[i:i + hours] for i in range(0, len(df) - hours + 1, hours)]
