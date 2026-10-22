# QuackWrangler benchmark

Generated 2026-10-22 on Apple M3 Pro (arm64, 18 GB RAM, Darwin 25.5.0).

| Engine | Version | Load (ms) | Transform (ms) | Total (ms) |
|---|---:|---:|---:|---:|
| QuackWrangler (DuckDB) | 2.0.0-r.1 | 14.67 | 6.98 | 21.62 |
| Polars | 1.43.1 | 2.76 | 8.49 | 11.25 |
| Pandas | 3.0.5 | 9.34 | 42.45 | 51.49 |

Values are medians of 7 measured runs after 2 warmups on a deterministic 1,000,000-row Parquet file. Lower is better. All engines returned the same validated result.
