import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ChartPanel, type ChartConfig } from './components/ChartPanel';
import type { ColumnProfile } from './components/ColumnProfiles';
import { DataGrid } from './components/DataGrid';
import { DataQualitySummary, type QualityIssue } from './components/DataQualitySummary';
import { Header } from './components/Header';
import { OperationsPanel } from './components/OperationsPanel';
import { QueryConsole } from './components/QueryConsole';
import { useVSCodeAPI } from './hooks/useVSCodeAPI';
import type { ColumnInfo, TransformStep } from './types';
import './styles/theme.css';

interface PageState {
  offset: number;
  limit: number;
  totalRows: number;
}
interface SessionMessage {
  protocolVersion: number;
  schema: {
    columns: Array<{ name: string; type: string; nullable: boolean }>;
    rowCount: number;
    filePath: string;
  };
  result: { rows: unknown[][] };
  history: Array<{
    id: string;
    type: string;
    params: Record<string, unknown>;
    description: string;
  }>;
  page: PageState;
}

const WEBVIEW_PROTOCOL_VERSION = 2;

export const App: React.FC = () => {
  const { postMessage, onMessage } = useVSCodeAPI();
  const [filePath, setFilePath] = useState('');
  const [columns, setColumns] = useState<ColumnInfo[]>([]);
  const [rows, setRows] = useState<unknown[][]>([]);
  const [steps, setSteps] = useState<TransformStep[]>([]);
  const [page, setPage] = useState<PageState>({ offset: 0, limit: 100, totalRows: 0 });
  const [datasetRowCount, setDatasetRowCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<string>();
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [stats, setStats] = useState<ColumnProfile[]>([]);
  const [customQueryActive, setCustomQueryActive] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [qualityIssues, setQualityIssues] = useState<QualityIssue[]>([]);
  const [chartConfig, setChartConfig] = useState<ChartConfig>();
  const [chartRows, setChartRows] = useState<unknown[][]>([]);
  const [chartLoading, setChartLoading] = useState(false);
  const [operationsCollapsed, setOperationsCollapsed] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState<{
    percent: number;
    message: string;
    source: string;
  }>();
  const [secondaryFile, setSecondaryFile] = useState<{ filePath: string; columns: string[] }>();
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const unsubscribe = onMessage((message: any) => {
      if (message.type === 'sessionUpdated') {
        const update = message as SessionMessage & { type: string };
        if (update.protocolVersion !== WEBVIEW_PROTOCOL_VERSION) {
          setLoading(false);
          setError(
            'QuackWrangler was rebuilt, but this Extension Development Host is still running an older process. Close the Development Host, stop debugging with Shift+F5, and start it again with F5.',
          );
          return;
        }
        setFilePath(update.schema.filePath);
        setColumns(
          update.schema.columns.map((column) => ({
            name: column.name,
            displayName: column.name,
            dataType: 'string',
            type: column.type,
            nullable: column.nullable,
            nullCount: 0,
            uniqueCount: 0,
            totalRows: update.schema.rowCount,
          })) as ColumnInfo[],
        );
        setRows(update.result.rows);
        setSteps(
          update.history.map((item) => ({
            id: item.id,
            name: item.type,
            description: item.description,
            params: item.params,
            timestamp: 0,
          })),
        );
        setPage(update.page);
        setDatasetRowCount(update.schema.rowCount);
        setStats([]);
        setQualityIssues([]);
        setChartConfig(undefined);
        setChartRows([]);
        setLoading(false);
        setError(null);
        setSearchQuery('');
        postMessage({ type: 'getStats' });
        setCustomQueryActive(false);
        setLoadingProgress(undefined);
      } else if (message.type === 'customQueryResult') {
        setColumns(
          message.schema.columns.map(
            (column: { name: string; type: string; nullable: boolean }) => ({
              name: column.name,
              displayName: column.name,
              dataType: 'string',
              type: column.type,
              nullable: column.nullable,
              nullCount: 0,
              uniqueCount: 0,
              totalRows: message.page.totalRows,
            }),
          ) as ColumnInfo[],
        );
        setRows(message.result.rows);
        setPage(message.page);
        setStats([]);
        setCustomQueryActive(true);
        setLoading(false);
        setError(null);
      } else if (message.type === 'searchResult') {
        setColumns(
          message.schema.columns.map(
            (column: { name: string; type: string; nullable: boolean }) => ({
              name: column.name,
              displayName: column.name,
              dataType: 'string',
              type: column.type,
              nullable: column.nullable,
              nullCount: 0,
              uniqueCount: 0,
              totalRows: message.page.totalRows,
            }),
          ) as ColumnInfo[],
        );
        setRows(message.result.rows);
        setPage(message.page);
        setSearchQuery(message.query);
        setLoading(false);
        setError(null);
      } else if (message.type === 'stats') {
        setStats(message.stats);
        setQualityIssues(message.quality?.issues ?? []);
        setLoading(false);
      } else if (message.type === 'chartResult') {
        setChartConfig(message.chart);
        setChartRows(message.result.rows);
        setChartLoading(false);
      } else if (message.type === 'secondaryFileSelected') {
        setSecondaryFile({
          filePath: message.filePath,
          columns: message.columns.map((column: { name: string }) => column.name),
        });
      } else if (message.type === 'exportComplete') {
        setLoading(false);
        setError(null);
      } else if (message.type === 'error') {
        setError(message.message);
        setLoading(false);
        setChartLoading(false);
        setLoadingProgress(undefined);
      } else if (message.type === 'loadingProgress') {
        setLoading(true);
        setError(null);
        setLoadingProgress({
          percent: message.percent,
          message: message.message,
          source: message.source,
        });
      }
    });
    postMessage({ type: 'ready' });
    return unsubscribe;
  }, [onMessage, postMessage]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f' && filePath) {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [filePath]);

  const transform = useCallback(
    (type: string, params: Record<string, unknown>) => {
      setLoading(true);
      postMessage({
        type: 'applyTransform',
        transform: { id: '', type, params, sql: '', description: '' },
      });
    },
    [postMessage],
  );

  const changePage = useCallback(
    (offset: number) => {
      setLoading(true);
      postMessage({ type: 'pageChange', offset: Math.max(0, offset), limit: page.limit });
    },
    [page.limit, postMessage],
  );

  const fileName = useMemo(() => filePath.split(/[\\/]/).pop() ?? '', [filePath]);

  return (
    <div className="app">
      <Header
        fileName={fileName}
        rowCount={page.totalRows}
        columnCount={columns.length}
        isLoading={loading}
        onRefresh={() => {
          setLoading(true);
          postMessage({ type: 'refresh' });
        }}
      />
      {error && <div className="error-banner">{error}</div>}
      {loadingProgress && (
        <div className="remote-progress" role="status" aria-live="polite">
          <div>
            <strong>{loadingProgress.message}</strong>
            <span>{loadingProgress.percent}%</span>
          </div>
          <progress
            max="100"
            value={loadingProgress.percent}
            aria-label={`Remote loading ${loadingProgress.percent}%`}
          />
          <small title={loadingProgress.source}>{loadingProgress.source}</small>
        </div>
      )}
      <div className={`app-layout ${operationsCollapsed ? 'operations-collapsed' : ''}`}>
        <div className="operations-pane">
          {operationsCollapsed ? (
            <button
              className="operations-expand"
              type="button"
              onClick={() => setOperationsCollapsed(false)}
              title="Expand operations"
              aria-label="Expand operations"
            >
              <span className="operations-expand-icon">›</span>
              <span className="operations-expand-label">Operations</span>
            </button>
          ) : (
            <OperationsPanel
              columns={columns}
              transformSteps={steps}
              onTransform={transform}
              onExport={(format) => {
                setLoading(true);
                postMessage({ type: 'exportData', format });
              }}
              onRemoveStep={(id) => postMessage({ type: 'removeTransform', id })}
              onReorderSteps={(sourceId, targetId) =>
                postMessage({ type: 'reorderTransforms', sourceId, targetId })
              }
              onUndo={() => postMessage({ type: 'undo' })}
              onRedo={() => postMessage({ type: 'redo' })}
              onCollapse={() => setOperationsCollapsed(true)}
              secondaryFile={secondaryFile}
              onSelectSecondaryFile={() => postMessage({ type: 'selectSecondaryFile' })}
            />
          )}
        </div>
        <div className="grid-pane">
          {filePath ? (
            <>
              <div className="analysis-pane">
                <QueryConsole
                  loading={loading}
                  active={customQueryActive}
                  onRun={(sql) => {
                    setLoading(true);
                    postMessage({ type: 'executeCustomQuery', sql });
                  }}
                  onClear={() => {
                    setLoading(true);
                    postMessage({ type: 'clearCustomQuery' });
                  }}
                />
                {!customQueryActive && (
                  <DataQualitySummary
                    issues={qualityIssues}
                    loading={loading && stats.length === 0}
                  />
                )}
                {!customQueryActive && (
                  <ChartPanel
                    columns={columns}
                    config={chartConfig}
                    rows={chartRows}
                    loading={chartLoading}
                    onRequest={(chart) => {
                      setChartLoading(true);
                      postMessage({ type: 'requestChart', chart });
                    }}
                  />
                )}
              </div>
              <form
                className="grid-search"
                onSubmit={(event) => {
                  event.preventDefault();
                  setLoading(true);
                  postMessage({ type: 'searchRows', query: searchQuery });
                }}
              >
                <input
                  ref={searchInputRef}
                  type="search"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search all columns"
                  aria-label="Search all columns"
                />
                <button type="submit" disabled={loading}>
                  Search
                </button>
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery('');
                      setLoading(true);
                      postMessage({ type: 'searchRows', query: '' });
                    }}
                  >
                    Clear
                  </button>
                )}
              </form>
              <DataGrid
                columns={columns.map((column) => ({ name: column.name, type: column.type }))}
                rows={rows}
                sortBy={sortBy}
                sortDirection={sortDirection}
                profiles={customQueryActive ? [] : stats}
                profileTotalRows={datasetRowCount}
                profilesLoading={!customQueryActive && loading && stats.length === 0}
                profilesEnabled={!customQueryActive}
                onSort={(column) => {
                  const direction = sortBy === column && sortDirection === 'asc' ? 'desc' : 'asc';
                  setSortBy(column);
                  setSortDirection(direction);
                  transform('sort_rows', { column, direction: direction.toUpperCase() });
                }}
                onQuickFilter={(column, operator, value) => {
                  transform('filter_rows', { column, operator, value });
                }}
                onTransform={transform}
              />
              <div className="pagination-controls">
                <button
                  disabled={page.offset === 0 || loading}
                  onClick={() => changePage(page.offset - page.limit)}
                >
                  Previous
                </button>
                <span>
                  {page.totalRows === 0 ? 0 : page.offset + 1}–
                  {Math.min(page.offset + page.limit, page.totalRows)} of{' '}
                  {page.totalRows.toLocaleString()}
                </span>
                <button
                  disabled={page.offset + page.limit >= page.totalRows || loading}
                  onClick={() => changePage(page.offset + page.limit)}
                >
                  Next
                </button>
              </div>
            </>
          ) : (
            <div className="empty-state">
              <div className="empty-icon">📊</div>
              <h2>No data loaded</h2>
              <p>
                Open a supported file directly, or select a folder to browse its data files by
                directory.
              </p>
              <div className="empty-actions">
                <button
                  className="primary-button"
                  onClick={() => postMessage({ type: 'openFilePicker' })}
                >
                  Open File
                </button>
                <button onClick={() => postMessage({ type: 'openFolderPicker' })}>
                  Open Folder
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;
