# QuackWrangler

[![CI](https://github.com/mohsinsurani/quackwrangler/actions/workflows/ci.yml/badge.svg)](https://github.com/mohsinsurani/quackwrangler/actions/workflows/ci.yml)
[![MIT License](https://img.shields.io/badge/license-MIT-yellow.svg)](LICENSE)
[![VS Code 1.85+](https://img.shields.io/badge/VS%20Code-1.85%2B-blue.svg)](https://code.visualstudio.com/)

Fast, visual data exploration and transformation inside VS Code, powered by DuckDB. QuackWrangler opens data files directly, profiles their columns, applies reproducible transformations, runs custom SQL, and exports the result without requiring Python, Polars, or Jupyter.

> QuackWrangler is an independent open-source project inspired by the visual workflow of data-wrangling tools. It is not affiliated with or endorsed by Microsoft.

## What works in Version 1

- DuckDB-native execution with automatic disk spilling
- Virtualized grid with synchronized headers and consistent column sizing
- Column profiles: type, valid/null/unique counts, ranges, and distributions
- Nested JSON inspection for structs, lists, maps, and JSON values
- Parquet, CSV, TSV, JSON, JSONL/NDJSON, XLSX, and ODS viewing
- Filters, sorting, deduplication, column rename/drop/add/cast, null filling, and grouping/aggregation
- Custom read-only DuckDB SQL with results shown in the grid
- Full transformed-data export to Parquet, CSV, or JSON
- Reproducible DuckDB SQL and optional Polars Python code generation
- Undo and redo for the transformation pipeline

Polars execution is intentionally deferred to Version 2. The generated Polars tab is code output only and does not add a Python runtime dependency to the extension.

## Install

### From the VS Code Marketplace

After the first public release, open Extensions in VS Code, search for **QuackWrangler**, and select **Install**. The command-line equivalent is:

```bash
code --install-extension quackwrangler.quackwrangler
```

### From a local VSIX

```bash
git clone https://github.com/mohsinsurani/quackwrangler.git
cd quackwrangler
npm ci
npm --prefix webview-ui ci
npm run package
code --install-extension quackwrangler-0.1.0.vsix
```

Alternatively, run **Extensions: Install from VSIX...** from the VS Code Command Palette and select the generated file.

## Use QuackWrangler

1. Open a folder containing a supported data file.
2. Right-click the file in Explorer and choose **Open in QuackWrangler**.
3. Inspect column profiles and values in the synchronized data grid.
4. Select an operation in the left panel, enter its parameters, and apply it.
5. Use **Custom Query** to run a read-only `SELECT`, `WITH`, `DESCRIBE`, `SHOW`, `EXPLAIN`, or `PRAGMA` statement.
6. Export the complete transformed dataset or copy the generated SQL.

Custom queries run against `current_data`:

```sql
SELECT country, COUNT(*) AS matches
FROM current_data
WHERE year >= 2000
GROUP BY country
ORDER BY matches DESC;
```

Mutation statements are rejected because the query box is an exploration surface, not an unrestricted database console.

## Filters and transforms

Filters support equality and inequality, `>`, `>=`, `<`, `<=`, contains, does not contain, starts with, ends with, `IN`, `NOT IN`, null checks, and range checks. Values are safely converted for numeric, boolean, date/time, and text columns.

Other operations include:

| Category | Operations |
| --- | --- |
| Clean | Remove duplicates, fill nulls, cast type |
| Columns | Add, rename, and drop columns |
| Arrange | Sort ascending or descending |
| Summarize | Group and aggregate with compatible functions |
| Export | Parquet, CSV, and JSON |

QuackWrangler only offers numeric aggregations such as average for compatible scalar columns. Nested JSON values remain inspectable without being sent to invalid DuckDB aggregate functions.

## Supported file formats

| Format | Extensions | Notes |
| --- | --- | --- |
| Parquet | `.parquet` | Native DuckDB reader |
| Delimited text | `.csv`, `.tsv` | Automatic schema and delimiter detection |
| JSON | `.json`, `.jsonl`, `.ndjson` | Arrays, records, and nested values supported |
| Excel | `.xlsx` | Uses DuckDB's spreadsheet support |
| OpenDocument | `.ods` | Uses DuckDB's spreadsheet support |

Spreadsheet support can require DuckDB to download an extension the first time it is used. Legacy `.xls` files are not currently supported.

## Settings

Open VS Code Settings and search for `QuackWrangler`, or configure values directly:

```json
{
  "quackwrangler.duckdb.memoryLimit": "1GB",
  "quackwrangler.duckdb.tempDirectory": "",
  "quackwrangler.duckdb.maxTempDirectorySize": "15GB",
  "quackwrangler.display.pageSize": 100,
  "quackwrangler.display.maxRows": 10000
}
```

## Develop locally

Requirements: Node.js 18 or newer, npm 9 or newer, and VS Code 1.85 or newer.

```bash
git clone https://github.com/mohsinsurani/quackwrangler.git
cd quackwrangler
npm ci
npm --prefix webview-ui ci
code .
```

In VS Code, open **Run and Debug**, select **Run QuackWrangler Extension**, and press `F5`. A new **Extension Development Host** window opens. Open a folder with data in that window and use **Open in QuackWrangler** from the file context menu.

Useful commands:

```bash
npm run build          # type-check and build the extension and webview
npm test               # unit and integration tests
npm run test:coverage  # coverage report
npm run lint           # static checks
npm run watch          # rebuild the extension while developing
npm run package        # production build and VSIX package
```

Python is optional and only needed when contributing to the planned sidecar. Its reproducible environment is recorded in `pyproject.toml` and `uv.lock`:

```bash
uv sync --frozen --extra arrow --extra dev
```

## Publish on the VS Code Marketplace

The VS Code Marketplace hosts and distributes the extension; GitHub hosts its source code and releases.

1. Create a Marketplace publisher at the [Visual Studio Marketplace publisher portal](https://marketplace.visualstudio.com/manage/publishers/).
2. Ensure the publisher ID exactly matches `publisher` in `package.json`. This repository currently uses `quackwrangler`; change it before the first release if that ID is unavailable.
3. Create an Azure DevOps personal access token with the Marketplace **Manage** scope. Never commit the token.
4. Authenticate, validate, and package:

   ```bash
   npx vsce login quackwrangler
   npm test
   npm run build
   npm run package
   ```

5. Install and smoke-test the resulting VSIX locally.
6. Increment the semantic version, then publish:

   ```bash
   npm version patch
   npm run publish:marketplace
   ```

You can also upload the VSIX manually from the publisher portal. See the official [Publishing Extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension) and [Install from VSIX](https://code.visualstudio.com/docs/configure/extensions/extension-marketplace#_install-from-a-vsix) documentation.

For automated releases, store the token as a protected GitHub Actions secret such as `VSCE_PAT`; do not put it in source, workflow text, or documentation examples.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Bug reports and pull requests are welcome at [github.com/mohsinsurani/quackwrangler](https://github.com/mohsinsurani/quackwrangler).

## License

Copyright (c) 2026 QuackWrangler Contributors. Released under the [MIT License](LICENSE), which permits private and commercial use, modification, distribution, and sublicensing subject to preserving the license notice.
