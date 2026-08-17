# QuackWrangler benchmark

Generated 2026-08-14 on Apple M3 Pro (arm64, 18 GB RAM, Darwin 25.5.0).

| Engine | Version | Load (ms) | Transform (ms) | Total (ms) |
|---|---:|---:|---:|---:|
| QuackWrangler (DuckDB) | 1.5.4-r.1 | 22.68 | 8.82 | 31.46 |
| Polars | 1.43.1 | 3.84 | 11.41 | 15.26 |
| Pandas | 3.0.5 | 12.31 | 51.33 | 63.52 |

Values are medians of 7 measured runs after 2 warmups on a deterministic 1,000,000-row Parquet file. Lower is better. All engines returned the same validated result.
