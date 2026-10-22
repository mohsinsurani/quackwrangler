# Scalability and peak memory

| Rows | Engine | Status | Total (ms) | Peak process RSS (MB) |
|---:|---|---|---:|---:|
| 50,000,000 | QuackWrangler (DuckDB) | Completed | 1205.94 | 2076.31 |
| 50,000,000 | Polars | Completed | 2241.56 | 3536.48 |
| 50,000,000 | Pandas | Completed | 4222.24 | 5328.91 |

Medians of up to 1 fresh-process runs. Peak RSS includes each language runtime and loaded libraries. The current runner stops sampling after the first worker failure for an engine and row count, records the observed exit code or signal, and does not label OOM without supporting evidence.
