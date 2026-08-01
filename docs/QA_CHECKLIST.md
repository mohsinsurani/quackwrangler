# Release QA checklist

Use this checklist before creating a Marketplace version. Automated checks are the baseline; the Extension Development Host checks cover VS Code APIs and webview behavior that unit tests cannot faithfully reproduce.

## Automated release gate

```bash
npm run lint
npm run test:coverage
npm run build:production
npx vsce ls --tree
npm audit --omit=dev
```

Confirm that `package.json` and `package-lock.json` remain on the currently published version until the maintainer approves a release. Confirm that generated benchmark datasets, source files, tests, coverage output, and local environments are absent from `vsce ls`.

## Extension-host smoke test

Run **Run QuackWrangler Extension** from the repository's Run and Debug view, then check:

- Open CSV, TSV, Parquet, JSON, JSONL/NDJSON, XLSX, ODS, and Arrow files.
- Open a folder and confirm supported files appear under their actual subfolders.
- Open an HTTPS/S3 source. Confirm staged progress is visible, reaches 100%, and a network or format failure appears as an actionable error.
- Confirm Operations starts collapsed, remains visibly labelled, and expands/collapses without covering the grid.
- Resize columns, double-click a divider to auto-fit, inspect long/nested values, and verify resizing does not sort.
- Select one and several rows; copy with and without headers in CSV and TSV formats.
- Apply every operation: filter operators, deduplicate, rename, drop, add/formula, cast, fill nulls, sort, group/aggregate, pivot, and unpivot.
- Undo, redo, reorder transforms, use column quick-filter, and save/reopen a `.qw` workspace.
- Run read-only custom SQL and confirm write/DDL statements are rejected.
- Open Data Quality and Visualize; check charts, scrolling, empty/error states, and expand/collapse behavior.
- Join two files and union compatible files.
- Export CSV, JSON, and Parquet and reopen each exported file.
- Check recent files, dark/high-contrast/light themes, keyboard actions, and narrow/wide editor layouts.
- If AI assistance is configured, verify provider/model validation and confirm that only schema plus the user's prompt are sent—never row data.

## Documentation and media

- Compare README capabilities against the command palette and operation panel.
- Capture the current UI at 1280×720 using the fixture in `webview-ui/src/main.tsx`.
- Ensure the overview image and demo GIF show the default collapsed Operations rail, current profiles/grid, Data Quality, and Visualize UI.
- Check README links, Marketplace description, privacy statement, installation steps, changelog, and release notes.

Record any manual failure before release. A passing unit suite does not replace the Extension Development Host smoke test.
