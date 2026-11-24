import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ChartPanel, type ChartConfig } from './components/ChartPanel';
import type { ColumnProfile } from './components/ColumnProfiles';
import { DataGrid } from './components/DataGrid';
import { DataQualitySummary, type QualityIssue } from './components/DataQualitySummary';
import { Header } from './components/Header';
import { OperationsPanel } from './components/OperationsPanel';
import { QueryConsole } from './components/QueryConsole';
import { useVSCodeAPI } from './hooks/useVSCodeAPI';
import type { ColumnInfo, DatabaseInfo, TransformStep } from './types';
import './styles/theme.css';
import '@vscode/codicons/dist/codicon.css';

interface PageState {
  offset: number;
  limit: number;
  totalRows: number;
  scope?: 'pipeline' | 'search' | 'inspection' | 'query';
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
  database?: DatabaseInfo;
  requestId?: string;
  sessionId: string;
  revision: number;
}

interface QueryResultMessage {
  type: 'customQueryResult';
  requestId?: string;
  sessionId: string;
  revision: number;
  schema: { columns: Array<{ name: string; type: string; nullable: boolean }> };
  result: { rows: unknown[][] };
  page: PageState;
  customQuerySql: string;
}

interface SearchResultMessage {
  type: 'searchResult';
  requestId?: string;
  sessionId: string;
  revision: number;
  schema: { columns: Array<{ name: string; type: string; nullable: boolean }> };
  result: { rows: unknown[][] };
  page: PageState;
  query: string;
  scope: 'search' | 'inspection';
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

function stepLabel(step: TransformStep): string {
  const names: Record<string, string> = {
    filter_rows: 'Filter',
    filterRows: 'Filter',
    formula_column: 'Formula',
    add_column: 'Add column',
    rename_column: 'Rename',
    drop_column: 'Drop column',
    fill_nulls: 'Fill missing',
    sort_rows: 'Sort',
    deduplicate: 'Remove duplicates',
  };
  const name = names[step.name] ?? transformLabel(step.name);
  const column = step.params.column ?? step.params.oldName ?? step.params.name;
  return typeof column === 'string' && column ? `${name} · ${column}` : name;
}

export const App: React.FC = () => {
  const { postMessage, onMessage } = useVSCodeAPI();
  const [filePath, setFilePath] = useState('');
  const [database, setDatabase] = useState<DatabaseInfo | undefined>(undefined);
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
  const [statsLoading, setStatsLoading] = useState(false);
  const [customQueryActive, setCustomQueryActive] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeSearchQuery, setActiveSearchQuery] = useState('');
  const [activeQuerySql, setActiveQuerySql] = useState<string | null>(null);
  const [qualityIssues, setQualityIssues] = useState<QualityIssue[]>([]);
  const [chartConfig, setChartConfig] = useState<ChartConfig>();
  const [chartRows, setChartRows] = useState<unknown[][]>([]);
  const [chartLoading, setChartLoading] = useState(false);
  const [operationsCollapsed, setOperationsCollapsed] = useState(true);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [recipeMenuOpen, setRecipeMenuOpen] = useState(false);
  const [analysisTab, setAnalysisTab] = useState<'quality' | 'charts' | 'sql' | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [inspection, setInspection] = useState<{ column: string; operator: string } | null>(null);
  const [fillDialog, setFillDialog] = useState<{ column: string; value: string } | null>(null);
  const [fillError, setFillError] = useState<string | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inspectionActive = useRef(false);
  const [loadingProgress, setLoadingProgress] = useState<{
    percent: number;
    message: string;
    source: string;
  }>();
  const [secondaryFile, setSecondaryFile] = useState<{ filePath: string; columns: string[] }>();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const exportButtonRef = useRef<HTMLButtonElement>(null);
  const recipeButtonRef = useRef<HTMLButtonElement>(null);
  const exportFocusPending = useRef(false);
  const fillTriggerRef = useRef<HTMLElement | null>(null);
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

  const requestExport = useCallback(
    (format: 'parquet' | 'csv' | 'json') => {
      const context = sessionContext.current;
      if (loading || !context) return;
      setLoading(true);
      sendRequest('export', {
        type: 'exportData',
        format,
        ...context,
        customQuerySql: activeQuerySql,
      });
    },
    [activeQuerySql, loading, sendRequest],
  );

