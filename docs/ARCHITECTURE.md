# Architecture

## System Overview

QuackWrangler follows a **3-layer architecture** inspired by Data Wrangler, with clear separation between the UI, extension host, and query engines.

```
┌─────────────────────────────────────────────────────────────────┐
│                    VS Code Webview UI                           │
│                                                                 │
│  ┌──────────────┐  ┌──────────────────┐  ┌───────────────────┐ │
│  │  Operations  │  │  Perspective     │  │  Code Preview     │ │
│  │  Panel       │  │  Data Grid       │  │  (SQL/Python)     │ │
│  │              │  │                  │  │                   │ │
│  │  • Filter    │  │  • Sort/Filter   │  │  • DuckDB SQL     │ │
│  │  • Transform │  │  • Aggregate     │  │  • Polars Python  │ │
│  │  • Export    │  │  • Column Stats  │  │  • Copy/Export    │ │
│  └──────────────┘  └──────────────────┘  └───────────────────┘ │
│                                                                 │
└──────────────────────────────┬──────────────────────────────────┘
                               │ PostMessage (JSON + Arrow IPC)
┌──────────────────────────────▼──────────────────────────────────┐
│                  VS Code Extension Host                         │
│                  (TypeScript / Node.js)                         │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │  Commands    │  │  Webview     │  │  Engine Manager      │  │
│  │  Handler     │  │  Provider    │  │  (DuckDB / Polars)   │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
│                                                                 │
└──────────────────────────────┬──────────────────────────────────┘
                               │ Native IPC / Subprocess
┌──────────────────────────────▼──────────────────────────────────┐
│                    Engine / Sidecar Layer                        │
│                                                                 │
│  ┌────────────────────────┐  ┌────────────────────────────────┐ │
│  │  DuckDB Node.js API    │  │  Polars Python Sidecar         │ │
│  │  (@duckdb/node-api)    │  │  (polars-bridge.py)            │ │
│  │                        │  │                                │ │
│  │  • In-process engine   │  │  • Subprocess via spawn()      │ │
│  │  • SQL queries         │  │  • JSON stdin/stdout protocol  │ │
│  │  • Parquet/CSV/JSON    │  │  • Arrow IPC data transfer     │ │
│  │  • Automatic spilling  │  │  • Auto-detect Python env      │ │
│  └────────────────────────┘  └────────────────────────────────┘ │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Data Flow

### 1. File Opening Flow

```
User right-clicks file → File Detector → Extension detects engine availability
                                          ↓
                         ┌────────────────┴────────────────┐
                         ▼                                  ▼
                    DuckDB Engine                      Polars Sidecar
                         │                                  │
                         └────────────────┬─────────────────┘
                                          ↓
                              Schema + Preview Data
                                          ↓
                              Webview ← Perspective Grid loads Arrow data
```

### 2. Transform Flow

```
User selects operation in Left Panel
                                          ↓
                              Operations Panel → Send transform request
                                          ↓
                              Extension receives transform
                                          ↓
                         ┌────────────────┴────────────────┐
                         ▼                                  ▼
                    DuckDB SQL                         Polars Python
                         │                                  │
                         └────────────────┬─────────────────┘
                                          ↓
                              Updated Data (Arrow IPC)
                                          ↓
                              Perspective Grid updates
                              Code Preview shows generated code
```

### 3. Export Flow

```
User clicks Export → Code Preview shows full code
                         ↓
              ┌──────────┴──────────┐
              ▼                     ▼
         Copy to Clipboard    Save to File
              │                     │
              ▼                     ▼
         Jupyter Notebook     .py / .sql file
