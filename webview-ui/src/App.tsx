import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CodePreview } from './components/CodePreview';
import { ColumnProfiles, type ColumnProfile } from './components/ColumnProfiles';
import { DataGrid } from './components/DataGrid';
import { Header } from './components/Header';
import { OperationsPanel } from './components/OperationsPanel';
import { QueryConsole } from './components/QueryConsole';
import { useVSCodeAPI } from './hooks/useVSCodeAPI';
import type { ColumnInfo, TransformStep } from './types';
import './styles/theme.css';

interface PageState { offset: number; limit: number; totalRows: number }
interface SessionMessage {
  protocolVersion: number;
  schema: { columns: Array<{ name: string; type: string; nullable: boolean }>; rowCount: number; filePath: string };
  result: { rows: unknown[][] };
  history: Array<{ id: string; type: string; params: Record<string, unknown>; description: string }>;
  engine: 'duckdb';
  page: PageState;
  code: { sql: string; duckdbPython: string; polarsPython: string };
}

const emptyCode = { sql: '-- Open a file to begin', duckdbPython: '', polarsPython: '' };
const WEBVIEW_PROTOCOL_VERSION = 2;

export const App: React.FC = () => {
  const { postMessage, onMessage } = useVSCodeAPI();
  const [filePath, setFilePath] = useState('');
  const [columns, setColumns] = useState<ColumnInfo[]>([]);
  const [rows, setRows] = useState<unknown[][]>([]);
  const [steps, setSteps] = useState<TransformStep[]>([]);
  const [page, setPage] = useState<PageState>({ offset: 0, limit: 100, totalRows: 0 });
  const [code, setCode] = useState(emptyCode);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<string>();
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [stats, setStats] = useState<ColumnProfile[]>([]);
  const [customQueryActive, setCustomQueryActive] = useState(false);

  useEffect(() => {
    const unsubscribe = onMessage((message: any) => {
      if (message.type === 'sessionUpdated') {
      const update = message as SessionMessage & { type: string };
      if (update.protocolVersion !== WEBVIEW_PROTOCOL_VERSION) {
        setLoading(false);
        setError('QuackWrangler was rebuilt, but this Extension Development Host is still running an older process. Close the Development Host, stop debugging with Shift+F5, and start it again with F5.');
        return;
      }
      setFilePath(update.schema.filePath);
      setColumns(update.schema.columns.map(column => ({
        name: column.name,
        displayName: column.name,
        dataType: 'string',
        type: column.type,
        nullable: column.nullable,
        nullCount: 0,
        uniqueCount: 0,
        totalRows: update.schema.rowCount,
      })) as ColumnInfo[]);
      setRows(update.result.rows);
      setSteps(update.history.map(item => ({
        id: item.id,
        name: item.type,
        description: item.description,
        params: item.params,
        timestamp: 0,
      })));
      setPage(update.page);
      setCode(update.code);
      setStats([]);
      setLoading(false);
      setError(null);
      postMessage({ type: 'getStats' });
      setCustomQueryActive(false);
      } else if (message.type === 'customQueryResult') {
      setColumns(message.schema.columns.map((column: { name: string; type: string; nullable: boolean }) => ({
        name: column.name, displayName: column.name, dataType: 'string', type: column.type,
        nullable: column.nullable, nullCount: 0, uniqueCount: 0, totalRows: message.page.totalRows,
      })) as ColumnInfo[]);
      setRows(message.result.rows);
      setPage(message.page);
      setStats([]);
      setCustomQueryActive(true);
      setLoading(false);
      setError(null);
      } else if (message.type === 'stats') {
      setStats(message.stats);
      setLoading(false);
      } else if (message.type === 'exportComplete') {
      setLoading(false);
      setError(null);
      } else if (message.type === 'error') {
      setError(message.message);
      setLoading(false);
      }
    });
    postMessage({ type: 'ready' });
    return unsubscribe;
  }, [onMessage, postMessage]);

  const transform = useCallback((type: string, params: Record<string, unknown>) => {
    setLoading(true);
    postMessage({ type: 'applyTransform', transform: { id: '', type, params, sql: '', description: '' } });
  }, [postMessage]);

  const changePage = useCallback((offset: number) => {
    setLoading(true);
    postMessage({ type: 'pageChange', offset: Math.max(0, offset), limit: page.limit });
  }, [page.limit, postMessage]);

  const fileName = useMemo(() => filePath.split(/[\\/]/).pop() ?? '', [filePath]);

  return (
    <div className="app">
      <Header
        fileName={fileName}
        rowCount={page.totalRows}
        columnCount={columns.length}
        isLoading={loading}
        onRefresh={() => { setLoading(true); postMessage({ type: 'refresh' }); }}
      />
      {error && <div className="error-banner">{error}</div>}
      <div className="app-layout">
        <div className="operations-pane">
          <OperationsPanel
            columns={columns}
            transformSteps={steps}
            onTransform={transform}
            onExport={format => {
              setLoading(true);
              postMessage({ type: 'exportData', format });
            }}
            onRemoveStep={id => postMessage({ type: 'removeTransform', id })}
            onUndo={() => postMessage({ type: 'undo' })}
            onRedo={() => postMessage({ type: 'redo' })}
          />
        </div>
        <div className="grid-pane">
          {filePath ? (
            <>
              <QueryConsole
                loading={loading}
                active={customQueryActive}
                onRun={sql => { setLoading(true); postMessage({ type: 'executeCustomQuery', sql }); }}
                onClear={() => { setLoading(true); postMessage({ type: 'clearCustomQuery' }); }}
              />
              {!customQueryActive && <details className="stats-summary" open onToggle={event => {
                if (event.currentTarget.open && stats.length === 0) {
                  setLoading(true); postMessage({ type: 'getStats' });
                }
              }}>
                <summary><span>Column profiles</span><small>quality, uniqueness and distribution</small></summary>
                <ColumnProfiles profiles={stats} totalRows={page.totalRows} loading={loading} />
              </details>}
              <DataGrid
                columns={columns.map(column => ({ name: column.name, type: column.type }))}
                rows={rows}
                sortBy={sortBy}
                sortDirection={sortDirection}
                onSort={column => {
                  const direction = sortBy === column && sortDirection === 'asc' ? 'desc' : 'asc';
                  setSortBy(column); setSortDirection(direction);
                  transform('sort_rows', { column, direction: direction.toUpperCase() });
                }}
              />
              <div className="pagination-controls">
                <button disabled={page.offset === 0 || loading} onClick={() => changePage(page.offset - page.limit)}>Previous</button>
                <span>{page.totalRows === 0 ? 0 : page.offset + 1}–{Math.min(page.offset + page.limit, page.totalRows)} of {page.totalRows.toLocaleString()}</span>
                <button disabled={page.offset + page.limit >= page.totalRows || loading} onClick={() => changePage(page.offset + page.limit)}>Next</button>
              </div>
            </>
          ) : (
            <div className="empty-state">
              <div className="empty-icon">📊</div><h2>No data loaded</h2>
              <p>Open Parquet, CSV, TSV, JSON, NDJSON, XLSX, or ODS data.</p>
              <button className="primary-button" onClick={() => postMessage({ type: 'openFilePicker' })}>Open File</button>
            </div>
          )}
        </div>
        <div className="code-pane">
          <CodePreview transformSteps={steps} columns={columns} tableName="current_data" generatedCode={code} />
        </div>
      </div>
    </div>
  );
};

export default App;
