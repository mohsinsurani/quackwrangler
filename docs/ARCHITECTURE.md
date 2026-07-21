# Architecture

## System Overview

QuackWrangler follows a layered architecture with clear separation between the VS Code extension host, webview UI, and DuckDB engine.

```
┌─────────────────────────────────────────────────────────────────┐
│                        VS Code Host                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                    Extension Layer                         │ │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │ │
│  │  │ Commands │  │ Webview  │  │ File     │  │ Config   │  │ │
│  │  │ Handler  │  │ Provider │  │ Detector │  │ Manager  │  │ │
│  │  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘  │ │
│  │       │              │              │              │        │ │
│  │       └──────────────┼──────────────┼──────────────┘        │ │
│  │                      │              │                        │ │
│  └──────────────────────┼──────────────┼────────────────────────┘ │
│                         │              │                          │
│  ┌──────────────────────┼──────────────┼────────────────────────┐ │
│  │                   Engine Layer       │                        │ │
│  │  ┌──────────────────┴──────────────┐ │                        │ │
│  │  │        DuckDB Connection        │ │                        │ │
│  │  └──────────────────┬──────────────┘ │                        │ │
│  │                     │                │                        │ │
│  │  ┌──────────────────┴──────────────┐ │                        │ │
│  │  │         Query Engine            │ │                        │ │
│  │  │  ┌────────────┐ ┌────────────┐  │ │                        │ │
│  │  │  │ SQL Exec   │ │ Code Gen   │  │ │                        │ │
│  │  │  └────────────┘ └────────────┘  │ │                        │ │
│  │  └─────────────────────────────────┘ │                        │ │
│  │                                      │                        │ │
│  └──────────────────────────────────────┘                        │ │
│                                                                  │ │
└──────────────────────┬──────────────────────────────────────────┘ │
                       │ Message Passing                            │
                       │ (postMessage)                              │
┌──────────────────────┴──────────────────────────────────────────┐ │
│                      Webview Layer                               │ │
│  ┌────────────────────────────────────────────────────────────┐ │ │
│  │                      React App                             │ │ │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │ │ │
│  │  │ DataGrid │  │ Column   │  │ Transform│  │ Export   │  │ │ │
│  │  │          │  │ Stats    │  │ Panel    │  │ Panel    │  │ │ │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘  │ │ │
│  └────────────────────────────────────────────────────────────┘ │ │
└─────────────────────────────────────────────────────────────────┘ │
```

## Data Flow

### 1. File Opening Flow

```
User clicks file → File Detector → Create Webview → Send load request
                                                      ↓
Webview ← Schema/Preview ← DuckDB Query ← Query Engine
```

### 2. Transform Flow

```
User selects transform → Transform Panel → Send transform request
                                                ↓
Extension ← Transform Registry ← Execute SQL ← DuckDB
                                                ↓
Webview ← Updated Data ← Query Results ← Extension
```

### 3. Export Flow

```
User clicks export → Export Panel → Send export request
                                         ↓
Extension ← Generate SQL/Python ← Code Generator
                                         ↓
Webview ← Download/Preview ← Extension
```

## Component Details

### Extension Layer

#### Commands (`src/commands/index.ts`)
- Registers VS Code commands
- Handles user interactions
- Coordinates between components

#### Webview Provider (`src/webview/provider.ts`)
- Manages webview lifecycle
- Handles message passing
- Loads webview HTML

#### File Detector (`src/utils/fileDetector.ts`)
- Detects file types (parquet, csv, json)
- Validates data files
- Provides glob patterns

### Engine Layer

#### DuckDB Connection (`src/duckdb/connection.ts`)
- Creates/manages DuckDB instances
- Configures memory limits
- Handles connection lifecycle

#### Query Engine (`src/duckdb/query-engine.ts`)
- Executes SQL queries
- Handles pagination
- Exports results to files

#### Parquet Loader (`src/duckdb/parquet-loader.ts`)
- Loads file previews
- Gets file metadata
- Handles multiple formats

### Transform Layer

#### Transform Registry (`src/transforms/registry.ts`)
- Stores transform definitions
- Executes transforms
- Manages transform state

#### Code Generator (`src/transforms/codegen.ts`)
- Generates DuckDB SQL
- Generates Python code
- Wraps steps as views

### Webview Layer

#### React App (`webview-ui/src/App.tsx`)
- Main application component
- State management
- Message handling

#### DataGrid (`webview-ui/src/components/DataGrid.tsx`)
- Virtualized data rendering
- Column sorting
- Row selection

#### TransformPanel (`webview-ui/src/components/TransformPanel.tsx`)
- Transform selection
- Parameter input
- Preview/apply workflow

## Message Protocol

### Extension → Webview

```typescript
{
  type: 'updateSchema';
  schema: TableSchema;
}

{
  type: 'updateData';
  data: QueryResult;
}

{
  type: 'updateStats';
  stats: ColumnStats[];
}

{
  type: 'error';
  message: string;
}
```

### Webview → Extension

```typescript
{
  type: 'loadFile';
  filePath: string;
}

{
  type: 'executeQuery';
  sql: string;
}

{
  type: 'applyTransform';
  transform: TransformOperation;
}

{
  type: 'exportData';
  format: 'parquet' | 'csv' | 'json';
  outputPath: string;
}
```

## Performance Optimizations

### 1. Virtualized Rendering
- Only renders visible rows in DataGrid
- Handles 100k+ rows efficiently
- Uses @tanstack/react-virtual

### 2. Lazy Data Loading
- Fetches data on demand
- Pagination support
- Configurable page size

### 3. DuckDB Optimizations
- Predicate pushdown
- Column pruning
- Parallel execution
- Automatic disk spilling

### 4. Memory Management
- Configurable memory limits
- Streaming results
- Efficient data structures

## Security Considerations

- Webview runs in sandboxed environment
- No direct file system access from webview
- All file operations go through extension
- SQL injection prevention via parameterized queries

## Testing Strategy

### Unit Tests
- Component isolation
- Mock external dependencies
- Fast execution

### Integration Tests
- Component interaction
- Real DuckDB queries
- End-to-end workflows

### E2E Tests
- Full VS Code environment
- User interactions
- Performance benchmarks