```

## Component Details

### Layer 1: Webview UI

#### Operations Panel (Left)
- **Categorized operations**: Filter, Transform, Aggregate, Export
- **Parameter forms**: Column selectors, text inputs, dropdowns
- **Active transforms**: Shown as removable chips
- **Undo/Redo**: Full history support

#### Perspective Data Grid (Center)
- **High-performance rendering**: Handles millions of rows
- **Built-in operations**: Sort, filter, group by, aggregate
- **Column statistics**: Type, null count, unique values, distributions
- **Theme support**: Auto-detects VS Code dark/light mode
- **Export**: Arrow IPC, JSON, CSV

#### Code Preview (Bottom)
- **Real-time code generation**: DuckDB SQL or Polars Python
- **Syntax highlighting**: Custom highlighter for SQL/Python
- **Tab switching**: View as SQL or Python
- **Copy to clipboard**: One-click export

### Layer 2: Extension Host

#### Engine Manager (`src/sidecar/index.ts`)
- Manages both DuckDB and Polars engines
- Unified `DataEngine` interface
- Auto-detection of available engines
- Engine switching at runtime

#### Commands (`src/commands/index.ts`)
- `quackwrangler.openFile` - Open data file
- `quackwrangler.executeQuery` - Execute SQL
- `quackwrangler.exportData` - Export results
- `quackwrangler.summarizeFile` - Column statistics

#### Transform Registry (`src/transforms/registry.ts`)
- 11 built-in transforms
- SQL generation for DuckDB
- Python generation for Polars
- Extensible via plugin system

### Layer 3: Engine / Sidecar

#### DuckDB Engine (`src/duckdb/`)
- **In-process**: Runs inside Node.js extension host
- **SQL-first**: Direct Parquet/CSV/JSON querying
- **Memory efficient**: Automatic disk spilling
- **Zero configuration**: Works out of the box

#### Polars Sidecar (`src/sidecar/`)
- **Subprocess**: Python process spawned by extension
- **JSON protocol**: stdin/stdout communication
- **Arrow IPC**: Zero-copy data transfer
- **Auto-detection**: Finds Python + polars automatically

## Message Protocol

### Extension → Webview

```typescript
// File loaded with schema and preview
{
  type: 'fileLoaded';
  schema: TableSchema;
  preview: QueryResult;
}

// Transform applied, data updated
{
  type: 'transformApplied';
  result: QueryResult;
  history: TransformOperation[];
  generatedCode: string;  // DuckDB SQL or Polars Python
}

// Engine switched
{
  type: 'engineSwitched';
  engine: 'duckdb' | 'polars';
  available: boolean;
}
```

### Webview → Extension

```typescript
// Load a data file
{
  type: 'loadFile';
  filePath: string;
  engine: 'duckdb' | 'polars';
}

// Apply transform
{
  type: 'applyTransform';
  transform: TransformOperation;
}

// Switch engine
{
  type: 'switchEngine';
  engine: 'duckdb' | 'polars';
}

// Export code
{
  type: 'exportCode';
  format: 'duckdb-sql' | 'duckdb-python' | 'polars-python';
  outputPath?: string;
}
```

## Performance Optimizations

### 1. Perspective Data Grid
- **Zero-copy Arrow IPC**: Data transferred as Arrow buffers
- **WASM rendering**: Grid runs in browser thread
- **Lazy loading**: Only visible rows rendered
- **Columnar format**: Matches Parquet/Arrow layout

### 2. DuckDB Engine
- **Predicate pushdown**: Filters pushed to storage layer
- **Column pruning**: Only reads needed columns
- **Parallel execution**: Multi-threaded query engine
- **Automatic spilling**: Handles datasets larger than RAM

### 3. Polars Sidecar
- **Arrow IPC transfer**: Zero-copy between Python and TypeScript
- **Lazy evaluation**: Polars optimizes query plans
- **SIMD operations**: Vectorized column operations
- **Memory mapping**: Large files accessed without full load

### 4. Engine Selection Guide

| Feature | DuckDB (Default) | Polars |
|---------|------------------|--------|
| Setup | Zero config | Requires Python |
| Speed | Fast (SQL) | Fast (DataFrame) |
| Memory | Efficient | Efficient |
| File support | Parquet, CSV, JSON | Parquet, CSV, JSON, Excel |
| Best for | SQL queries, analytics | Complex transformations |

## Security Considerations

- **Sandboxed webview**: No direct file system access
- **Subprocess isolation**: Polars runs in separate process
- **SQL injection prevention**: Parameterized queries
- **Input validation**: All user inputs sanitized
- **No secrets in code**: Generated code is safe to share

## Testing Strategy

### Unit Tests (45 tests)
- Transform code generation (DuckDB + Polars)
- File detection utilities
- Engine manager
- Transform registry

### Integration Tests (planned)
- DuckDB query execution
- Polars sidecar communication
- Webview ↔ Extension messaging

### E2E Tests (planned)
- Full VS Code environment
- File opening workflow
- Transform application
- Code export
