# Changelog

All notable changes to QuackWrangler are documented here using [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.2.0] - 2026-08-17

### Added

- Added validated OpenAI-compatible provider, base URL, request timeout, current-history prompting, strict transform contracts, and an in-editor AI planning action.
- Added automatic eager/lazy source loading with configurable file-size threshold, DuckDB worker threads, and insertion-order behavior.
- Added a clean-profile VS Code Extension Host test suite for command registration, independent CSV panels, active-panel summarization, disposal, and reopening.

### Changed

- Registered CSV and XLSX alongside Parquet as default QuackWrangler custom-editor formats; explicit user editor associations can still override the defaults.
- Simplified the editor header and empty state, made AI planning easier to discover, added transform feedback and keyboard shortcuts, and accurately enabled undo/redo controls.
- Cached transformed schema, row counts, and statistics until pipeline changes, and combined search paging with its total count in the common case.
- Correlated asynchronous grid, profile, chart, export, and AI responses with request and session revisions so delayed work cannot overwrite newer editor state. Unsolicited host pushes such as **Summarize File** remain accepted and are validated against the visible session identity and revision.

### Fixed

- Each open editor now uses a unique DuckDB relation so loading or refreshing one panel does not silently replace another's data; failed reloads leave the prior session intact.
- Schema, row-count, and statistics caches no longer store stale results when the pipeline changes while a query is in flight.
- Bounded statistics queries to eight concurrent columns to prevent resource exhaustion on wide schemas.
- Cleared search state on all pipeline mutations (undo, redo, remove, reorder) so pagination cannot resume a stale search after a transform.
- AI transform history is now redacted before sending to the provider: only operation types and schema-safe column references are included; values, expressions, file paths, and literals are never transmitted.
- Removed `add_column` from AI contracts to prevent arbitrary SQL expression injection via an untrusted provider.
- `fill_nulls` now accepts number, boolean, and null values from the AI contract in addition to strings.
- The AI workflow is now guarded against stale-plan application: it rejects plans when the session or pipeline changed while waiting for the provider, and prevents concurrent AI requests per editor.
- dbt detection now requires a regular file, not any accessible entry.
- dbt context and the **Copy as dbt SQL** command now target the active/focused editor tab rather than the last-attached panel; context is recomputed on focus change and panel disposal.
- dbt SQL export now rejects histories containing `join_file` or `union_file` as these produce non-portable SQL with local file paths.
- Stats responses no longer clear global loading, preventing premature re-enabling of controls while a transform or query is still in flight.
- Remove, reorder, and export actions are guarded against firing while the session is loading.
- Charts cannot be requested while a session mutation is in progress.
- AI plan action disables and shows progress during the workflow; error responses clear the loading state.
- Category disclosure buttons in the Operations panel now carry `aria-expanded`.
- Operation form labels are now properly associated with their controls via `htmlFor`/`id`.
- Form close and chip remove buttons now have descriptive `aria-label` attributes.
- The global error banner now carries `role="alert"`.
- Column sort headers now carry `aria-sort` and support keyboard activation.
- Narrow responsive layout now correctly overrides the collapsed operations column width.
- The standalone development preview now responds to transform, search, query, export, and page requests so interactions do not permanently lock loading indicators.
- Custom queries now bind `current_data` to the originating panel's transformed pipeline, and exports preserve the active custom-query result instead of silently exporting different rows.
- Source reload promotion now uses a same-connection DuckDB transaction and unique staging relations so a failed promotion rolls back without destroying the prior dataset.
- AI cancellation, empty plans, stale plans, and overlapping requests now send terminal lifecycle messages so the AI action cannot remain indefinitely busy.
- dbt SQL export rejects raw `add_column` expressions and directs users to the validated Formula Builder for portable output.
- Row selection now works consistently in controlled and local modes, resets when loaded rows change, and ignores stale indexes when calculating Select All state.
- Command-created editors no longer reuse and replace an unrelated active panel.

## [0.1.5] - 2026-08-04

### Fixed

- Restored extension-host messages in VS Code webviews by validating their stable webview origin without incorrectly requiring the internal relay frame to be the immediate parent.
- Made the empty-state **Open File** and **Open Folder** actions load the chosen supported file into the current QuackWrangler editor, including nested folder selection and actionable empty-folder/load errors.

## [0.1.4] - 2026-08-04

### Security and community

- Added a documented security and privacy policy, CodeQL analysis, production dependency audits, contributor conduct and ownership files, a pull-request template, staged-file hooks, webview linting, formatting checks, and coverage regression gates.

### Added

- Added contextual `dbt_project.yml` detection with compact copy actions for complete dbt model SQL or reusable CTE snippets.

### Changed

- Made Parquet the only default QuackWrangler custom-editor association; other supported formats remain opt-in through **Open in QuackWrangler**.
- Reduced Linux and Alpine package size by retaining only the target-compatible DuckDB native binding in each VSIX.

### Fixed

- Moved default DuckDB spill files into unique VS Code-managed extension storage with cleanup, avoiding relative `.tmp` creation in read-only locations.
- Routed local Parquet command opens through the same visual custom-editor flow used by direct file clicks.

## [0.1.3] - 2026-08-01

### Added

- A compact 128×128 Marketplace icon and public project logo
- A maintainer-focused release and Marketplace publishing guide
- Platform-specific Marketplace packaging for Windows, Linux, Alpine Linux, and macOS on x64 and ARM64

### Changed

- Replaced retired dynamic Marketplace badges with a stable linked release badge
- Aligned CI and contributor requirements on Node.js 20 and 22, TypeScript 5.9, and ESLint 9
- Changed the default opt-in AI transform model to the available `gpt-4o-mini` model
- Rewrote the project introduction, privacy explanation, and DuckDB/Polars roadmap in a clearer maintainer voice
- Added concise Karpathy-inspired coding principles to the repository agent guidance
- Made local packaging detect and label the current native platform instead of producing a misleading universal VSIX

### Fixed

- Restored clean dependency installation by resolving TypeScript and ESLint peer conflicts
- Updated Vite chunk configuration for the current webview build toolchain

## [0.1.2] - 2026-08-01

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

[Unreleased]: https://github.com/mohsinsurani/quackwrangler/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/mohsinsurani/quackwrangler/compare/v0.1.5...v0.2.0
[0.1.5]: https://github.com/mohsinsurani/quackwrangler/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/mohsinsurani/quackwrangler/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/mohsinsurani/quackwrangler/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/mohsinsurani/quackwrangler/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/mohsinsurani/quackwrangler/releases/tag/v0.1.1
