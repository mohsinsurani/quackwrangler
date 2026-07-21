import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { useVSCodeAPI } from './hooks/useVSCodeAPI';
import { Header } from './components/Header';
import { DataGrid } from './components/DataGrid';
import { ColumnStats } from './components/ColumnStats';
import { FilterPanel } from './components/FilterPanel';
import { TransformPanel } from './components/TransformPanel';
import { ExportPanel } from './components/ExportPanel';
import type {
  DataFrameInfo,
  TableRow,
  FilterState,
  SortState,
  ViewTab,
  TransformStep,
  ExportConfig,
  ColumnInfo,
} from './types';

interface AppState {
  isLoading: boolean;
  error: string | null;
  dataFrame: DataFrameInfo | null;
  rows: TableRow[];
  columns: ColumnInfo[];
  filters: FilterState;
  sort: SortState | null;
  selectedRows: Set<number>;
  expandedCell: { rowId: number; column: string } | null;
  transformSteps: TransformStep[];
  activeTab: ViewTab;
  exportConfig: ExportConfig;
}

const INITIAL_FILTER_STATE: FilterState = { filters: [], appliedFilters: [] };

const INITIAL_EXPORT_CONFIG: ExportConfig = {
  format: 'parquet',
  destination: 'file',
  includeHeaders: true,
  delimiter: ',',
  encoding: 'utf-8',
  sqlTableName: 'table',
};

const INITIAL_STATE: AppState = {
  isLoading: true,
  error: null,
  dataFrame: null,
  rows: [],
  columns: [],
  filters: INITIAL_FILTER_STATE,
  sort: null,
  selectedRows: new Set(),
  expandedCell: null,
  transformSteps: [],
  activeTab: 'data',
  exportConfig: INITIAL_EXPORT_CONFIG,
};

