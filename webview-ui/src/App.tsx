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
  canUndo?: boolean;
  canRedo?: boolean;
  requestId?: string;
  sessionId: string;
  revision: number;
}

const WEBVIEW_PROTOCOL_VERSION = 3;
type RequestSurface = 'grid' | 'stats' | 'chart' | 'export' | 'ai';

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    Boolean(target.closest('input, textarea, select, [contenteditable]'))
  );
}

function transformLabel(type: string): string {
  const label = type.replaceAll('_', ' ');
  return label.charAt(0).toUpperCase() + label.slice(1);
}

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
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [loadingProgress, setLoadingProgress] = useState<{
    percent: number;
    message: string;
    source: string;
  }>();
  const [secondaryFile, setSecondaryFile] = useState<{ filePath: string; columns: string[] }>();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const pendingTransform = useRef<string | null>(null);
  const requestSequence = useRef(0);
  const latestRequests = useRef<Partial<Record<RequestSurface, string>>>({});
  const sessionContext = useRef<{ sessionId: string; revision: number } | undefined>(undefined);

  const sendRequest = useCallback(
    (surface: RequestSurface, message: Parameters<typeof postMessage>[0]) => {
      const requestId = `${surface}-${++requestSequence.current}`;
      latestRequests.current[surface] = requestId;
      postMessage({ ...message, requestId });
      return requestId;
    },
    [postMessage],
  );

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  }, []);

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const unsubscribe = onMessage((message: any) => {
      if (message.type === 'sessionUpdated') {
        const update = message as SessionMessage & { type: string };
        if (
          update.requestId &&
          latestRequests.current.grid &&
          update.requestId !== latestRequests.current.grid &&
          update.requestId !== latestRequests.current.ai
        )
          return;
        if (update.protocolVersion !== WEBVIEW_PROTOCOL_VERSION) {
          setLoading(false);
          setError(
            'QuackWrangler was rebuilt, but this Extension Development Host is still running an older process. Close the Development Host, stop debugging with Shift+F5, and start it again with F5.',
          );
          return;
        }
        setFilePath(update.schema.filePath);
        sessionContext.current = { sessionId: update.sessionId, revision: update.revision };
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
        const history = update.history.map((item) => ({
          id: item.id,
          name: item.type,
          description: item.description,
          params: item.params,
          timestamp: 0,
        }));
        setSteps(history);
        if (pendingTransform.current) {
          showToast(`Applied ${transformLabel(pendingTransform.current)}`);
          pendingTransform.current = null;
        }
        setPage(update.page);
        setDatasetRowCount(update.schema.rowCount);
        setStats([]);
        setQualityIssues([]);
        setChartConfig(undefined);
        setChartRows([]);
        setLoading(false);
        setError(null);
        setSearchQuery('');
        setCanUndo(update.canUndo ?? history.length > 0);
        setCanRedo(update.canRedo ?? false);
        sendRequest('stats', { type: 'getStats' });
        setCustomQueryActive(false);
        setLoadingProgress(undefined);
        setAiLoading(false);
      } else if (message.type === 'customQueryResult') {
        if (message.requestId !== latestRequests.current.grid) return;
        if (
          !sessionContext.current ||
          message.sessionId !== sessionContext.current.sessionId ||
          message.revision !== sessionContext.current.revision
        )
          return;
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
        if (message.requestId !== latestRequests.current.grid) return;
        if (
          !sessionContext.current ||
          message.sessionId !== sessionContext.current.sessionId ||
          message.revision !== sessionContext.current.revision
        )
          return;
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
        // An absent requestId marks an unsolicited host push (Summarize File),
        // which is still validated against the visible session below.
        if (message.requestId && message.requestId !== latestRequests.current.stats) return;
        if (
          !sessionContext.current ||
          message.sessionId !== sessionContext.current.sessionId ||
          message.revision !== sessionContext.current.revision
        )
          return;
        setStats(message.stats);
        setQualityIssues(message.quality?.issues ?? []);
        // Stats is an independent background request — do not clear global loading,
        // which may be for an unrelated transform or query that is still in flight.
      } else if (message.type === 'chartResult') {
        if (message.requestId !== latestRequests.current.chart) return;
        if (
          !sessionContext.current ||
          message.sessionId !== sessionContext.current.sessionId ||
          message.revision !== sessionContext.current.revision
        )
          return;
        setChartConfig(message.chart);
        setChartRows(message.result.rows);
        setChartLoading(false);
      } else if (message.type === 'secondaryFileSelected') {
        setSecondaryFile({
          filePath: message.filePath,
          columns: message.columns.map((column: { name: string }) => column.name),
        });
      } else if (message.type === 'exportComplete') {
        if (message.requestId !== latestRequests.current.export) return;
        setLoading(false);
        setError(null);
      } else if (message.type === 'aiComplete') {
        if (message.requestId !== latestRequests.current.ai) return;
        setAiLoading(false);
      } else if (message.type === 'error') {
        if (message.requestId && !Object.values(latestRequests.current).includes(message.requestId))
          return;
        setError(message.message);
        if (!message.requestId || message.requestId === latestRequests.current.grid) {
          pendingTransform.current = null;
          setLoading(false);
          setLoadingProgress(undefined);
        }
        if (!message.requestId || message.requestId === latestRequests.current.chart) {
          setChartLoading(false);
        }
        if (!message.requestId || message.requestId === latestRequests.current.ai) {
          setAiLoading(false);
        }
        if (message.requestId === latestRequests.current.export) setLoading(false);
      } else if (message.type === 'loadingProgress') {
        if (message.requestId && message.requestId !== latestRequests.current.grid) return;
        setLoading(true);
        setError(null);
        setLoadingProgress({
          percent: message.percent,
          message: message.message,
          source: message.source,
        });
      }
    });
    sendRequest('grid', { type: 'ready' });
    return unsubscribe;
  }, [onMessage, sendRequest, showToast]);

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

  useEffect(() => {
    if (!filePath) return;
    const handleShortcut = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target) || loading || pendingTransform.current) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        event.stopPropagation();
        if (event.shiftKey) {
          if (canRedo) {
            setLoading(true);
            sendRequest('grid', { type: 'redo' });
          }
        } else if (canUndo) {
          setLoading(true);
          sendRequest('grid', { type: 'undo' });
        }
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'y' && canRedo) {
        event.preventDefault();
        event.stopPropagation();
        setLoading(true);
        sendRequest('grid', { type: 'redo' });
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [filePath, canUndo, canRedo, loading, sendRequest]);

  const transform = useCallback(
    (type: string, params: Record<string, unknown>) => {
      if (pendingTransform.current) return;
      setLoading(true);
      pendingTransform.current = type;
      sendRequest('grid', {
        type: 'applyTransform',
        transform: { id: '', type, params, sql: '', description: '' },
      });
    },
    [sendRequest],
  );

  const changePage = useCallback(
    (offset: number) => {
      setLoading(true);
      sendRequest('grid', {
        type: 'pageChange',
        offset: Math.max(0, offset),
        limit: page.limit,
      });
    },
    [page.limit, sendRequest],
  );

  const fileName = useMemo(() => filePath.split(/[\\/]/).pop() ?? '', [filePath]);

  return (
    <div className="app">
      <Header
        fileName={fileName}
        rowCount={page.totalRows}
        columnCount={columns.length}
        isLoading={loading}
        aiLoading={aiLoading}
        onRefresh={() => {
          setLoading(true);
          sendRequest('grid', { type: 'refresh' });
        }}
        onGenerateAI={() => {
          setAiLoading(true);
          sendRequest('ai', { type: 'generateAITransforms' });
        }}
      />
      {toast && (
        <div className="success-toast" role="status" aria-live="polite">
          {toast}
        </div>
      )}
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
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
              canUndo={canUndo && !loading}
              canRedo={canRedo && !loading}
              onTransform={transform}
              onExport={(format) => {
                if (loading) return;
                setLoading(true);
                sendRequest('export', { type: 'exportData', format });
              }}
              onRemoveStep={(id) => {
                if (loading) return;
                setLoading(true);
                sendRequest('grid', { type: 'removeTransform', id });
              }}
              onReorderSteps={(sourceId, targetId) => {
                if (loading) return;
                setLoading(true);
                sendRequest('grid', { type: 'reorderTransforms', sourceId, targetId });
              }}
              onUndo={() => {
                setLoading(true);
                sendRequest('grid', { type: 'undo' });
              }}
              onRedo={() => {
                setLoading(true);
                sendRequest('grid', { type: 'redo' });
              }}
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
                    sendRequest('grid', { type: 'executeCustomQuery', sql });
                  }}
                  onClear={() => {
                    setLoading(true);
                    sendRequest('grid', { type: 'clearCustomQuery' });
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
                      if (loading) return;
                      setChartLoading(true);
                      sendRequest('chart', { type: 'requestChart', chart });
                    }}
                  />
                )}
              </div>
              <form
                className="grid-search"
                onSubmit={(event) => {
                  event.preventDefault();
                  setLoading(true);
                  sendRequest('grid', { type: 'searchRows', query: searchQuery });
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
                      sendRequest('grid', { type: 'searchRows', query: '' });
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
              <p className="empty-state-hint">
                Filter, sort, transform, profile, and chart your data visually — or describe what
                you want and let AI plan the steps.
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
