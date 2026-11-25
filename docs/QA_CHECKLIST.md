# Release QA checklist

Use this checklist before creating a Marketplace version. Automated checks are the baseline; the Extension Development Host checks cover VS Code APIs and webview behavior that unit tests cannot faithfully reproduce.

## Automated release gate

```bash
npm run lint
npm run test:coverage
npm run test:vscode
npm run build:production
npx vsce ls --tree
npm audit --omit=dev
```

Confirm that `package.json` and `package-lock.json` remain on the currently published version until the maintainer approves a release. Confirm that generated benchmark datasets, source files, tests, coverage output, and local environments are absent from `vsce ls`.

## Extension-host smoke test

Run **Run QuackWrangler Extension** from the repository's Run and Debug view, then check:

- Open CSV, TSV, Parquet, JSON, JSONL/NDJSON, XLSX, legacy XLS, ODS, all Arrow IPC suffixes (`.arrow`, `.arrows`, `.ipc`), and ORC files.
- Open a DuckDB file and a SQLite file. Confirm the header lists their tables, views, and extra schemas, and that switching tables loads each one. Apply a step, switch tables, and confirm the warning names the number of steps and cancelling keeps the current table. Save a `.qw` recipe, reopen it, and confirm the same table loads. Confirm Refresh keeps the chosen table, exports and the recipe file are named after the table, and a `.db` file that is neither format shows a clear error.
- Open a large database table lazily, then confirm another program can read the file but a DuckDB file cannot be written until the tab closes; open a small table and confirm the file is writable by another program. In SQLite, put text into a numeric column and confirm the table opens with every column as text and an "all text" badge.
- Click each supported file extension and confirm it opens directly in the QuackWrangler custom editor; confirm explicit user editor associations can still override the default.
- From a **No data loaded** editor, confirm the orientation text mentions visual transforms, profiles/charts, and AI planning. Use **Open File** and confirm the selected file replaces the empty state in the same tab. Use **Open Folder**, select a nested supported file, and confirm it loads in that same tab; verify cancellation and empty folders leave a clear, usable state.
- Open data from a read-only workspace and confirm DuckDB spill storage is created under VS Code extension storage rather than a relative `.tmp` directory.
- Open a folder and confirm supported files appear under their actual subfolders.
- Open an HTTPS/S3 source. Confirm staged progress is visible, reaches 100%, and a network or format failure appears as an actionable error.
- Confirm Operations starts collapsed. At desktop width verify it opens beside the usable grid; at 640 px and narrower verify it opens as a dismissible slide-over drawer while rows remain visible. Confirm Escape/backdrop/collapse dismissal, and that Export and Recipe menus remain usable.
- Check Quality, Charts, and SQL analysis tabs, including empty states and repeated tab toggling. Search operation names and confirm matching categories expand without changing transform behavior.
- Verify compact profile type/missing/distinct summaries, numeric range markers where available, hover-only nested-cell detail badges, numeric alignment, and that the Copy selected button only appears once rows are selected. Inspect the View menu and selected-row copy action.
- Resize columns, double-click a divider to auto-fit, inspect long/nested values, and verify resizing does not sort.
- Select one and several rows; copy with and without headers in CSV and TSV formats.
- Apply every operation: filter operators, deduplicate, rename, drop, add/formula, cast, fill nulls, sort, group/aggregate, pivot, and unpivot.
- Apply a transform and confirm the success toast appears. Confirm undo and redo enable only when available; test `Cmd/Ctrl+Z`, `Cmd+Shift+Z`, and `Ctrl+Y`. Press `Enter` to submit an open operation form and `Escape` to close forms, cell inspectors, and quick-filter menus. Reorder transforms, use column quick-filter, and save/reopen a `.qw` workspace.
- Open a file with nulls. Inspect a null finding and confirm the view is scoped to matching rows without adding a transform; clear inspection and confirm the full current result returns. Fill a value and confirm the impact text, apply, and undo. Use Export and confirm its count labels the full current result rather than only visible rows.
- Save a `.qw` recipe and replay it on another open file. Verify unsupported or incompatible steps report a recoverable error. Export a supported recipe to Python and verify unsupported reader types/operations are refused; use Continue in Polars and confirm it exports the active full result to Parquet.
- Replay a recipe on a file where a referenced column was renamed. Confirm the picker names the step and shows available column types, then select a replacement and verify the result. Repeat and cancel the picker; confirm the grid, active SQL result, and history do not change.
- Replay a recipe that refers to a column created by a preceding Formula Builder step. Confirm the remapper uses the staged schema, and cancel a later-step picker to verify no partial steps are committed.
- Force a recipe replay, transform, undo, and redo query failure. Confirm each failed operation leaves the previous rows, step history, and export scope unchanged. Test fills for text with leading zeros, numeric and decimal columns, booleans, dates, invalid input, and all-null columns.
- Run read-only custom SQL and confirm write/DDL statements are rejected.
- Open Data Quality and Visualize; check charts, scrolling, empty/error states, and expand/collapse behavior.
- Join two files and union compatible files.
- Export CSV, JSON, and Parquet and reopen each exported file.
- Check recent files, dark/high-contrast/light themes, keyboard actions, and narrow/wide editor layouts.
- Confirm the header shows the labelled **AI plan** action without a redundant engine selector. If AI assistance is configured, verify provider/model validation and confirm that only schema, current transform history, and the user's prompt are sent—never row data.
- In a fixture with `dbt_project.yml`, confirm **Copy as dbt SQL** appears and both model/CTE outputs reference the requested upstream model. Confirm the action stays hidden outside a dbt project. Open a second data file; confirm the toolbar and command correctly target the active editor. Switch tabs and verify context updates. Close one panel and verify context reflects the remaining panel. Confirm that **Copy as dbt SQL** is unavailable when the active pipeline contains a join or union step.

