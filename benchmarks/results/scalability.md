# Scalability and peak memory

| Rows | Engine | Status | Total (ms) | Peak process RSS (MB) |
|---:|---|---|---:|---:|
| 10,000 | QuackWrangler (DuckDB) | Completed | 6.30 | 98.92 |
| 10,000 | Polars | Completed | 4.45 | 133.80 |
| 10,000 | Pandas | Completed | 50.47 | 125.48 |
| 100,000 | QuackWrangler (DuckDB) | Completed | 28.18 | 109.45 |
| 100,000 | Polars | Completed | 6.68 | 147.02 |
| 100,000 | Pandas | Completed | 55.67 | 142.95 |
| 1,000,000 | QuackWrangler (DuckDB) | Completed | 27.47 | 174.75 |
| 1,000,000 | Polars | Completed | 19.97 | 311.42 |
| 1,000,000 | Pandas | Completed | 120.42 | 326.56 |
| 10,000,000 | QuackWrangler (DuckDB) | Completed | 203.16 | 743.36 |
| 10,000,000 | Polars | Completed | 229.68 | 1691.70 |
| 10,000,000 | Pandas | Completed | 825.69 | 1874.95 |

Medians of up to 3 fresh-process runs. Peak RSS includes each language runtime and loaded libraries. The current runner stops sampling after the first worker failure for an engine and row count, records the observed exit code or signal, and does not label OOM without supporting evidence.
