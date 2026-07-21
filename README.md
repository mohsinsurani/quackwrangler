# QuackWrangler

[![Build Status](https://github.com/quackwrangler/quackwrangler/actions/workflows/ci.yml/badge.svg)](https://github.com/quackwrangler/quackwrangler/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![VS Code](https://img.shields.io/badge/VS%20Code-1.85.0%2B-blue.svg)](https://code.visualstudio.com/)
[![Version](https://img.shields.io/badge/version-0.1.0-green.svg)](https://marketplace.visualstudio.com/items?itemName=quackwrangler.quackwrangler)

> **Fast data wrangling for Parquet, CSV, and JSON files powered by DuckDB**

QuackWrangler is a VS Code extension that provides a visual interface for exploring, cleaning, and transforming tabular data files. Built on [DuckDB](https://duckdb.org/) for blazing-fast performance, it handles files of any size without loading them into memory.

## Features

- **Lightning Fast** - Query Parquet files directly without materialization
- **Visual Data Grid** - Interactive table with virtualized scrolling (100k+ rows)
- **Column Statistics** - Min/max/mean, null counts, unique values, distributions
- **One-Click Transforms** - Drop, rename, filter, sort, cast, fill missing values
- **Code Generation** - Export cleaning steps as DuckDB SQL or Python code
- **Multi-Format Support** - Parquet, CSV, TSV, JSON, JSONL files
- **Memory Efficient** - Automatic disk spilling for large datasets

## Quick Start

### Installation

```bash
code --install-extension quackwrangler.quackwrangler
```

### Usage

1. **Open a data file** - Right-click any `.parquet`, `.csv`, or `.json` file → "Open in QuackWrangler"

2. **Explore your data** - View column statistics, sort, filter, and search

3. **Apply transforms** - Use the transform panel to clean your data

4. **Export code** - Generate reproducible SQL or Python code

## Available Transforms

| Transform | Description | SQL Generated |
|-----------|-------------|---------------|
| Drop Column | Remove unwanted columns | `SELECT * EXCLUDE(col)` |
| Rename Column | Rename columns | `SELECT col AS new_name` |
| Filter Rows | Filter by conditions | `WHERE col op value` |
| Sort Rows | Sort by columns | `ORDER BY col ASC/DESC` |
| Cast Type | Change column types | `CAST(col AS type)` |
| Fill Missing | Replace null values | `COALESCE(col, value)` |
| Deduplicate | Remove duplicate rows | `SELECT DISTINCT *` |
| One-Hot Encode | Create dummy variables | `CASE WHEN col = val THEN 1 ELSE 0` |
| Normalize | Scale numeric columns | `(col - min) / (max - min)` |
| Split Column | Split by delimiter | `split_part(col, delim, idx)` |
| Merge Columns | Combine columns | `col1 || col2` |

## Configuration

Configure QuackWrangler in VS Code settings (`Cmd+,`):

```json
{
  "quackwrangler.duckdb.memoryLimit": "1GB",
  "quackwrangler.duckdb.tempDirectory": "/tmp/duckdb",
  "quackwrangler.fileViewer.parquet": true,
  "quackwrangler.fileViewer.csv": true,
  "quackwrangler.display.pageSize": 100
}
```

## Keyboard Shortcuts

| Action | macOS | Windows/Linux |
|--------|-------|---------------|
| Execute Query | `Cmd+Enter` | `Ctrl+Enter` |
| Open Data Wrangler | `Cmd+Shift+P` | `Ctrl+Shift+P` |

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    VS Code Extension                     │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ┌──────────────┐    ┌──────────────┐    ┌────────────┐ │
│  │   Commands   │    │   Webview    │    │   DuckDB   │ │
│  │   Handler    │◄──►│   Provider   │◄──►│  Engine    │ │
│  └──────────────┘    └──────────────┘    └────────────┘ │
│         │                   │                   │        │
│         ▼                   ▼                   ▼        │
│  ┌──────────────┐    ┌──────────────┐    ┌────────────┐ │
│  │   File       │    │    React     │    │  Parquet   │ │
│  │   Detector   │    │    UI Grid   │    │  Loader    │ │
│  └──────────────┘    └──────────────┘    └────────────┘ │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

## Development

### Prerequisites

- Node.js 18+
- npm 9+
- VS Code 1.85.0+

### Setup

```bash
git clone https://github.com/quackwrangler/quackwrangler.git
cd quackwrangler
npm install
cd webview-ui && npm install && cd ..
```

### Build

```bash
# Build everything
npm run build

# Watch mode
npm run watch
```

### Test

```bash
# Run tests
npm test

# Coverage
npm run test:coverage
```

### Package

```bash
npm run package
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT License - see [LICENSE](LICENSE)

## Acknowledgments

- [DuckDB](https://duckdb.org/) - The world's fastest analytical database
- [VS Code](https://code.visualstudio.com/) - The best code editor
- [Data Wrangler](https://github.com/microsoft/vscode-data-wrangler) - Microsoft's inspiring original

---

Built with quack by the QuackWrangler community
