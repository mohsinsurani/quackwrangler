# Multi-format loading

| Format | Rows | File size (MB) | Load (ms) |
|---|---:|---:|---:|
| Parquet | 100,000 | 0.22 | 20.79 |
| CSV | 100,000 | 4.55 | 90.08 |
| NDJSON | 100,000 | 11.71 | 68.85 |

Medians of 7 loads into a fresh in-memory DuckDB instance. XLSX and ODS are excluded because their optional DuckDB extensions and writer setup would make the default benchmark network-dependent.
