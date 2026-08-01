# Changelog

All notable changes to QuackWrangler are documented here using [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- DuckDB-backed column profiles, percentiles, distributions, data-quality findings, and charts
- Virtualized synchronized profile/header/data grid with drag resize, double-click auto-fit, width presets, clip/wrap modes, and complete-value inspection
- Row selection and multi-row copying as TSV, CSV, pipe-separated text, or named JSON
- Full-table search, header sorting, cell quick filters, pivot/unpivot, and drag-reorderable transform history
- Visual formula builder for conditional values, date differences, regex extraction, and text combination
- Multi-file joins and union-by-name
- Read-only custom DuckDB query console with in-grid results
- CSV, JSON, and Parquet export from the complete transformed relation
- Recursive supported-file folder browser and ten recent-file shortcuts
- Versioned `.qw` workspaces that restore a source file and validated transform history
- Marketplace documentation, demo assets, issue templates, release guidance, and contributor automation
- Reproducible DuckDB/Polars/Pandas engine, scalability, peak-RSS, and file-format benchmarks with machine-readable results
- Opt-in 50M/100M scalability inputs and named result artifacts for large exploratory runs
- Expandable nested-value tree with JSON Pointer copying and undoable extract, flatten, and explode transforms
- Arrow IPC loading through DuckDB's signed nanoarrow extension and HTTPS/S3 sources through httpfs
- Box plots and numeric correlation heatmaps
- Opt-in, schema-only OpenAI transform planning with SecretStorage, preview, allow-list validation, and explicit approval
- Multi-file schema comparison and recursive folder drift reports
- ORC detection with an explicit compatibility message until DuckDB provides a supported reader
- Staged HTTPS/S3 loading progress with actionable remote-reader errors

### Changed

- Redesigned the webview around a compact VS Code-native layout with collapsible operations, quality, and visualization areas
- Standardized on the in-process DuckDB engine for a zero-Python, zero-Jupyter runtime
- Centralized file-format detection and reader mapping
- Simplified the webview protocol to send only data the active UI consumes
- Applied the configured page size to initial and transformed result pages
- Removed unused generated-code, transform-registry, Python/Polars sidecar, duplicate message-request, and deprecated UI-toolkit code
- Updated architecture, README, contribution, CI, dependency, packaging, and release documentation to match the shipped implementation
- Refreshed README screenshots and demo GIF from the current React development preview
- Made scalability workers process-isolated and failure-aware while preserving results from successful engines
- Kept Operations collapsed and visibly labelled by default so the table receives more editor space
- Excluded generated benchmark datasets and development-only files from Marketplace packages

### Fixed

- Kept profiles, headers, and rows aligned during horizontal scrolling and resizing
- Prevented resize and auto-fit controls from changing column sort direction
- Avoided numeric aggregation against nested JSON/struct/list columns
- Fixed structured filters, duplicate removal parameter handling, export operations, and file-loading errors
- Preserved complete long and nested cell values without `[object Object]` coercion
- Recorded benchmark worker exit codes/signals without treating a kill signal alone as proof of OOM

## [0.1.1] - 2026-07-22

### Added

- Initial public VS Code Marketplace release
- DuckDB-native viewing and visual transformation for Parquet, CSV, TSV, JSON/JSONL/NDJSON, XLSX, and ODS data
- Filtering, sorting, column transforms, deduplication, aggregation, paging, schema inspection, summaries, and Parquet/CSV/JSON export
- Activity-bar file browser and custom data editor integration

[Unreleased]: https://github.com/mohsinsurani/quackwrangler/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/mohsinsurani/quackwrangler/releases/tag/v0.1.1
