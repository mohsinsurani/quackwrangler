# QuackWrangler Development Guide

## Coding principles

These project rules adapt the Karpathy-inspired coding-agent guidelines: think before changing code, prefer the simplest sufficient solution, keep changes surgical, and verify the requested outcome.

- State important assumptions and resolve ambiguity from the repository before coding.
- Make the smallest coherent change that solves the reported problem.
- Do not add speculative abstractions, compatibility layers, or fallback paths.
- Preserve unrelated behavior and user changes. Do not refactor adjacent code without a task-driven reason.
- Define success in observable terms, then run the narrowest tests that prove it. Expand verification when the change affects shared boundaries.
- If evidence contradicts the planned approach, stop and reassess instead of forcing the implementation.

## Release policy

- The latest published Marketplace version is `0.1.2`.
- Current development targets `0.1.3`; do not change the manifest version, package, or publish it without explicit maintainer approval.
- Record normal work under `Unreleased`.
- Do not bump versions, create a release VSIX, tag, or publish without explicit owner confirmation.
- Development builds and tests do not authorize a release.

## Architecture

The shipped extension is TypeScript end to end: React webview → VS Code extension host → in-process DuckDB. There is no Python or Polars runtime. Read `docs/ARCHITECTURE.md` before changing runtime boundaries.

Key implementation files:

| File                                            | Purpose                                                        |
| ----------------------------------------------- | -------------------------------------------------------------- |
| `src/extension.ts`                              | Activation, editor and command registration, activity-bar tree |
| `src/commands/index.ts`                         | Sessions, messages, persistence, dialogs, exports              |
| `src/duckdb/parquet-loader.ts`                  | File readers and source loading                                |
| `src/transforms/pipeline.ts`                    | Validated transforms and analytical queries                    |
| `src/types/index.ts`                            | Extension protocol and domain types                            |
| `webview-ui/src/App.tsx`                        | Webview orchestration                                          |
| `webview-ui/src/components/OperationsPanel.tsx` | Operation forms                                                |
| `webview-ui/src/components/DataGrid.tsx`        | Virtualized data table                                         |

## Commands

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run watch
npm run test:coverage
npm run benchmark
npm run benchmark:scalability
npm run benchmark:formats
```

Run `npm run package` only when the owner explicitly requests a release candidate.

Benchmark Python packages are isolated tooling managed by `uv`; they are not extension dependencies. Keep 50M/100M runs opt-in, preserve the default result artifact with `QW_SCALABILITY_OUTPUT`, and record worker failures without inferring OOM from a signal alone.

## Engineering rules

- Keep TypeScript strict and avoid `any`.
- Prefer one source of truth for supported formats and shared option sets.
- Route every visual transform through `WranglingSession`; do not execute separate UI-only SQL.
- Quote identifiers and literals and allow-list SQL keywords derived from UI input.
- Keep webview messages bounded; never send a complete large dataset.
- Preserve virtualized rendering and the shared profile/header/row grid tracks.
- Remove unused APIs instead of retaining speculative scaffolding.
- Add unit and in-memory DuckDB integration tests for every visible operation.
- Update README, architecture, changelog, and contribution guidance with behavior changes.
- Refresh README visuals from the standalone Vite preview after visible UI changes; do not use an imagined mockup.

## Adding a transform

1. Implement and validate its SQL in `operationSql` in `src/transforms/pipeline.ts`.
2. Add the form definition in `webview-ui/src/components/OperationsPanel.tsx`.
3. Add generation, validation, execution, and UI contract tests.

## Adding a file format

1. Add it to `DATA_FILE_EXTENSIONS` in `src/utils/fileDetector.ts`.
2. Add its reader in `src/duckdb/parquet-loader.ts`.
3. Update the declarative file selectors and activation events in `package.json`.
4. Add file-detection and loader tests and update the supported-formats documentation.

## Working tree

User changes may already be present. Preserve unrelated edits, do not reset the tree, and do not delete ignored local artifacts unless explicitly requested.