export const App: React.FC = () => {
  const { postMessage, sendRequest, onMessage, setState: persistState, getState } = useVSCodeAPI();

  const [state, setAppState] = useState<AppState>(() => {
    const saved = getState<AppState>();
    if (saved) {
      return {
        ...INITIAL_STATE,
        ...saved,
        selectedRows: new Set(saved.selectedRows as unknown as number[]),
        isLoading: true,
      };
    }
    return INITIAL_STATE;
  });

  const updateState = useCallback(
    (partial: Partial<AppState>) => {
      setAppState((prev) => {
        const next = { ...prev, ...partial };
        persistState({
          ...next,
          selectedRows: Array.from(next.selectedRows),
          isLoading: false,
        });
        return next;
      });
    },
    [persistState]
  );

  useEffect(() => {
    const cleanup = onMessage((message) => {
      switch (message.type) {
        case 'dataFrameInfo': {
          const info = message.payload as DataFrameInfo;
          updateState({
            dataFrame: info,
            columns: info.columns,
            rows: info.preview || [],
            isLoading: false,
            error: null,
          });
          break;
        }
        case 'dataRows': {
          const payload = message.payload as { rows: TableRow[]; append?: boolean };
          setAppState((prev) => ({
            ...prev,
            rows: payload.append ? [...prev.rows, ...payload.rows] : payload.rows,
            isLoading: false,
          }));
          break;
        }
        case 'filteredRows': {
          const payload = message.payload as { rows: TableRow[]; total: number };
          updateState({ rows: payload.rows, isLoading: false });
          break;
        }
        case 'sortedRows': {
          const payload = message.payload as { rows: TableRow[] };
          updateState({ rows: payload.rows, isLoading: false });
          break;
        }
        case 'transformPreview': {
          const payload = message.payload as { stepId: string; preview: TransformStep['preview'] };
          setAppState((prev) => ({
            ...prev,
            transformSteps: prev.transformSteps.map((s) =>
              s.id === payload.stepId ? { ...s, preview: payload.preview } : s
            ),
          }));
          break;
        }
        case 'transformApplied': {
          const payload = message.payload as { steps: TransformStep[]; rows: TableRow[]; columns: ColumnInfo[] };
          updateState({
            transformSteps: payload.steps,
            rows: payload.rows,
            columns: payload.columns,
            isLoading: false,
          });
          break;
        }
        case 'undoApplied': {
          const payload = message.payload as { steps: TransformStep[]; rows: TableRow[]; columns: ColumnInfo[] };
          updateState({
            transformSteps: payload.steps,
            rows: payload.rows,
            columns: payload.columns,
            isLoading: false,
          });
          break;
        }
        case 'exportPreview': {
          const payload = message.payload as { code: string; format: string };
          setAppState((prev) => ({
            ...prev,
            exportConfig: { ...prev.exportConfig, codePreview: payload.code },
          }));
          break;
        }
        case 'error': {
          const payload = message.payload as { message: string };
          updateState({ error: payload.message, isLoading: false });
          break;
        }
        case 'loading': {
          updateState({ isLoading: true, error: null });
          break;
        }
      }
    });

    postMessage({ type: 'ready', payload: {} });

    return cleanup;
  }, [onMessage, postMessage, updateState]);

  const handleTabChange = useCallback(
    (tab: ViewTab) => {
      updateState({ activeTab: tab });
    },
    [updateState]
  );

  const handleRefresh = useCallback(() => {
    updateState({ isLoading: true, error: null });
    postMessage({ type: 'refresh', payload: {} });
  }, [postMessage, updateState]);

  const handleFilterChange = useCallback(
    (filters: FilterState) => {
      updateState({ filters, isLoading: true });
      postMessage({ type: 'applyFilters', payload: filters });
    },
    [postMessage, updateState]
  );

  const handleSortChange = useCallback(
    (sort: SortState | null) => {
      updateState({ sort, isLoading: true });
      postMessage({ type: 'applySort', payload: sort });
    },
    [postMessage, updateState]
  );

  const handleRowSelection = useCallback(
    (selectedRows: Set<number>) => {
      updateState({ selectedRows });
    },
    [updateState]
  );

  const handleCellExpand = useCallback(
    (cell: { rowId: number; column: string } | null) => {
      updateState({ expandedCell: cell });
    },
    [updateState]
  );

  const handleLoadMoreRows = useCallback(
    (startIndex: number, endIndex: number) => {
      postMessage({ type: 'loadRows', payload: { startIndex, endIndex } });
    },
    [postMessage]
  );

  const handleTransform = useCallback(
    (type: string, params: Record<string, unknown>) => {
      const step: TransformStep = {
        id: `step_${Date.now()}`,
        name: type,
        description: JSON.stringify(params),
        params,
        timestamp: Date.now(),
      };
      setAppState((prev) => ({
        ...prev,
        transformSteps: [...prev.transformSteps, step],
        isLoading: true,
      }));
      postMessage({ type: 'applyTransform', payload: { step } });
    },
    [postMessage]
  );

  const handlePreviewTransform = useCallback(
    (stepId: string) => {
      postMessage({ type: 'previewTransform', payload: { stepId } });
    },
    [postMessage]
  );

  const handleUndo = useCallback(() => {
    updateState({ isLoading: true });
    postMessage({ type: 'undo', payload: {} });
  }, [postMessage, updateState]);

  const handleRedo = useCallback(() => {
    updateState({ isLoading: true });
    postMessage({ type: 'redo', payload: {} });
  }, [postMessage, updateState]);

  const handleExport = useCallback(
    (config: ExportConfig) => {
      updateState({ exportConfig: config, isLoading: true });
      postMessage({ type: 'export', payload: config });
    },
    [postMessage, updateState]
  );

  const handleCopyCode = useCallback(
    (code: string) => {
      navigator.clipboard.writeText(code).catch((err) => {
        console.error('Failed to copy:', err);
      });
    },
    []
  );

  const handleColumnStatsRequest = useCallback(
    (columnName: string) => {
      postMessage({ type: 'getColumnStats', payload: { column: columnName } });
    },
    [postMessage]
  );

  const selectedColumn = useMemo(() => {
    if (state.expandedCell) {
      return state.columns.find((c) => c.name === state.expandedCell.column) || null;
    }
    return null;
  }, [state.expandedCell, state.columns]);

  return (
    <div className="app-container">
      <Header
        fileName={state.dataFrame?.fileName || ''}
        rowCount={state.dataFrame?.rowCount || state.rows.length}
        columnCount={state.dataFrame?.columnCount || state.columns.length}
        isLoading={state.isLoading}
        activeTab={state.activeTab}
        onTabChange={handleTabChange}
        onRefresh={handleRefresh}
      />

      {state.error && (
        <div className="error-banner">
          <span className="error-icon">!</span>
          <span className="error-message">{state.error}</span>
          <button className="error-dismiss" onClick={() => updateState({ error: null })}>
            Dismiss
          </button>
        </div>
      )}

      <div className="main-content">
        {state.activeTab === 'data' && (
          <>
            <div className="grid-area">
              <DataGrid
                columns={state.columns}
                rows={state.rows}
                sort={state.sort}
                selectedRows={state.selectedRows}
                expandedCell={state.expandedCell}
                totalRows={state.dataFrame?.rowCount || 0}
                onSortChange={handleSortChange}
                onRowSelection={handleRowSelection}
                onCellExpand={handleCellExpand}
                onLoadMoreRows={handleLoadMoreRows}
              />
            </div>
            <div className="side-panel">
              <FilterPanel
                columns={state.columns}
                filters={state.filters}
                onFilterChange={handleFilterChange}
              />
              {selectedColumn && (
                <ColumnStats
                  column={selectedColumn}
                  onRefresh={handleColumnStatsRequest}
                />
              )}
            </div>
          </>
        )}

        {state.activeTab === 'transform' && (
          <TransformPanel
            columns={state.columns}
            steps={state.transformSteps}
            onTransform={handleTransform}
            onPreview={handlePreviewTransform}
            onUndo={handleUndo}
            onRedo={handleRedo}
          />
        )}

        {state.activeTab === 'export' && (
          <ExportPanel
            columns={state.columns}
            config={state.exportConfig}
            onExport={handleExport}
            onCopyCode={handleCopyCode}
          />
        )}
      </div>
    </div>
  );
};
