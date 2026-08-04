# QuackWrangler Architecture

QuackWrangler is a VS Code desktop extension with a DuckDB execution core and a React webview. The current release has no Python runtime, sidecar process, notebook dependency, or generated-code pane.

## Runtime boundaries

```text
┌──────────────────────────────────────────────────────────────┐
│ React webview                                                │
│ App state · operations · profiles · charts · virtual grid   │
└────────────────────────────┬─────────────────────────────────┘
                             │ VS Code postMessage
                             │ typed commands / bounded pages
┌────────────────────────────▼─────────────────────────────────┐
│ VS Code extension host                                      │
│ commands · panel lifecycle · recent files · .qw workspaces  │
└────────────────────────────┬─────────────────────────────────┘
                             │ in-process Node API
┌────────────────────────────▼─────────────────────────────────┐
│ DuckDB                                                      │
│ file readers · SQL pipeline · profiles · charts · exports   │
└──────────────────────────────────────────────────────────────┘
```

The webview never reads the file system. The extension host owns file dialogs, persistent VS Code state, workspace files, and DuckDB connections.

## Source layout

| Path                                               | Responsibility                                                                           |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `src/extension.ts`                                 | Activation, command registration, custom editor, activity-bar tree                       |
| `src/commands/index.ts`                            | Webview message handling, sessions, dialogs, exports, recent files, `.qw` workspaces     |
| `src/duckdb/connection.ts`                         | DuckDB lifecycle and configuration                                                       |
| `src/duckdb/parquet-loader.ts`                     | Supported reader selection, extension loading, source table creation                     |
| `src/duckdb/query-engine.ts`                       | Read-only query validation and file export                                               |
| `src/transforms/pipeline.ts`                       | Transform validation, SQL generation, history, paging, search, profiles, quality, charts |
| `src/webview/provider.ts`                          | Secure webview HTML and panel lifecycle                                                  |
| `src/views/dataFilesProvider.ts`                   | Recursive supported-file browser                                                         |
| `webview-ui/src/App.tsx`                           | Webview orchestration and view state                                                     |
| `webview-ui/src/components/OperationsPanel.tsx`    | Operation definitions and parameter forms                                                |
| `webview-ui/src/components/DataGrid.tsx`           | Virtualized rows, selection, copying, resizing, inspection, quick filters                |
| `webview-ui/src/components/ColumnProfiles.tsx`     | Per-column summaries aligned to grid tracks                                              |
| `webview-ui/src/components/DataQualitySummary.tsx` | Null, duplicate, and outlier issues                                                      |
| `webview-ui/src/components/ChartPanel.tsx`         | Histogram, bar, line, scatter, box-plot, and correlation controls/rendering              |
| `src/utils/remoteProgress.ts`                      | Remote-source detection and monotonic loading stages                                     |
| `benchmarks/run.mjs`                               | Validated one-million-row cross-engine comparison                                        |
| `benchmarks/scalability.mjs`                       | Fresh-process scaling, peak RSS, and failure recording                                   |
| `benchmarks/formats.mjs`                           | DuckDB Parquet, CSV, and NDJSON loading comparison                                       |

## File opening

1. A custom editor, command, recent-file item, or folder-tree item supplies a path.
2. `parquet-loader.ts` maps its extension to one DuckDB reader.
3. DuckDB materializes the source as `current_data` for a stable session boundary.
4. `WranglingSession` starts with empty transform history.
5. The extension sends schema, one bounded result page, page metadata, and history.
6. The webview requests profiles separately so the grid can appear first.

Only Parquet is registered with default custom-editor priority. Local Parquet paths selected through QuackWrangler commands are routed through the same `vscode.openWith` custom-editor flow. Other supported formats keep their existing VS Code editor association and open visually only when the user invokes QuackWrangler.

Supported extensions have one TypeScript source of truth in `DATA_FILE_EXTENSIONS`. The VS Code manifest must also be updated when a format is added because contribution points are declarative JSON.

## Transform pipeline

Operations are immutable records containing `type`, validated `params`, generated SQL, and a description. `buildPipelineSQL` chains them as CTEs:

```sql
WITH step_1 AS (... FROM current_data),
     step_2 AS (... FROM step_1)
SELECT * FROM step_2
```

This design makes undo, redo, removal, drag reordering, workspace persistence, preview paging, and full-data export use the same SQL. UI shortcuts such as header sorting and cell quick filters call the same pipeline API as forms.

Add a transform in two places:

1. Add its validated SQL case in `operationSql` in `src/transforms/pipeline.ts`.
2. Add its form definition in `webview-ui/src/components/OperationsPanel.tsx`.

Add unit and DuckDB integration coverage for both generation and execution.

## Paging and rendering

DuckDB calculates against the full transformed relation. The extension sends 100-row pages by default. The grid virtualizes even that bounded page so row wrapping and large editor sizes remain responsive. Profiles, headers, and rows share one CSS grid template and horizontal scroll surface.

Column profiling is type-aware. Numeric aggregates are never applied to struct, list, map, union, JSON, or other nested values. Chart queries are generated in the extension and return bounded aggregates or points.

Nested cells open in a recursive tree inside the grid inspector. The browser builds RFC 6901-style JSON Pointers for display and clipboard use, while transform requests carry structured path segments. The pipeline converts string segments to allow-listed `struct_extract` calls and numeric segments to one-based DuckDB `list_extract` calls. Extract, flatten, and explode therefore use the same validated history, undo/redo, reordering, paging, and `.qw` persistence path as every other visual transform.

## Queries and exports

The custom query console accepts one `SELECT`, `WITH`, or `VALUES` statement. Mutation statements and multiple statements are rejected. Queries run against `current_data` and show their own paginated result state.

