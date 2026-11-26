# Scalability and peak memory

| Rows | Engine | Status | Total (ms) | Peak process RSS (MB) |
|---:|---|---|---:|---:|
| 10,000 | QuackWrangler (DuckDB) | Completed | 5.99 | 97.63 |
| 10,000 | Polars | Completed | 3.69 | 132.12 |
| 10,000 | Pandas | Completed | 36.31 | 123.86 |
| 100,000 | QuackWrangler (DuckDB) | Completed | 17.94 | 104.14 |
| 100,000 | Polars | Completed | 5.57 | 145.27 |
| 100,000 | Pandas | Completed | 42.21 | 141.73 |
| 1,000,000 | QuackWrangler (DuckDB) | Completed | 22.57 | 165.73 |
| 1,000,000 | Polars | Completed | 16.57 | 314.48 |
| 1,000,000 | Pandas | Completed | 92.75 | 325.34 |
| 10,000,000 | QuackWrangler (DuckDB) | Completed | 142.41 | 681.00 |
| 10,000,000 | Polars | Completed | 167.79 | 1697.92 |
| 10,000,000 | Pandas | Completed | 591.02 | 1875.92 |

Medians of up to 3 fresh-process runs. Peak RSS includes each language runtime and loaded libraries. The current runner stops sampling after the first worker failure for an engine and row count, records the observed exit code or signal, and does not label OOM without supporting evidence.
