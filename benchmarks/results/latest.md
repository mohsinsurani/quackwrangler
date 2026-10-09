# QuackWrangler benchmark

Generated 2026-10-04 on Apple M3 Pro (arm64, 18 GB RAM, Darwin 25.5.0).

| Engine | Version | Load (ms) | Transform (ms) | Total (ms) |
|---|---:|---:|---:|---:|
| QuackWrangler (DuckDB) | 1.5.6-r.1 | 21.36 | 8.18 | 29.68 |
| Polars | 1.43.1 | 5.69 | 21.48 | 26.24 |
| Pandas | 3.0.5 | 11.25 | 39.72 | 50.69 |

Values are medians of 7 measured runs after 2 warmups on a deterministic 1,000,000-row Parquet file. Lower is better. All engines returned the same validated result.
