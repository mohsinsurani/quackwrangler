# Multi-format loading

| Format | Rows | File size (MB) | Load (ms) |
|---|---:|---:|---:|
| Parquet | 100,000 | 0.22 | 13.98 |
| CSV | 100,000 | 4.55 | 63.49 |
| NDJSON | 100,000 | 11.71 | 50.62 |

Medians of 7 loads into a fresh in-memory DuckDB instance. XLSX and ODS are excluded because their optional DuckDB extensions and writer setup would make the default benchmark network-dependent.
