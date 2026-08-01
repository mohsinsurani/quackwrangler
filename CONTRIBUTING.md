# Contributing to QuackWrangler

QuackWrangler welcomes bug fixes, documentation improvements, tests, and focused features.

## Requirements

- Node.js 18 or newer
- npm 9 or newer
- VS Code 1.85 or newer
- Git

Python, Jupyter, Polars, and Pandas are not extension runtime dependencies. Optional comparative benchmarks require `uv`, which creates isolated script environments from inline dependency metadata.

## Setup

```bash
git clone https://github.com/mohsinsurani/quackwrangler.git
cd quackwrangler
npm ci
npm --prefix webview-ui ci
npm run build
```

Open the repository in VS Code, select **Run QuackWrangler Extension** in Run and Debug, and press `F5`. Test inside the Extension Development Host window.

## Workflow

1. Create a focused branch.
2. Make the smallest coherent change.
3. Add tests that fail without the change.
4. Update user and architecture documentation when behavior changes.
5. Run the complete local gate:

   ```bash
   npm run typecheck
   npm run lint
   npm test
   npm run build
   git diff --check
   ```

   When changing execution, file loading, or benchmark code, also run the relevant reproducible suite:

   ```bash
   npm run benchmark
   npm run benchmark:scalability
   npm run benchmark:formats
   ```

6. Open a pull request explaining the user impact, design, verification, and screenshots for visible UI changes.

## Code standards

- Use strict TypeScript, explicit domain types, and no unexplained `any`.
- Follow Prettier and ESLint import ordering.
- Reuse supported-file, message, and transform definitions instead of duplicating constants.
- Treat webview input as untrusted: validate parameters, quote identifiers/literals, and allow-list SQL keywords.
- Keep large data in DuckDB. Send only bounded pages and chart/profile results to the webview.
- Keep UI shortcuts and forms on the same `WranglingSession` transform path.
- Preserve accessibility labels, keyboard focus, VS Code theme variables, and virtualized table behavior.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for current runtime boundaries and extension points.

## Tests

- Unit tests belong under `tests/unit`.
- SQL transforms need in-memory execution coverage under `tests/integration`.
- UI interaction contracts currently use source-level tests under `tests/unit/webview`; add behavioral component tests when a DOM test environment is introduced.
- Keep fixtures small and free of private data.
- Preserve successful benchmark artifacts and their generation dates. Never rewrite a failed or exploratory result as an OOM without supporting evidence.

## Releases

Version numbers, VSIX files, Git tags, and Marketplace publishing are maintainer-controlled. Put changes under `Unreleased`; do not bump or package a release in a normal pull request.

## Issues and community

Use [GitHub Discussions](https://github.com/mohsinsurani/quackwrangler/discussions) for questions and early ideas. Use issues for reproducible bugs and scoped work.

Helpful labels include `good first issue`, `help wanted`, `area: ui`, `area: duckdb`, `area: file-formats`, and `documentation`.

Be respectful, provide reproducible evidence, and avoid sharing confidential datasets in issues or fixtures.
