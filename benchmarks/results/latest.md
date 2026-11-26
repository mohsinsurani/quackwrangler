# QuackWrangler benchmark

Generated 2026-11-26 on Apple M3 Pro (arm64, 18 GB RAM, Darwin 27.2.0).

| Engine | Version | Load (ms) | Transform (ms) | Total (ms) |
|---|---:|---:|---:|---:|
| QuackWrangler (DuckDB) | 2.0.1-r.1 | 13.04 | 6.76 | 18.97 |
| Polars | 1.43.1 | 2.75 | 8.97 | 11.64 |
| Pandas | 3.0.5 | 9.33 | 35.69 | 45.21 |

Values are medians of 7 measured runs after 2 warmups on a deterministic 1,000,000-row Parquet file. Lower is better. All engines returned the same validated result.
