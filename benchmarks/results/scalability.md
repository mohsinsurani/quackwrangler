# Scalability and peak memory

| Rows | Engine | Status | Total (ms) | Peak process RSS (MB) |
|---:|---|---|---:|---:|
| 10,000 | QuackWrangler (DuckDB) | Completed | 5.76 | 97.36 |
| 10,000 | Polars | Completed | 4.79 | 133.33 |
| 10,000 | Pandas | Completed | 75.84 | 125.86 |
| 100,000 | QuackWrangler (DuckDB) | Completed | 27.58 | 102.31 |
| 100,000 | Polars | Completed | 6.82 | 146.34 |
| 100,000 | Pandas | Completed | 52.17 | 143.48 |
| 1,000,000 | QuackWrangler (DuckDB) | Completed | 44.66 | 171.38 |
| 1,000,000 | Polars | Completed | 34.84 | 308.11 |
| 1,000,000 | Pandas | Completed | 105.54 | 323.59 |
| 10,000,000 | QuackWrangler (DuckDB) | Completed | 320.88 | 740.33 |
| 10,000,000 | Polars | Completed | 559.61 | 1224.28 |
| 10,000,000 | Pandas | Completed | 787.46 | 1627.00 |

Medians of up to 3 fresh-process runs. Peak RSS includes each language runtime and loaded libraries. The current runner stops sampling after the first worker failure for an engine and row count, records the observed exit code or signal, and does not label OOM without supporting evidence.
