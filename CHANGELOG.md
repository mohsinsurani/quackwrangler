# Changelog

All notable changes to QuackWrangler will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2024-01-01

### Added

- Initial release of QuackWrangler
- DuckDB-powered data querying for Parquet, CSV, and JSON files
- Interactive data grid with virtualized scrolling
- Column statistics (min, max, mean, null count, unique count)
- Basic transforms:
  - Drop Column
  - Rename Column
  - Filter Rows
  - Sort Rows
  - Cast Type
  - Fill Missing Values
  - Deduplicate
- Code generation (DuckDB SQL and Python)
- VS Code webview integration
- File detection and auto-open
- Configuration options for memory limits and file handling
- Keyboard shortcuts for query execution
- Right-click context menu integration

### Known Issues

- Large files (>10GB) may be slow to load initially
- Some transform operations require exact column names
