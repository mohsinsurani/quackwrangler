# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "pandas>=2.2,<4",
#   "polars>=1,<2",
#   "pyarrow>=16,<24",
# ]
# ///
"""Run equivalent Polars and Pandas workloads for the QuackWrangler benchmark."""

from __future__ import annotations

import gc
import json
import statistics
import sys
import time
from typing import Any, Callable

import pandas as pd
import polars as pl


DATA_PATH = sys.argv[1]
RUNS = int(sys.argv[2])
WARMUPS = int(sys.argv[3])


def normalize(records: list[dict[str, Any]]) -> list[list[Any]]:
    return [
        [
            record["region"],
            record["category"],
            int(record["row_count"]),
            round(float(record["gross"]), 6),
            round(float(record["avg_amount"]), 6),
        ]
        for record in records
    ]


def polars_iteration() -> dict[str, Any]:
    gc.collect()
    start = time.perf_counter_ns()
    frame = pl.read_parquet(DATA_PATH)
    load_ms = (time.perf_counter_ns() - start) / 1_000_000
    start = time.perf_counter_ns()
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
    transform_ms = (time.perf_counter_ns() - start) / 1_000_000
    output = normalize(result.to_dicts())
    del frame, result
    return {"load_ms": load_ms, "transform_ms": transform_ms, "total_ms": load_ms + transform_ms, "result": output}


def pandas_iteration() -> dict[str, Any]:
    gc.collect()
    start = time.perf_counter_ns()
    frame = pd.read_parquet(DATA_PATH)
    load_ms = (time.perf_counter_ns() - start) / 1_000_000
    start = time.perf_counter_ns()
    filtered = frame.loc[frame["active"] & frame["amount"].ge(25)].copy()
    filtered["gross_value"] = filtered["amount"] * filtered["quantity"]
    result = (
        filtered.groupby(["region", "category"], as_index=False, observed=True)
        .agg(row_count=("id", "size"), gross=("gross_value", "sum"), avg_amount=("amount", "mean"))
        .round({"gross": 6, "avg_amount": 6})
        .sort_values(["gross", "region", "category"], ascending=[False, True, True])
        .head(20)
    )
    transform_ms = (time.perf_counter_ns() - start) / 1_000_000
    output = normalize(result.to_dict(orient="records"))
    del frame, filtered, result
    return {"load_ms": load_ms, "transform_ms": transform_ms, "total_ms": load_ms + transform_ms, "result": output}


def benchmark(engine: str, version: str, iteration: Callable[[], dict[str, Any]]) -> dict[str, Any]:
    for _ in range(WARMUPS):
        iteration()
    samples = [iteration() for _ in range(RUNS)]
    return {
        "engine": engine,
        "version": version,
        "load_ms": round(statistics.median(sample["load_ms"] for sample in samples), 2),
        "transform_ms": round(statistics.median(sample["transform_ms"] for sample in samples), 2),
        "total_ms": round(statistics.median(sample["total_ms"] for sample in samples), 2),
        "result": samples[0]["result"],
    }


print(json.dumps({
    "python": sys.version.split()[0],
    "results": [
        benchmark("Polars", pl.__version__, polars_iteration),
        benchmark("Pandas", pd.__version__, pandas_iteration),
    ],
}))
