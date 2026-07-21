# QuackWrangler - Development Guide

## Project Structure

```
quackwrangler/
├── src/                          # Extension source code
│   ├── extension.ts              # Entry point (activate/deactivate)
│   ├── types/                    # Shared TypeScript types
│   │   └── index.ts
│   ├── duckdb/                   # DuckDB integration
│   │   ├── connection.ts         # Connection manager
│   │   ├── parquet-loader.ts     # File loading utilities
│   │   └── query-engine.ts       # Query execution engine
│   ├── transforms/               # Data transformations
│   │   ├── registry.ts           # Transform registry
│   │   └── codegen.ts            # Code generation
│   ├── webview/                  # VS Code webview
│   │   └── provider.ts          # Webview provider
│   ├── commands/                 # Command handlers
│   │   └── index.ts
│   └── utils/                    # Utility functions
│       └── fileDetector.ts
├── webview-ui/                   # React webview UI
│   ├── src/
│   │   ├── App.tsx              # Main React component
│   │   ├── components/          # UI components
│   │   ├── hooks/               # Custom React hooks
│   │   └── styles/              # CSS styles
│   ├── package.json
│   └── vite.config.ts
├── tests/                        # Test files
│   ├── unit/                     # Unit tests
│   ├── integration/              # Integration tests
│   └── fixtures/                 # Test data
├── docs/                         # Documentation
│   └── ARCHITECTURE.md
├── .github/                      # GitHub configuration
│   ├── workflows/ci.yml
│   └── ISSUE_TEMPLATE/
├── package.json                  # Extension manifest
├── tsconfig.json                 # TypeScript config
├── esbuild.js                    # Build script
├── vitest.config.ts              # Test config
├── AGENTS.md                     # This file
├── README.md                     # User documentation
├── CONTRIBUTING.md               # Contributing guidelines
└── CHANGELOG.md                  # Version history
```

## Build Commands

```bash
# Full build (extension + webview)
npm run build

# Watch mode for development
npm run watch

# Build webview only
npm run build:webview

# Build extension only
npm run compile

# Package extension for distribution
npm run package
```

## Testing Commands

```bash
# Run all tests
npm test

# Watch mode
npm run test:watch

# Coverage report
npm run test:coverage
```

## Code Style

- **TypeScript**: Strict mode enabled
- **Formatting**: Prettier with single quotes, trailing commas
- **Linting**: ESLint with TypeScript plugin
- **Imports**: Organized by groups (builtin, external, internal)

## Architecture Decisions

### Why DuckDB?

- Fastest Parquet loading (9.8ms vs Polars 63ms for 10M rows)
- Direct file querying without materialization
- Built-in SQL support for analytical queries
- Memory-efficient with automatic disk spilling
- Can combine with Polars via Arrow interop

### Message Passing Pattern

Extension ↔ Webview communication uses VS Code's message passing:

```typescript
// Extension → Webview
panel.webview.postMessage({ type: 'updateData', data: result });

// Webview → Extension
vscode.postMessage({ type: 'executeQuery', sql: 'SELECT * FROM ...' });
```

### Transform Pipeline

1. User selects operation in UI
2. UI sends transform request to extension
3. Extension executes DuckDB SQL
4. Results sent back to webview
5. Code generation produces exportable SQL/Python

## Adding New Transforms

1. Open `src/transforms/registry.ts`
2. Add to the `builtInTransforms` array:

```typescript
{
  id: 'myTransform',
  name: 'My Transform',
  description: 'Does something useful',
  params: [
    { name: 'column', type: 'string', required: true },
    { name: 'value', type: 'string', required: false },
  ],
  generateSQL: (params) => `SELECT ... FROM ...`,
}
```

3. Add UI in `webview-ui/src/components/TransformPanel.tsx`

## Adding New File Formats

1. Open `src/utils/fileDetector.ts`
2. Add extension to `DATA_FILE_EXTENSIONS`
3. Add handler in `src/duckdb/parquet-loader.ts`
4. Update `package.json` activation events

## Performance Considerations

- **Virtualized Grid**: Only renders visible rows (100k+ support)
- **Lazy Loading**: Fetches data on demand
- **Streaming**: DuckDB streams results to webview
- **Memory Limits**: Configurable DuckDB memory limit

## Key Files

| File | Purpose |
|------|---------|
| `src/extension.ts` | Entry point, command registration |
| `src/duckdb/connection.ts` | DuckDB lifecycle management |
| `src/duckdb/query-engine.ts` | SQL execution and pagination |
| `src/transforms/registry.ts` | Transform definitions |
| `src/transforms/codegen.ts` | SQL/Python code generation |
| `webview-ui/src/App.tsx` | Main React component |
| `webview-ui/src/components/DataGrid.tsx` | Virtualized data grid |
| `webview-ui/src/components/TransformPanel.tsx` | Transform UI |
