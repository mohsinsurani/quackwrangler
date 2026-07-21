import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { ColumnInfo, TableRow, SortState, SortDirection } from '../types';

interface DataGridProps {
  columns: ColumnInfo[];
  rows: TableRow[];
  sort: SortState | null;
  selectedRows: Set<number>;
  expandedCell: { rowId: number; column: string } | null;
  totalRows: number;
  onSortChange: (sort: SortState | null) => void;
  onRowSelection: (selectedRows: Set<number>) => void;
  onCellExpand: (cell: { rowId: number; column: string } | null) => void;
  onLoadMoreRows: (startIndex: number, endIndex: number) => void;
}

const ROW_HEIGHT = 32;
const OVERSCAN = 20;

export const DataGrid: React.FC<DataGridProps> = React.memo(
  ({
    columns,
    rows,
    sort,
    selectedRows,
    expandedCell,
    totalRows,
    onSortChange,
    onRowSelection,
    onCellExpand,
    onLoadMoreRows,
  }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
    const [resizingColumn, setResizingColumn] = useState<string | null>(null);
    const [resizeStartX, setResizeStartX] = useState(0);
    const [resizeStartWidth, setResizeStartWidth] = useState(0);
    const lastLoadedRange = useRef({ start: 0, end: 0 });

    const defaultWidth = useMemo(() => {
      if (columns.length === 0) return 150;
      const containerWidth = containerRef.current?.clientWidth || 800;
      return Math.max(100, Math.floor((containerWidth - 40) / columns.length));
    }, [columns.length]);

    const getWidth = useCallback(
      (colName: string) => columnWidths[colName] || defaultWidth,
      [columnWidths, defaultWidth]
    );

    const rowVirtualizer = useVirtualizer({
      count: totalRows,
      getScrollElement: () => containerRef.current,
      estimateSize: () => ROW_HEIGHT,
      overscan: OVERSCAN,
    });

    useEffect(() => {
      const virtualItems = rowVirtualizer.getVirtualItems();
      if (virtualItems.length === 0) return;

      const start = virtualItems[0].index;
      const end = virtualItems[virtualItems.length - 1].index;

      if (
        start < lastLoadedRange.current.start ||
        end > lastLoadedRange.current.end ||
        lastLoadedRange.current.end === 0
      ) {
        const bufferedStart = Math.max(0, start - 50);
        const bufferedEnd = Math.min(totalRows - 1, end + 50);
        lastLoadedRange.current = { start: bufferedStart, end: bufferedEnd };
        onLoadMoreRows(bufferedStart, bufferedEnd);
      }
    }, [rowVirtualizer.getVirtualItems(), totalRows, onLoadMoreRows]);

    const handleSort = useCallback(
      (columnName: string) => {
        if (!sort || sort.column !== columnName) {
          onSortChange({ column: columnName, direction: 'asc' });
        } else if (sort.direction === 'asc') {
          onSortChange({ column: columnName, direction: 'desc' });
        } else {
          onSortChange(null);
        }
      },
      [sort, onSortChange]
    );

    const handleRowClick = useCallback(
      (rowId: number, e: React.MouseEvent) => {
        if (e.shiftKey || e.metaKey || e.ctrlKey) {
          const next = new Set(selectedRows);
          if (next.has(rowId)) {
            next.delete(rowId);
          } else {
            next.add(rowId);
          }
          onRowSelection(next);
        } else {
          onRowSelection(new Set([rowId]));
        }
      },
      [selectedRows, onRowSelection]
    );

    const handleCellClick = useCallback(
      (rowId: number, column: string) => {
        if (expandedCell?.rowId === rowId && expandedCell?.column === column) {
          onCellExpand(null);
        } else {
          onCellExpand({ rowId, column });
        }
      },
      [expandedCell, onCellExpand]
    );

    const handleResizeStart = useCallback(
      (columnName: string, e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setResizingColumn(columnName);
        setResizeStartX(e.clientX);
        setResizeStartWidth(getWidth(columnName));
      },
      [getWidth]
    );

    useEffect(() => {
      if (!resizingColumn) return;

      const handleMouseMove = (e: MouseEvent) => {
        const delta = e.clientX - resizeStartX;
        const newWidth = Math.max(60, resizeStartWidth + delta);
        setColumnWidths((prev) => ({ ...prev, [resizingColumn]: newWidth }));
      };

      const handleMouseUp = () => {
        setResizingColumn(null);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }, [resizingColumn, resizeStartX, resizeStartWidth]);

    const formatCell = useCallback((value: unknown, dataType: string): string => {
      if (value === null || value === undefined) return '—';
      if (dataType === 'date') {
        try {
          return new Date(value as string).toLocaleDateString();
        } catch {
          return String(value);
        }
      }
      if (typeof value === 'number') {
        return value % 1 === 0 ? value.toLocaleString() : value.toFixed(4);
      }
      if (Array.isArray(value)) return `[${value.length} items]`;
      if (typeof value === 'object') return '{...}';
      const str = String(value);
      return str.length > 200 ? str.slice(0, 200) + '…' : str;
    }, []);

    const virtualItems = rowVirtualizer.getVirtualItems();
    const totalSize = rowVirtualizer.getTotalSize();

    return (
      <div className="data-grid-container">
        <div className="data-grid-header" role="row">
          <div className="grid-cell header-cell row-number-cell">#</div>
          <div
            className="grid-cell header-cell select-cell"
            onClick={() => {
              if (selectedRows.size === rows.length) {
                onRowSelection(new Set());
              } else {
                onRowSelection(new Set(rows.map((r) => r._id)));
              }
            }}
          >
            <input
              type="checkbox"
              checked={selectedRows.size === rows.length && rows.length > 0}
              onChange={() => {}}
              aria-label="Select all rows"
            />
          </div>
          {columns.map((col) => {
            const isSorted = sort?.column === col.name;
            const sortDir = isSorted ? sort?.direction : null;
            return (
              <div
                key={col.name}
                className={`grid-cell header-cell ${isSorted ? 'sorted' : ''}`}
                style={{ width: getWidth(col.name) }}
                onClick={() => handleSort(col.name)}
                role="columnheader"
                aria-sort={sortDir ? `${sortDir}-ascending` : 'none'}
              >
                <span className="header-text">{col.displayName}</span>
                <span className="sort-indicator">
                  {sortDir === 'asc' ? '↑' : sortDir === 'desc' ? '↓' : ''}
                </span>
                <div
                  className="resize-handle"
                  onMouseDown={(e) => handleResizeStart(col.name, e)}
                />
              </div>
            );
          })}
        </div>

        <div
          ref={containerRef}
          className="data-grid-body"
          role="grid"
          aria-rowcount={totalRows}
        >
          <div style={{ height: totalSize, position: 'relative' }}>
            {virtualItems.map((virtualRow) => {
              const row = rows[virtualRow.index];
              if (!row) return null;

              const isSelected = selectedRows.has(row._id);
              const isExpanded = expandedCell?.rowId === row._id;

              return (
                <div
                  key={row._id}
                  className={`grid-row ${isSelected ? 'selected' : ''} ${isExpanded ? 'expanded' : ''}`}
                  style={{
                    position: 'absolute',
                    top: virtualRow.start,
                    height: ROW_HEIGHT,
                    width: '100%',
                  }}
                  onClick={(e) => handleRowClick(row._id, e)}
                  role="row"
                  aria-rowindex={virtualRow.index + 1}
                >
                  <div className="grid-cell row-number-cell">{virtualRow.index + 1}</div>
                  <div className="grid-cell select-cell">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => handleRowClick(row._id, { metaKey: true } as React.MouseEvent)}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`Select row ${virtualRow.index + 1}`}
                    />
                  </div>
                  {columns.map((col) => {
                    const cellValue = row[col.name];
                    const isCellExpanded =
                      expandedCell?.rowId === row._id && expandedCell?.column === col.name;

                    return (
                      <div
                        key={col.name}
                        className={`grid-cell ${cellValue === null ? 'null-value' : ''} ${isCellExpanded ? 'cell-expanded' : ''}`}
                        style={{ width: getWidth(col.name) }}
                        onClick={() => handleCellClick(row._id, col.name)}
                        title={formatCell(cellValue, col.dataType)}
                      >
                        <span className="cell-content">
                          {formatCell(cellValue, col.dataType)}
                        </span>
                        {isCellExpanded && (
                          <div className="cell-expanded-view" onClick={(e) => e.stopPropagation()}>
                            <pre className="cell-expanded-content">
                              {cellValue === null
                                ? 'null'
                                : typeof cellValue === 'object'
                                  ? JSON.stringify(cellValue, null, 2)
                                  : String(cellValue)}
                            </pre>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>

        {rows.length === 0 && !resizingColumn && (
          <div className="empty-state">
            <div className="empty-icon">🦆</div>
            <p className="empty-text">No data to display</p>
          </div>
        )}
      </div>
    );
  }
);

DataGrid.displayName = 'DataGrid';