## Documentation and media

- Compare README capabilities against the command palette and operation panel.
- Capture the current UI at 1280×720 using the fixture in `webview-ui/src/main.tsx`.
- Ensure the overview image and demo GIF show the current compact toolbar, Quality / Charts / SQL tabs, column profiles with histograms, the one-row footer, and the nested-value inspector.
- Check README links, Marketplace description, privacy statement, installation steps, changelog, and release notes.

Record any manual failure before release. A passing unit suite does not replace the Extension Development Host smoke test.

## Automated UI check in real VS Code

Run `npm run test:ui` before a release. It launches VS Code unattended (no file pickers or prompts), opens each fixture itself, and exercises the editor in the Dark, Light, High Contrast and High Contrast Light themes plus a 700 px and a 700×560 window. It covers paging, sorting, opening DuckDB and SQLite files (including a `.db` detected from its header and a `.db` that is not a database), switching tables from the header, the Export and Recipe menus, search, the Tools drawer (apply, undo, redo, remove), Quality, Charts, SQL (including a rejected write), selection and copy, TSV/JSON/XLSX loading, the nested-value tree, the join form, dbt command visibility, overflow, and text contrast.

It needs a built extension and a local VS Code (`QW_VSCODE_PATH` overrides the location).

`npm run test:ui:linux` runs the same suite on Linux inside Docker (desktop VS Code under a virtual display, with Linux-native dependencies installed in the container). It runs arm64 by default; set `QW_UI_PLATFORM=linux/amd64` for x64, which runs under emulation and is much slower, so pass a single theme, for example `QW_UI_PLATFORM=linux/amd64 npm run test:ui:linux -- "Default Dark Modern"`.

The `UI tests (real VS Code)` workflow runs the suite on Windows x64, Windows ARM64, Linux x64 and macOS arm64 runners for pull requests that touch the webview or the suite, and on demand. It covers all four themes, a 700 px window and a 700×560 window. Locally, Linux arm64 and x64 were also verified through Docker. The AI plan flow and remote HTTPS/S3 sources are not covered and remain manual. Plain HTTP loading through DuckDB's `httpfs` was checked once against a local server; HTTPS certificates and S3 credentials were not.
