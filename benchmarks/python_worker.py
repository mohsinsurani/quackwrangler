# /// script
# requires-python = ">=3.10"
# dependencies = ["pandas>=2.2,<4", "polars>=1,<2", "pyarrow>=16,<24"]
# ///
"""Measure one engine in a fresh process for defensible peak-RSS results."""

from __future__ import annotations

import json
import platform
import resource
import sys
import time

import pandas as pd
import polars as pl


engine, data_path = sys.argv[1:3]
start = time.perf_counter_ns()

if engine == "polars":
    frame = pl.read_parquet(data_path)
    result = (
        frame.filter(pl.col("active") & (pl.col("amount") >= 25))
        .group_by(["region", "category"])
        .agg(
            pl.len().alias("row_count"),
            (pl.col("amount") * pl.col("quantity")).sum().round(6).alias("gross"),
            pl.col("amount").mean().round(6).alias("avg_amount"),
        )
        .sort(["gross", "region", "category"], descending=[True, False, False])
        .head(20)
    )
    records = result.to_dicts()
elif engine == "pandas":
    frame = pd.read_parquet(data_path)
    filtered = frame.loc[frame["active"] & frame["amount"].ge(25)].copy()
    filtered["gross_value"] = filtered["amount"] * filtered["quantity"]
    result = (
        filtered.groupby(["region", "category"], as_index=False, observed=True)
        .agg(row_count=("id", "size"), gross=("gross_value", "sum"), avg_amount=("amount", "mean"))
        .round({"gross": 6, "avg_amount": 6})
        .sort_values(["gross", "region", "category"], ascending=[False, True, True])
        .head(20)
    )
    records = result.to_dict(orient="records")
else:
    raise ValueError(f"Unknown engine: {engine}")

normalized = [[row["region"], row["category"], int(row["row_count"]), round(float(row["gross"]), 6), round(float(row["avg_amount"]), 6)] for row in records]
raw_rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
peak_rss_mb = raw_rss / (1024 * 1024) if platform.system() == "Darwin" else raw_rss / 1024

print(json.dumps({
    "total_ms": round((time.perf_counter_ns() - start) / 1_000_000, 2),
    "peak_rss_mb": round(peak_rss_mb, 2),
    "result": normalized,
}))
