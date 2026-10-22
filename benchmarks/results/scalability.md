# Scalability and peak memory

| Rows | Engine | Status | Total (ms) | Peak process RSS (MB) |
|---:|---|---|---:|---:|
| 10,000 | QuackWrangler (DuckDB) | Completed | 6.09 | 98.50 |
| 10,000 | Polars | Completed | 3.45 | 133.69 |
| 10,000 | Pandas | Completed | 34.66 | 125.31 |
| 100,000 | QuackWrangler (DuckDB) | Completed | 17.68 | 104.97 |
| 100,000 | Polars | Completed | 5.43 | 147.08 |
| 100,000 | Pandas | Completed | 37.51 | 142.97 |
| 1,000,000 | QuackWrangler (DuckDB) | Completed | 22.72 | 165.53 |
| 1,000,000 | Polars | Completed | 15.81 | 313.83 |
| 1,000,000 | Pandas | Completed | 87.64 | 326.41 |
| 10,000,000 | QuackWrangler (DuckDB) | Completed | 137.37 | 672.39 |
| 10,000,000 | Polars | Completed | 151.54 | 1694.08 |
| 10,000,000 | Pandas | Completed | 593.59 | 1812.80 |

Medians of up to 3 fresh-process runs. Peak RSS includes each language runtime and loaded libraries. The current runner stops sampling after the first worker failure for an engine and row count, records the observed exit code or signal, and does not label OOM without supporting evidence.
