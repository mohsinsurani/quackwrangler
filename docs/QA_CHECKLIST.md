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

- Open CSV, TSV, Parquet, JSON, JSONL/NDJSON, XLSX, ODS, and Arrow files.
- Click Parquet, CSV, and XLSX files and confirm they open directly in the QuackWrangler custom editor; confirm other formats retain their normal editor association until **Open in QuackWrangler** is selected.
- From a **No data loaded** editor, confirm the orientation text mentions visual transforms, profiles/charts, and AI planning. Use **Open File** and confirm the selected file replaces the empty state in the same tab. Use **Open Folder**, select a nested supported file, and confirm it loads in that same tab; verify cancellation and empty folders leave a clear, usable state.
- Open data from a read-only workspace and confirm DuckDB spill storage is created under VS Code extension storage rather than a relative `.tmp` directory.
- Open a folder and confirm supported files appear under their actual subfolders.
- Open an HTTPS/S3 source. Confirm staged progress is visible, reaches 100%, and a network or format failure appears as an actionable error.
- Confirm Operations starts collapsed, remains visibly labelled, and expands/collapses without covering the grid.
- Resize columns, double-click a divider to auto-fit, inspect long/nested values, and verify resizing does not sort.
- Select one and several rows; copy with and without headers in CSV and TSV formats.
- Apply every operation: filter operators, deduplicate, rename, drop, add/formula, cast, fill nulls, sort, group/aggregate, pivot, and unpivot.
- Apply a transform and confirm the success toast appears. Confirm undo and redo enable only when available; test `Cmd/Ctrl+Z`, `Cmd+Shift+Z`, and `Ctrl+Y`. Press `Enter` to submit an open operation form and `Escape` to close forms, cell inspectors, and quick-filter menus. Reorder transforms, use column quick-filter, and save/reopen a `.qw` workspace.
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
- Ensure the overview image and demo GIF show the default collapsed Operations rail, current profiles/grid, Data Quality, and Visualize UI.
- Check README links, Marketplace description, privacy statement, installation steps, changelog, and release notes.

Record any manual failure before release. A passing unit suite does not replace the Extension Development Host smoke test.
