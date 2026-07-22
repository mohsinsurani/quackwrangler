# Changelog

All notable changes to QuackWrangler will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-07-22

### Added

- Initial release of QuackWrangler
- DuckDB-powered viewing for Parquet, CSV, TSV, JSON, JSONL/NDJSON, XLSX, and ODS
- Interactive virtualized grid with synchronized horizontal scrolling
- Column profiles with valid, null, unique, range, and distribution summaries
- Nested JSON value inspection
- Data transforms:
  - Drop Column
  - Rename Column
  - Filter Rows
  - Sort Rows
  - Cast Type
  - Fill Missing Values
  - Deduplicate
- Group and aggregate
- Expanded text, numeric, range, membership, and null filters
- Read-only custom DuckDB SQL with results displayed in the grid
- Full-dataset export to Parquet, CSV, and JSON
- Code generation for DuckDB SQL and optional Polars Python
- Transformation undo and redo
- VS Code webview integration
- File detection and auto-open
- Configuration options for memory limits and file handling
- Keyboard shortcuts for query execution
- Right-click context menu integration

### Deferred

- Native Polars execution is planned for Version 2
