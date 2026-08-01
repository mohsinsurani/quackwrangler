# QuackWrangler benchmark

Generated 2026-08-01 on Apple M3 Pro (arm64, 18 GB RAM, Darwin 25.5.0).

| Engine | Version | Load (ms) | Transform (ms) | Total (ms) |
|---|---:|---:|---:|---:|
| QuackWrangler (DuckDB) | 1.5.4-r.1 | 16.07 | 6.89 | 22.35 |
| Polars | 1.43.1 | 2.75 | 8.56 | 11.31 |
| Pandas | 3.0.5 | 8.89 | 35.09 | 43.66 |

Values are medians of 7 measured runs after 2 warmups on a deterministic 1,000,000-row Parquet file. Lower is better. All engines returned the same validated result.