Exports use DuckDB `COPY` over the full pipeline SQL, not the visible page. CSV, JSON, and Parquet are supported.

## DuckDB temporary storage

When the user has not configured `quackwrangler.duckdb.tempDirectory`, the extension creates a unique spill directory below `ExtensionContext.globalStorageUri`. This prevents DuckDB from attempting to create a relative `.tmp` directory in a read-only workspace or process directory. The directory is removed after connection failure or extension deactivation; cleanup failures are logged without masking the original error. User-configured directories are created when needed and are not deleted by QuackWrangler.

## Lightweight dbt context

For a local data file, the extension searches upward to the active workspace boundary for `dbt_project.yml`. A successful match sets a contextual VS Code key that reveals one compact **Copy as dbt SQL** action. The export asks for an upstream model name and wraps the active validated transform history with `{{ ref('model_name') }}` as either a complete model query or a CTE snippet. It preserves DuckDB SQL semantics and does not translate expressions for other dbt adapters. It also does not parse artifacts, inspect the dbt graph, run dbt, or add a permanent sidebar.

Remote HTTPS and S3 paths flow through the same reader mapping as local files. The extension prepares DuckDB `httpfs` before metadata or loading queries and emits monotonic staged progress to the webview; failures replace progress with an actionable error. Because DuckDB uses HTTP range requests for formats such as Parquet, these stages describe loading progress rather than falsely claiming exact downloaded-byte percentages. S3 credentials remain in DuckDB/AWS credential-chain facilities and are never serialized into webview messages or `.qw` workspaces. Arrow IPC uses the signed `nanoarrow` community extension. ORC is recognized but intentionally rejected because the embedded DuckDB runtime has no supported reader.

## AI transform planning

AI is command-driven and opt-in. The API key is stored in VS Code SecretStorage. The request contains the user instruction plus column name, DuckDB type, and nullability only. Structured output is constrained to an allow-list of visual operations, parsed and validated locally, displayed for confirmation, and then rebuilt through `WranglingSession.apply`. Raw SQL and automatic execution are not accepted. If any generated step fails validation, steps added by that plan are rolled back.

## Schema comparison

Schema comparison uses the same prepared reader and `DESCRIBE` metadata path as file loading. A pure comparison layer classifies added, missing, and type-changed columns against the first selected file. Folder drift detection recursively gathers supported files, caps each report at 100 inputs, and opens the result as a Markdown document without loading row values into the webview.

## Multi-file operations

Join and union forms ask the extension host to select a second supported file. The extension prepares any required DuckDB reader, then the pipeline references that file directly. Joins validate their type and quote both keys; unions use `UNION ALL BY NAME`.

## Persistence

- Recent files are capped at ten paths in VS Code `globalState`.
- `.qw` files contain format version `1`, a source path, and transform types/parameters.
- Loading a workspace rebuilds every transform through current validation instead of trusting serialized SQL.

## Message protocol

`src/types/index.ts` is authoritative for extension-host messages. `webview-ui/src/types.ts` contains the webview-facing subset so the browser bundle does not import Node-oriented source.

Main webview requests include `ready`, `applyTransform`, paging, search, chart requests, exports, file selection, and history actions. Main extension responses include `sessionUpdated`, remote loading progress, query/search/chart results, statistics, secondary-file metadata, export completion, and errors.

Increment `WEBVIEW_PROTOCOL_VERSION` when a `sessionUpdated` payload changes incompatibly. This produces an actionable restart message instead of silently rendering stale state in an Extension Development Host.

## Security

- Webview content uses a restrictive Content Security Policy and VS Code resource URIs.
- The webview has no direct disk or DuckDB access.
- Structured transforms quote identifiers and values and allow-list cast, aggregate, join, and date-unit choices.
- Saved workspaces persist parameters, never executable serialized SQL.
- Custom SQL is read-only and limited to one statement.

## Native distribution

DuckDB's Node binding contains platform-specific native libraries. QuackWrangler therefore publishes separate VSIX packages for Windows, Linux, Alpine Linux, and macOS on x64 and ARM64 under one Marketplace version. VS Code selects the matching target automatically. There is no un-targeted fallback package because a VSIX containing only the maintainer's local DuckDB binary would fail on other systems.

`scripts/vsce-platform.mjs` makes local packaging target the current platform. `.github/workflows/package-platforms.yml` builds the complete release matrix on matching GitHub-hosted runners and verifies that the expected DuckDB binding is installed before packaging.

## Testing

- Unit tests cover file detection, remote progress, SQL generation, connection setup, message/layout contracts, and grid serialization.
- DuckDB integration tests execute every visible transform against an in-memory database.
- `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` are required before review.

The Operations panel starts as a labelled collapsed rail so the grid receives the maximum editor area while remaining discoverable. See `docs/QA_CHECKLIST.md` for the manual Extension Development Host checks that complement automated coverage.

## Performance evidence

Benchmarks are development tooling, not extension runtime code. The primary and scalability suites compare the production `@duckdb/node-api` path with equivalent eager dataframe operations installed in isolated `uv` script environments. Result keys and row counts must match exactly; floating-point aggregates use an explicit absolute tolerance.

The scalability runner starts a fresh process for every engine sample so peak RSS includes runtime and imported-library overhead. A failed worker records `status`, exit code or signal, and a bounded error while leaving timing and RSS null; remaining engines continue. Signals are evidence of process termination, not proof of OOM by themselves. Large 50M/100M inputs are opt-in.

See `benchmarks/README.md` for reproducibility details and caveats. Engine timings are not presented as end-to-end VS Code first-paint measurements; that requires explicit extension-host and webview instrumentation.
