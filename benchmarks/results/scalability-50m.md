# Scalability and peak memory

| Rows | Engine | Status | Total (ms) | Peak process RSS (MB) |
|---:|---|---|---:|---:|
| 50,000,000 | QuackWrangler (DuckDB) | Completed | 1179.55 | 2287.92 |
| 50,000,000 | Polars | Completed | 2725.76 | 3821.86 |
| 50,000,000 | Pandas | Completed | 4544.80 | 4924.06 |

Medians of up to 1 fresh-process runs. Peak RSS includes each language runtime and loaded libraries. The current runner stops sampling after the first worker failure for an engine and row count, records the observed exit code or signal, and does not label OOM without supporting evidence.