  const closeFillDialog = () => {
    setFillDialog(null);
    const trigger = fillTriggerRef.current;
    requestAnimationFrame(() => trigger?.focus());
  };

  const requestPolarsHandoff = useCallback(
    (mode: 'result' | 'recipe') => {
      const context = sessionContext.current;
      if (!context) return;
      sendRequest('export', {
        type: 'polarsHandoff',
        mode,
        sessionId: context.sessionId,
        revision: context.revision,
        customQuerySql: activeQuerySql,
      });
    },
    [activeQuerySql, sendRequest],
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
        const update = message as SessionMessage;
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
        setDatabase(update.database);
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
          description: stepLabel({
            id: item.id,
            name: item.type,
            description: item.description,
            params: item.params,
            timestamp: 0,
          }),
          params: item.params,
          timestamp: 0,
        }));
        setSteps(history);
        if (pendingTransform.current) {
          showToast(`Applied ${transformLabel(pendingTransform.current)}`);
          pendingTransform.current = null;
        }
        setPage({ ...update.page, scope: 'pipeline' });
        setDatasetRowCount(update.schema.rowCount);
        setStats([]);
        setStatsLoading(true);
        setQualityIssues([]);
        setChartConfig(undefined);
        setChartRows([]);
        setLoading(false);
        setError(null);
        setSearchQuery('');
        setActiveSearchQuery('');
        setInspection(null);
        inspectionActive.current = false;
        setCanUndo(update.canUndo ?? history.length > 0);
        setCanRedo(update.canRedo ?? false);
        sendRequest('stats', { type: 'getStats' });
        setCustomQueryActive(false);
        setActiveQuerySql(null);
        setLoadingProgress(undefined);
        setAiLoading(false);
      } else if (message.type === 'customQueryResult') {
        const queryResult = message as QueryResultMessage;
        if (queryResult.requestId !== latestRequests.current.grid) return;
        if (
          !sessionContext.current ||
          queryResult.sessionId !== sessionContext.current.sessionId ||
          queryResult.revision !== sessionContext.current.revision
        )
          return;
        setColumns(
          queryResult.schema.columns.map(
            (column: { name: string; type: string; nullable: boolean }) => ({
              name: column.name,
              displayName: column.name,
              dataType: 'string',
              type: column.type,
              nullable: column.nullable,
              nullCount: 0,
              uniqueCount: 0,
              totalRows: queryResult.page.totalRows,
            }),
          ) as ColumnInfo[],
        );
        setRows(queryResult.result.rows);
        setPage({ ...queryResult.page, scope: 'query' });
        setStats([]);
        setStatsLoading(true);
        setCustomQueryActive(true);
        setActiveQuerySql(queryResult.customQuerySql);
        setActiveSearchQuery('');
        setLoading(false);
        setError(null);
      } else if (message.type === 'searchResult') {
        const searchResult = message as SearchResultMessage;
        if (searchResult.requestId !== latestRequests.current.grid) return;
        if (
          !sessionContext.current ||
          searchResult.sessionId !== sessionContext.current.sessionId ||
          searchResult.revision !== sessionContext.current.revision
        )
          return;
        setColumns(
          searchResult.schema.columns.map(
            (column: { name: string; type: string; nullable: boolean }) => ({
              name: column.name,
              displayName: column.name,
              dataType: 'string',
              type: column.type,
              nullable: column.nullable,
              nullCount: 0,
              uniqueCount: 0,
              totalRows: searchResult.page.totalRows,
            }),
          ) as ColumnInfo[],
        );
        setRows(searchResult.result.rows);
        setPage({ ...searchResult.page, scope: searchResult.scope });
        inspectionActive.current = searchResult.scope === 'inspection';
        setSearchQuery(searchResult.query);
        setActiveSearchQuery(searchResult.query);
        setPage({ ...message.page, scope: inspectionActive.current ? 'inspection' : 'search' });
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
        setStatsLoading(false);
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
        if (exportFocusPending.current) {
          exportFocusPending.current = false;
          requestAnimationFrame(() => exportButtonRef.current?.focus());
        }
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
        setShowSearch(true);
        requestAnimationFrame(() => {
          searchInputRef.current?.focus();
          searchInputRef.current?.select();
        });
      } else if (event.key === 'Escape' && !event.defaultPrevented && !operationsCollapsed) {
        event.preventDefault();
        setOperationsCollapsed(true);
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [filePath, operationsCollapsed]);

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
        database={database}
        onSelectTable={(table) => {
          setLoading(true);
          sendRequest('grid', { type: 'selectTable', schema: table.schema, name: table.name });
        }}
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
      <div
        className={`app-layout ${operationsCollapsed ? 'operations-collapsed' : 'operations-open'}`}
      >
        <div className="grid-content">
          {filePath ? (
            <>
              <div className="workspace-actions">
                <button
                  type="button"
                  className={operationsCollapsed ? '' : 'active'}
                  onClick={() => setOperationsCollapsed((value) => !value)}
                  aria-expanded={!operationsCollapsed}
                >
                  Transform
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setOperationsCollapsed(false);
                    window.setTimeout(
                      () =>
                        document
                          .querySelector('.active-transforms')
                          ?.scrollIntoView({ block: 'nearest' }),
                      0,
                    );
                  }}
                >
                  Steps · {steps.length}
                </button>
                <div
                  className="export-menu"
                  onBlur={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                      setExportMenuOpen(false);
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== 'Escape' || !exportMenuOpen) return;
                    event.preventDefault();
                    event.stopPropagation();
                    setExportMenuOpen(false);
                    exportButtonRef.current?.focus();
                  }}
                >
                  <button
                    ref={exportButtonRef}
                    type="button"
                    onClick={() => setExportMenuOpen((value) => !value)}
                    aria-expanded={exportMenuOpen}
                  >
                    Export <span className="codicon codicon-chevron-down" aria-hidden="true" />
                  </button>
                  {exportMenuOpen && (
                    <div className="export-menu-items" role="menu">
                      {(['parquet', 'csv', 'json'] as const).map((format) => (
                        <button
                          key={format}
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setExportMenuOpen(false);
                            exportFocusPending.current = true;
                            requestExport(format);
                          }}
                        >
                          {format.toUpperCase()}
                        </button>
                      ))}
                      <button
                        className="menu-secondary"
                        type="button"
                        role="menuitem"
                        disabled={Boolean(inspection)}
                        onClick={() => {
                          setExportMenuOpen(false);
                          if (!inspection) requestPolarsHandoff('result');
                        }}
                      >
                        Continue in Polars…
                      </button>
                      <button
                        className="menu-secondary"
                        type="button"
                        role="menuitem"
                        disabled={Boolean(inspection)}
                        onClick={() => {
                          setExportMenuOpen(false);
                          if (!inspection) requestPolarsHandoff('recipe');
                        }}
                      >
                        Open Polars recipe
                      </button>
                    </div>
                  )}
                </div>
                <div
                  className="recipe-menu"
                  onBlur={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                      setRecipeMenuOpen(false);
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== 'Escape' || !recipeMenuOpen) return;
                    event.preventDefault();
                    setRecipeMenuOpen(false);
                    recipeButtonRef.current?.focus();
                  }}
                >
                  <button
                    ref={recipeButtonRef}
                    type="button"
                    aria-expanded={recipeMenuOpen}
                    onClick={() => setRecipeMenuOpen((value) => !value)}
                  >
                    Recipe <span className="codicon codicon-chevron-down" aria-hidden="true" />
                  </button>
                  {recipeMenuOpen && (
                    <div className="export-menu-items" role="menu">
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setRecipeMenuOpen(false);
                          sendRequest('grid', { type: 'saveRecipe' });
                        }}
                      >
                        Save recipe…
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setRecipeMenuOpen(false);
                          postMessage({ type: 'openRecipePicker' });
                        }}
                      >
                        Run recipe…
                      </button>
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  className="toolbar-search"
                  aria-label="Open search"
                  onClick={() => {
                    setShowSearch(true);
                    requestAnimationFrame(() => searchInputRef.current?.focus());
                  }}
                >
                  <span className="codicon codicon-search" aria-hidden="true" />
                </button>
              </div>
            </>
          ) : null}
        </div>
        {!operationsCollapsed && (
          <button
            className="operations-backdrop"
            type="button"
            aria-label="Close tools panel"
            onClick={() => setOperationsCollapsed(true)}
          />
        )}
        {!operationsCollapsed && (
          <div className="operations-pane">
            <OperationsPanel
              columns={columns}
              transformSteps={steps}
              canUndo={canUndo && !loading}
              canRedo={canRedo && !loading}
              onTransform={transform}
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
          </div>
        )}
        <div className="grid-pane">
          {filePath ? (
            <>
              <div className={`analysis-pane ${analysisTab ? 'analysis-open' : ''}`}>
                {!customQueryActive && (
                  <div className="analysis-tabs" role="tablist" aria-label="Data analysis">
                    {(
                      [
                        [
                          'quality',
                          `Quality${qualityIssues.length ? ` · ${qualityIssues.length}` : ''}`,
                        ],
                        ['charts', 'Charts'],
                        ['sql', 'SQL'],
                      ] as const
                    ).map(([tab, label]) => (
                      <button
                        key={tab}
                        type="button"
                        role="tab"
                        aria-selected={analysisTab === tab}
                        className={analysisTab === tab ? 'active' : ''}
                        onClick={() => setAnalysisTab((current) => (current === tab ? null : tab))}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
                {customQueryActive || analysisTab === 'sql' ? (
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
                ) : null}
                {!customQueryActive && analysisTab === 'quality' && (
                  <DataQualitySummary
                    issues={qualityIssues}
                    loading={loading && stats.length === 0}
                    onInspect={(issue) => {
                      if (!issue.column) return;
                      inspectionActive.current = true;
                      setInspection({ column: issue.column, operator: 'is_null' });
                      setLoading(true);
                      sendRequest('grid', {
                        type: 'searchRows',
                        query: '',
                        filter: { column: issue.column, operator: 'is_null' },
                      });
                    }}
                    onFill={(column) => {
                      fillTriggerRef.current =
                        document.activeElement instanceof HTMLElement
                          ? document.activeElement
                          : null;
                      setFillError(null);
                      setFillDialog({ column, value: '' });
                    }}
                    onTransform={transform}
                  />
                )}
                {!customQueryActive && analysisTab === 'charts' && (
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
                hidden={!showSearch && !activeSearchQuery && !inspection}
                onKeyDown={(event) => {
                  if (event.key !== 'Escape' || (!showSearch && !searchQuery)) return;
                  event.preventDefault();
                  setShowSearch(false);
                  setSearchQuery('');
                  setActiveSearchQuery('');
                  setInspection(null);
                  searchInputRef.current?.blur();
                  setLoading(true);
                  sendRequest('grid', { type: 'searchRows', query: '' });
                }}
                onSubmit={(event) => {
                  event.preventDefault();
                  setInspection(null);
                  inspectionActive.current = false;
                  setLoading(true);
                  sendRequest('grid', { type: 'searchRows', query: searchQuery });
                }}
              >
                <input
                  ref={searchInputRef}
                  type="search"
                  value={searchQuery}
                  onChange={(event) => {
                    setSearchQuery(event.target.value);
                    setInspection(null);
                    inspectionActive.current = false;
                    sendRequest('grid', { type: 'searchChange', query: event.target.value });
                  }}
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
                      setActiveSearchQuery('');
                      setInspection(null);
                      inspectionActive.current = false;
                      setLoading(true);
                      sendRequest('grid', { type: 'searchRows', query: '' });
                    }}
                  >
                    Clear
                  </button>
                )}
              </form>
              {(inspection || activeSearchQuery) && (
                <div className="result-scope" role="status">
                  <span>
                    {inspection
                      ? `Inspecting ${inspection.column} · ${page.totalRows.toLocaleString()} matching rows · Export uses the full pipeline result (${datasetRowCount.toLocaleString()} rows)`
                      : `Search results · ${page.totalRows.toLocaleString()} matching rows · pipeline result has ${datasetRowCount.toLocaleString()} rows`}
                  </span>
                  {inspection && (
                    <button
                      type="button"
                      onClick={() => {
                        setInspection(null);
                        inspectionActive.current = false;
                        setLoading(true);
                        sendRequest('grid', { type: 'searchRows', query: activeSearchQuery });
                      }}
                    >
                      Clear inspection
                    </button>
                  )}
                </div>
              )}
              <DataGrid
                columns={columns.map((column) => ({ name: column.name, type: column.type }))}
                rows={rows}
                sortBy={sortBy}
                sortDirection={sortDirection}
                profiles={customQueryActive ? [] : stats}
                profileTotalRows={datasetRowCount}
                resultLabel={customQueryActive ? 'Query result' : 'Pipeline result'}
                resultRowCount={datasetRowCount}
                onPageChange={changePage}
                pageOffset={page.offset}
                pageLimit={page.limit}
                pageTotalRows={page.totalRows}
                profilesEnabled={!customQueryActive}
                profilesLoading={!customQueryActive && statsLoading}
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
              {fillDialog && (
                <div className="modal-backdrop" role="presentation">
                  <form
                    noValidate
                    className="fill-dialog"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="fill-dialog-title"
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') {
                        event.preventDefault();
                        event.stopPropagation();
                        closeFillDialog();
                      }
                      if (event.key !== 'Tab') return;
                      const controls = event.currentTarget.querySelectorAll<HTMLElement>(
                        'input, button:not(:disabled)',
                      );
                      const first = controls[0];
                      const last = controls[controls.length - 1];
                      if (
                        event.shiftKey
                          ? document.activeElement === first
                          : document.activeElement === last
                      ) {
                        event.preventDefault();
                        (event.shiftKey ? last : first)?.focus();
                      }
                    }}
                    onSubmit={(event) => {
                      event.preventDefault();
                      const type =
                        columns.find((item) => item.name === fillDialog.column)?.type ?? 'VARCHAR';
                      const isText = /VARCHAR|TEXT|STRING|CHAR/i.test(type);
                      const isNumeric = /INT|DOUBLE|FLOAT|REAL|DECIMAL/i.test(type);
                      const isBoolean = /BOOL/i.test(type);
                      const isDate = /DATE|TIME/i.test(type);
                      if (isText && !fillDialog.value.trim()) {
                        setFillError('Enter a replacement value.');
                        return;
                      }
                      if (isNumeric && !/^-?(?:\d+\.?\d*|\.\d+)$/.test(fillDialog.value.trim())) {
                        setFillError(`Enter a valid number for ${type}.`);
                        return;
                      }
                      if (isBoolean && !/^(true|false)$/i.test(fillDialog.value.trim())) {
                        setFillError('Enter true or false.');
                        return;
                      }
                      if (isDate && Number.isNaN(Date.parse(fillDialog.value.trim()))) {
                        setFillError(`Enter a valid ${type} value.`);
                        return;
                      }
                      transform('fill_nulls', {
                        column: fillDialog.column,
                        value: fillDialog.value,
                      });
                      setFillDialog(null);
                      setInspection(null);
                      inspectionActive.current = false;
                    }}
                  >
                    <h2 id="fill-dialog-title">Fill missing values</h2>
                    <p>
                      {qualityIssues
                        .find(
                          (issue) => issue.kind === 'nulls' && issue.column === fillDialog.column,
                        )
                        ?.count.toLocaleString() ?? 'Some'}{' '}
                      cells in <strong>{fillDialog.column}</strong> will change. No rows will be
                      removed.
                    </p>
                    <label htmlFor="fill-value">
                      Replacement value ·{' '}
                      {columns.find((item) => item.name === fillDialog.column)?.type}
                    </label>
                    <input
                      id="fill-value"
                      autoFocus
                      value={fillDialog.value}
                      onChange={(event) => {
                        setFillError(null);
                        setFillDialog({ ...fillDialog, value: event.target.value });
                      }}
                    />
                    {fillError && <p role="alert">{fillError}</p>}
                    <div className="form-actions">
                      <button type="button" onClick={closeFillDialog}>
                        Cancel
                      </button>
                      <button
                        className="form-apply-btn"
                        type="submit"
                        disabled={!fillDialog.value.trim() || loading}
                      >
                        Apply
                      </button>
                    </div>
                  </form>
                </div>
              )}
            </>
          ) : (
            <div className="empty-state">
              <div className="empty-icon">
                <span className="codicon codicon-table" aria-hidden="true" />
              </div>
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
