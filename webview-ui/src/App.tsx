import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { DataGrid } from './components/DataGrid';
import { OperationsPanel } from './components/OperationsPanel';
import { CodePreview } from './components/CodePreview';
import { Header } from './components/Header';
import { useVSCodeAPI } from './hooks/useVSCodeAPI';
import { EngineType, ColumnInfo, TransformOperation } from './types';
import './styles/theme.css';

interface FileData {
  columns: ColumnInfo[];
  rows: any[][];
  rowCount: number;
  filePath: string;
}

export const App: React.FC = () => {
  const { postMessage, onMessage } = useVSCodeAPI();
  const [fileData, setFileData] = useState<FileData | null>(null);
  const [engine, setEngine] = useState<EngineType>('duckdb');
  const [transforms, setTransforms] = useState<TransformOperation[]>([]);
  const [sortBy, setSortBy] = useState<string | undefined>();
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [layout, setLayout] = useState({ operationsWidth: 280, codeHeight: 200 });

  useEffect(() => {
    const unsubscribe = onMessage((message: any) => {
      switch (message.type) {
        case 'fileLoaded':
          setFileData({
            columns: message.schema.columns,
            rows: message.preview.rows,
            rowCount: message.schema.rowCount,
            filePath: message.schema.filePath,
          });
          setLoading(false);
          break;
        case 'transformApplied':
          setFileData((prev) =>
            prev
              ? {
                  ...prev,
                  rows: message.result.rows,
                  rowCount: message.result.rowCount,
                }
              : null,
          );
          setTransforms(message.history);
          setLoading(false);
          break;
        case 'engineSwitched':
          setEngine(message.engine);
          setLoading(false);
          break;
        case 'error':
          setError(message.message);
          setLoading(false);
          break;
      }
    });
    return unsubscribe;
  }, [onMessage]);

  const handleOpenFile = useCallback(
    (filePath: string) => {
      setLoading(true);
      setError(null);
      postMessage({ type: 'loadFile', filePath, engine });
    },
    [postMessage, engine],
  );

  const handleSort = useCallback(
    (column: string) => {
      if (sortBy === column) {
        setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortBy(column);
        setSortDirection('asc');
      }
    },
    [sortBy],
  );

  const handleApplyTransform = useCallback(
    (transform: TransformOperation) => {
      setLoading(true);
      postMessage({ type: 'applyTransform', transform });
    },
    [postMessage],
  );

  const handleUndo = useCallback(() => {
    postMessage({ type: 'undo' });
  }, [postMessage]);

  const handleRedo = useCallback(() => {
    postMessage({ type: 'redo' });
  }, [postMessage]);

  const handleReset = useCallback(() => {
    setTransforms([]);
    postMessage({ type: 'reset' });
  }, [postMessage]);

  const handleExportCode = useCallback(
    (format: 'duckdb-sql' | 'duckdb-python' | 'polars-python') => {
      postMessage({ type: 'exportCode', format });
    },
    [postMessage],
  );

  const handleEngineChange = useCallback(
    (newEngine: EngineType) => {
      setLoading(true);
      postMessage({ type: 'switchEngine', engine: newEngine });
    },
    [postMessage],
  );

  const generatedCode = useMemo(() => {
    if (engine === 'duckdb') {
      return generateDuckDBSQL(transforms);
    } else {
      return generatePolarsPython(transforms);
    }
  }, [engine, transforms]);

  return (
    <div className="app">
      <Header
        engine={engine}
        onEngineChange={handleEngineChange}
        filePath={fileData?.filePath}
        rowCount={fileData?.rowCount}
        loading={loading}
      />

      {error && <div className="error-banner">{error}</div>}

      <div className="app-layout">
        <div
          className="operations-pane"
          style={{ width: layout.operationsWidth }}
        >
          <OperationsPanel
            columns={fileData?.columns || []}
            onApplyTransform={handleApplyTransform}
            onUndo={handleUndo}
            onRedo={handleRedo}
            onReset={handleReset}
            transformHistory={transforms}
          />
        </div>

        <div className="grid-pane">
          {fileData ? (
            <DataGrid
              columns={fileData.columns}
              rows={fileData.rows}
              sortBy={sortBy}
              sortDirection={sortDirection}
              onSort={handleSort}
              selectedRows={selectedRows}
              onRowSelect={(row) => {
                setSelectedRows((prev) => {
                  const next = new Set(prev);
                  if (next.has(row)) {
                    next.delete(row);
                  } else {
                    next.add(row);
                  }
                  return next;
                });
              }}
            />
          ) : (
            <div className="empty-state">
              <div className="empty-icon">📊</div>
              <h2>No data loaded</h2>
              <p>Open a Parquet, CSV, or JSON file to get started</p>
              <button
                className="primary-button"
                onClick={() => {
                  postMessage({ type: 'openFilePicker' });
                }}
              >
                Open File
              </button>
            </div>
          )}
        </div>

        <div
          className="code-pane"
          style={{ height: layout.codeHeight }}
        >
          <CodePreview
            code={generatedCode}
            engine={engine}
            onExport={handleExportCode}
          />
        </div>
      </div>
    </div>
  );
};

function generateDuckDBSQL(transforms: TransformOperation[]): string {
  if (transforms.length === 0) return '-- No transforms applied yet';
  const lines = ['-- Generated by QuackWrangler', '-- Engine: DuckDB', ''];
  transforms.forEach((step, i) => {
    lines.push(`-- Step ${i + 1}: ${step.description}`);
    lines.push(step.sql);
    lines.push('');
  });
  return lines.join('\n');
}

function generatePolarsPython(transforms: TransformOperation[]): string {
  if (transforms.length === 0) return '# No transforms applied yet';
  const lines = ['# Generated by QuackWrangler', '# Engine: Polars', '', 'import polars as pl', ''];
  transforms.forEach((step, i) => {
    lines.push(`# Step ${i + 1}: ${step.description}`);
    lines.push(`# ${step.sql}`);
    lines.push('');
  });
  return lines.join('\n');
}

export default App;
