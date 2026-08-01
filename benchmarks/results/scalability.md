# Scalability and peak memory

| Rows | Engine | Status | Total (ms) | Peak process RSS (MB) |
|---:|---|---|---:|---:|
| 10,000 | QuackWrangler (DuckDB) | Completed | 4.61 | 90.98 |
| 10,000 | Polars | Completed | 3.20 | 133.67 |
| 10,000 | Pandas | Completed | 34.24 | 125.50 |
| 100,000 | QuackWrangler (DuckDB) | Completed | 19.73 | 100.80 |
| 100,000 | Polars | Completed | 5.16 | 147.02 |
| 100,000 | Pandas | Completed | 38.83 | 143.25 |
| 1,000,000 | QuackWrangler (DuckDB) | Completed | 22.88 | 166.23 |
| 1,000,000 | Polars | Completed | 15.82 | 308.84 |
| 1,000,000 | Pandas | Completed | 84.87 | 329.67 |
| 10,000,000 | QuackWrangler (DuckDB) | Completed | 147.63 | 740.61 |
| 10,000,000 | Polars | Completed | 242.48 | 1693.34 |
| 10,000,000 | Pandas | Completed | 572.01 | 1877.39 |

Medians of up to 3 fresh-process runs. Peak RSS includes each language runtime and loaded libraries. The current runner stops sampling after the first worker failure for an engine and row count, records the observed exit code or signal, and does not label OOM without supporting evidence.
