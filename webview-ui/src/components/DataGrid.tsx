import React, { useMemo, useCallback, useRef, useState, useEffect } from 'react';

import { ColumnProfiles, type ColumnProfile } from './ColumnProfiles';
import { NestedValueTree } from './NestedValueTree';

interface Column {
  name: string;
  type: string;
}

interface DataGridProps {
  columns: Column[];
  rows: unknown[][];
  sortBy?: string;
  sortDirection?: 'asc' | 'desc';
  onSort?: (column: string) => void;
  onCellClick?: (row: number, col: number, value: unknown) => void;
  selectedRows?: Set<number>;
  onRowSelect?: (row: number) => void;
  profiles?: ColumnProfile[];
  profileTotalRows?: number;
  profilesLoading?: boolean;
  profilesEnabled?: boolean;
  onQuickFilter?: (column: string, operator: string, value?: unknown) => void;
  onTransform?: (type: string, params: Record<string, unknown>) => void;
}

const ROW_HEIGHT = 28;
const PROFILE_HEIGHT = 126;
const HEADER_HEIGHT = 42;
const BUFFER_SIZE = 10;
type ColumnWidthMode = 'compact' | 'fit' | 'wide';
type CellDisplayMode = 'clip' | 'wrap';
export type RowCopyFormat = 'csv' | 'tsv' | 'pipe' | 'json';

export function calculateAutoFitWidth(values: unknown[]): number {
  const longest = values.reduce<number>(
    (maximum, value) =>
      Math.max(maximum, value === null || value === undefined ? 0 : String(value).length),
    0,
  );
  return Math.max(110, Math.min(600, Math.ceil(longest * 8.2 + 48)));
}

function jsonReplacer() {
  const seen = new WeakSet<object>();
  return (_key: string, nested: unknown): unknown => {
    if (typeof nested === 'bigint') return nested.toString();
    if (nested instanceof Map) return Object.fromEntries(nested);
    if (nested && typeof nested === 'object') {
      if (seen.has(nested)) return '[Circular]';
      seen.add(nested);
    }
    return nested;
  };
}

export function formatCellDetails(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'object') return String(value);
  try {
    return JSON.stringify(value, jsonReplacer(), 2);
  } catch {
    return String(value);
  }
}

export function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'object') return String(value);
  try {
    const json = JSON.stringify(value, jsonReplacer());
    const prefix = Array.isArray(value)
      ? `${value.length} item${value.length === 1 ? '' : 's'} · `
      : '';
    return `${prefix}${json}`;
  } catch {
    return String(value);
  }
}

function delimitedCell(value: unknown, delimiter: string): string {
  const text = formatCellValue(value);
  const containsDelimiter = delimiter === ' | ' ? text.includes('|') : text.includes(delimiter);
  if (containsDelimiter || /["\r\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

export function serializeRow(row: unknown[], format: RowCopyFormat): string {
  if (format === 'json') {
    return JSON.stringify(row, jsonReplacer());
  }
  const delimiter = format === 'csv' ? ',' : format === 'pipe' ? ' | ' : '\t';
  return row.map((value) => delimitedCell(value, delimiter)).join(delimiter);
}

export function serializeRows(
  rows: unknown[][],
  columns: Column[],
  format: RowCopyFormat,
  includeHeaders: boolean,
): string {
  if (format === 'json') {
    if (includeHeaders) {
      return JSON.stringify(
        rows.map((row) =>
          Object.fromEntries(columns.map((column, index) => [column.name, row[index]])),
        ),
        jsonReplacer(),
        2,
      );
    }
    return JSON.stringify(rows, jsonReplacer(), 2);
  }
  const lines = rows.map((row) => serializeRow(row, format));
  if (includeHeaders) {
    lines.unshift(
      serializeRow(
        columns.map((column) => column.name),
        format,
      ),
    );
  }
  return lines.join('\n');
}

async function writeClipboardText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const copied = document.execCommand('copy');
    textarea.remove();
    if (!copied) throw new Error('Clipboard access was denied');
  }
}

export const DataGrid: React.FC<DataGridProps> = ({
  columns,
  rows,
  sortBy,
  sortDirection = 'asc',
  onSort,
  onCellClick,
  selectedRows = new Set(),
  onRowSelect,
  profiles = [],
  profileTotalRows = 0,
  profilesLoading = false,
  profilesEnabled = true,
  onQuickFilter,
  onTransform,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const resizingColumnRef = useRef(false);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(600);
  const [inspectedCell, setInspectedCell] = useState<{
    row: number;
    column: string;
    value: unknown;
  } | null>(null);
  const [columnWidthMode, setColumnWidthMode] = useState<ColumnWidthMode>('fit');
  const [columnWidths, setColumnWidths] = useState<Record<number, number>>({});
  const [rowCopyFormat, setRowCopyFormat] = useState<RowCopyFormat>('tsv');
  const [copyStatus, setCopyStatus] = useState('');
  const [localSelectedRows, setLocalSelectedRows] = useState<Set<number>>(new Set());
  const [includeHeaders, setIncludeHeaders] = useState(true);
  const [cellDisplayMode, setCellDisplayMode] = useState<CellDisplayMode>('clip');
  const [quickFilterMenu, setQuickFilterMenu] = useState<{
    x: number;
    y: number;
    column: string;
    value: unknown;
  } | null>(null);
  const effectiveSelectedRows = onRowSelect ? selectedRows : localSelectedRows;
  const rowHeight = cellDisplayMode === 'wrap' ? 54 : ROW_HEIGHT;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerHeight(entry.contentRect.height);
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!quickFilterMenu) return;
    const close = () => setQuickFilterMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('blur', close);
    };
  }, [quickFilterMenu]);

  const visibleRange = useMemo(() => {
    const bodyScrollTop = Math.max(
      0,
      scrollTop - (profilesEnabled ? PROFILE_HEIGHT : 0) - HEADER_HEIGHT,
    );
    const startIndex = Math.max(0, Math.floor(bodyScrollTop / rowHeight) - BUFFER_SIZE);
    const visibleCount = Math.ceil(containerHeight / rowHeight) + 2 * BUFFER_SIZE;
    const endIndex = Math.min(rows.length, startIndex + visibleCount);
    return { startIndex, endIndex };
  }, [scrollTop, containerHeight, rows.length, profilesEnabled, rowHeight]);

  const visibleRows = useMemo(() => {
    return rows.slice(visibleRange.startIndex, visibleRange.endIndex);
  }, [rows, visibleRange]);

  const totalHeight = rows.length * rowHeight;
  const presetWidth = columnWidthMode === 'compact' ? 110 : columnWidthMode === 'wide' ? 260 : 150;
  const columnTracks = columns.map((_, index) => {
    const customWidth = columnWidths[index];
    if (customWidth) return `${customWidth}px`;
    return columnWidthMode === 'fit' ? 'minmax(150px, 1fr)' : `${presetWidth}px`;
  });
  const gridTemplateColumns = `52px ${columnTracks.join(' ')}`;
  const gridMinWidth = `${52 + columns.reduce((total, _, index) => total + (columnWidths[index] ?? presetWidth), 0)}px`;

  const setWidthMode = useCallback((mode: ColumnWidthMode) => {
    setColumnWidthMode(mode);
    setColumnWidths({});
  }, []);

  const startColumnResize = useCallback(
    (index: number, event: React.MouseEvent<HTMLSpanElement>) => {
      event.preventDefault();
      event.stopPropagation();
      resizingColumnRef.current = true;
      const cell = event.currentTarget.parentElement;
      if (!cell) return;
      const startX = event.clientX;
      const startWidth = cell.getBoundingClientRect().width;
      const handleMove = (moveEvent: MouseEvent) => {
        setColumnWidths((current) => ({
          ...current,
          [index]: Math.max(80, Math.min(600, startWidth + moveEvent.clientX - startX)),
        }));
      };
      const handleUp = () => {
        window.removeEventListener('mousemove', handleMove);
        window.removeEventListener('mouseup', handleUp);
        // A browser click is dispatched after mouseup. Keep the resize guard
        // active until that click has had a chance to pass the header.
        window.setTimeout(() => {
          resizingColumnRef.current = false;
        }, 0);
      };
      window.addEventListener('mousemove', handleMove);
      window.addEventListener('mouseup', handleUp);
    },
    [],
  );

  const copyToClipboard = useCallback(async (text: string, status: string) => {
    await writeClipboardText(text);
    setCopyStatus(status);
    window.setTimeout(() => setCopyStatus(''), 1800);
  }, []);

  const toggleRowSelection = useCallback(
    (rowIndex: number) => {
      if (onRowSelect) {
        onRowSelect(rowIndex);
        return;
      }
      setLocalSelectedRows((current) => {
        const next = new Set(current);
        if (next.has(rowIndex)) next.delete(rowIndex);
        else next.add(rowIndex);
        return next;
      });
    },
    [onRowSelect],
  );

  const allRowsSelected = rows.length > 0 && effectiveSelectedRows.size === rows.length;
  const selectedRowIndexes = [...effectiveSelectedRows]
    .filter((index) => index >= 0 && index < rows.length)
    .sort((left, right) => left - right);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  const formatValue = useCallback((value: unknown, type: string): string => {
    if (value === null || value === undefined) return 'null';
    if (typeof value === 'object') return formatCellValue(value);
    if (type === 'DOUBLE' || type === 'FLOAT') {
      return typeof value === 'number' ? value.toFixed(2) : String(value);
    }
    if (type === 'TIMESTAMP') {
      return new Date(String(value)).toLocaleString();
    }
    return String(value);
  }, []);

  const suggestedColumnWidth = useCallback(
    (index: number): number => {
      const column = columns[index];
      if (!column) return 150;
      const profile = profiles.find((item) => item.name === column.name);
      return calculateAutoFitWidth([
        column.name,
        column.type,
        profile?.min,
        profile?.max,
        ...rows.map((row) => formatValue(row[index], column.type)),
      ]);
    },
    [columns, formatValue, profiles, rows],
  );

  const autoFitColumn = useCallback(
    (index: number) => {
      setColumnWidths((current) => ({ ...current, [index]: suggestedColumnWidth(index) }));
    },
    [suggestedColumnWidth],
  );

  const autoFitAllColumns = useCallback(() => {
    setColumnWidths(
      Object.fromEntries(columns.map((_, index) => [index, suggestedColumnWidth(index)])),
    );
  }, [columns, suggestedColumnWidth]);

  const getTypeClass = useCallback((type: string): string => {
    switch (type) {
      case 'INTEGER':
      case 'BIGINT':
      case 'SMALLINT':
        return 'type-number';
      case 'DOUBLE':
      case 'FLOAT':
        return 'type-float';
      case 'VARCHAR':
      case 'TEXT':
        return 'type-string';
      case 'BOOLEAN':
        return 'type-boolean';
      case 'TIMESTAMP':
      case 'DATE':
        return 'type-date';
      default:
        return '';
    }
  }, []);

  return (
    <div className="data-grid-container">
      <div className="data-grid-workspace">
        <div
          className={`data-grid-scroll ${cellDisplayMode === 'wrap' ? 'wrap-cells' : ''}`}
          ref={containerRef}
          onScroll={handleScroll}
        >
          {profilesEnabled && (
            <ColumnProfiles
              columns={columns}
              profiles={profiles}
              totalRows={profileTotalRows}
              loading={profilesLoading}
              gridTemplateColumns={gridTemplateColumns}
              minWidth={gridMinWidth}
            />
          )}
          <div
            className={`data-grid-row header-row ${profilesEnabled ? 'with-profiles' : ''}`}
            style={{ gridTemplateColumns, minWidth: gridMinWidth }}
          >
            <div className="data-grid-cell row-number">
              <input
                type="checkbox"
                checked={allRowsSelected}
                onChange={() => {
                  if (onRowSelect) {
                    rows.forEach((_, index) => {
                      if (allRowsSelected === selectedRows.has(index)) onRowSelect(index);
                    });
                  } else {
                    setLocalSelectedRows(
                      allRowsSelected ? new Set() : new Set(rows.map((_, index) => index)),
                    );
                  }
                }}
                aria-label={allRowsSelected ? 'Clear row selection' : 'Select all rows'}
                title={allRowsSelected ? 'Clear row selection' : 'Select all loaded rows'}
              />
            </div>
            {columns.map((col, colIndex) => (
              <div
                key={col.name}
                className={`data-grid-cell header-cell ${sortBy === col.name ? 'sorted' : ''}`}
                onClick={(event) => {
                  if (
                    resizingColumnRef.current ||
                    (event.target as HTMLElement).closest('.column-resizer, .column-autofit')
                  )
                    return;
                  onSort?.(col.name);
                }}
              >
                <span className="column-name">{col.name}</span>
                <span className="column-type">{col.type}</span>
                <button
                  className="column-autofit"
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    autoFitColumn(colIndex);
                  }}
                  aria-label={`Auto-fit ${col.name} column`}
                  title={`Auto-fit ${col.name} to its content`}
                >
                  ↔
                </button>
                {sortBy === col.name && (
                  <span className="sort-indicator">{sortDirection === 'asc' ? ' ↑' : ' ↓'}</span>
                )}
                <span
                  className="column-resizer"
                  role="separator"
                  aria-label={`Resize ${col.name} column`}
                  onMouseDown={(event) => startColumnResize(colIndex, event)}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  onDoubleClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    autoFitColumn(colIndex);
                  }}
                  title="Drag to resize · Double-click to auto-fit"
                />
              </div>
            ))}
          </div>
          <div className="data-grid-body" style={{ height: totalHeight, minWidth: gridMinWidth }}>
            <div
              style={{
                position: 'absolute',
                top: visibleRange.startIndex * rowHeight,
                width: '100%',
              }}
            >
              {visibleRows.map((row, localIndex) => {
                const rowIndex = visibleRange.startIndex + localIndex;
                const isSelected = effectiveSelectedRows.has(rowIndex);
                return (
                  <div
                    key={rowIndex}
                    className={`data-grid-row ${isSelected ? 'selected' : ''}`}
                    style={{ gridTemplateColumns, minWidth: gridMinWidth, height: rowHeight }}
                    onClick={() => onRowSelect?.(rowIndex)}
                  >
                    <div className="data-grid-cell row-number">
                      <label className="row-selector">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleRowSelection(rowIndex)}
                          onClick={(event) => event.stopPropagation()}
                          aria-label={`Select row ${rowIndex + 1}`}
                        />
                        <span className="row-number-label">{rowIndex + 1}</span>
                      </label>
                    </div>
                    {row.map((cell, colIndex) => {
                      const cellText = formatValue(cell, columns[colIndex]?.type || '');
                      const canInspect =
                        (cell !== null && typeof cell === 'object') || cellText.length > 18;
                      return (
                        <div
                          key={colIndex}
                          className={`data-grid-cell ${getTypeClass(columns[colIndex]?.type || '')} ${
                            cell === null ? 'null-value' : ''
                          }`}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (canInspect) {
                              setInspectedCell({
                                row: rowIndex,
                                column: columns[colIndex]?.name ?? `Column ${colIndex + 1}`,
                                value: cell,
                              });
                            }
                            onCellClick?.(rowIndex, colIndex, cell);
                          }}
                          title={cellText}
                          onContextMenu={(event) => {
                            if (!onQuickFilter) return;
                            event.preventDefault();
                            event.stopPropagation();
                            setQuickFilterMenu({
                              x: Math.min(event.clientX, window.innerWidth - 230),
                              y: Math.min(event.clientY, window.innerHeight - 230),
                              column: columns[colIndex]?.name ?? `Column ${colIndex + 1}`,
                              value: cell,
                            });
                          }}
                        >
                          <span className="cell-value">{cellText}</span>
                          {canInspect && (
                            <span className="metadata-badge">
                              {cell !== null && typeof cell === 'object' ? 'View' : 'More'}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        {inspectedCell && (
          <aside className="cell-inspector" aria-label={`Inspect ${inspectedCell.column}`}>
            <header>
              <div>
                <strong>{inspectedCell.column}</strong>
                <span>Row {inspectedCell.row + 1} · complete value</span>
              </div>
              <button
                type="button"
                onClick={() => setInspectedCell(null)}
                aria-label="Close cell inspector"
              >
                ×
              </button>
            </header>
            {inspectedCell.value !== null && typeof inspectedCell.value === 'object' ? (
              <NestedValueTree
                value={inspectedCell.value}
                column={inspectedCell.column}
                onTransform={
                  onTransform
                    ? (type, params) => {
                        onTransform(type, params);
                        setInspectedCell(null);
                      }
                    : undefined
                }
                onCopy={(text, status) => void copyToClipboard(text, status)}
              />
            ) : (
              <pre>{formatCellDetails(inspectedCell.value)}</pre>
            )}
            <footer>
              <button
                type="button"
                onClick={() =>
                  void copyToClipboard(formatCellDetails(inspectedCell.value), 'Value copied')
                }
              >
                Copy value
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={() => setInspectedCell(null)}
              >
                Close
              </button>
            </footer>
          </aside>
        )}
        {quickFilterMenu && (
          <div
            className="quick-filter-menu"
            role="menu"
            aria-label={`Quick filter ${quickFilterMenu.column}`}
            style={{ left: quickFilterMenu.x, top: quickFilterMenu.y }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="quick-filter-title">
              <span>Filter {quickFilterMenu.column}</span>
              <small>{formatCellValue(quickFilterMenu.value)}</small>
            </div>
            {quickFilterMenu.value === null || quickFilterMenu.value === undefined ? (
              <>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onQuickFilter?.(quickFilterMenu.column, 'is_null');
                    setQuickFilterMenu(null);
                  }}
                >
                  Is null
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onQuickFilter?.(quickFilterMenu.column, 'is_not_null');
                    setQuickFilterMenu(null);
                  }}
                >
                  Is not null
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onQuickFilter?.(quickFilterMenu.column, 'equals', quickFilterMenu.value);
                    setQuickFilterMenu(null);
                  }}
                >
                  Keep rows equal to this value
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onQuickFilter?.(quickFilterMenu.column, 'not_equals', quickFilterMenu.value);
                    setQuickFilterMenu(null);
                  }}
                >
                  Exclude this value
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onQuickFilter?.(quickFilterMenu.column, 'contains', quickFilterMenu.value);
                    setQuickFilterMenu(null);
                  }}
                >
                  Contains this value
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onQuickFilter?.(quickFilterMenu.column, 'is_null');
                    setQuickFilterMenu(null);
                  }}
                >
                  Show null values
                </button>
              </>
            )}
          </div>
        )}
      </div>
      <div className="data-grid-footer">
        <span className="row-count">{rows.length.toLocaleString()} rows</span>
        <span className="col-count">{columns.length} columns</span>
        <span className="selected-count">
          {selectedRowIndexes.length.toLocaleString()} selected
        </span>
        {copyStatus && (
          <span className="copy-status" role="status">
            {copyStatus}
          </span>
        )}
        <label className="include-headers">
          <input
            type="checkbox"
            checked={includeHeaders}
            onChange={(event) => setIncludeHeaders(event.target.checked)}
          />
          Headers
        </label>
        <label className="row-copy-format">
          Row copy
          <select
            value={rowCopyFormat}
            onChange={(event) => setRowCopyFormat(event.target.value as RowCopyFormat)}
            aria-label="Row copy format"
          >
            <option value="tsv">TSV</option>
            <option value="csv">CSV</option>
            <option value="pipe">Pipe</option>
            <option value="json">JSON</option>
          </select>
        </label>
        <button
          className="copy-selected-button"
          type="button"
          disabled={selectedRowIndexes.length === 0}
          onClick={() => {
            const selected = selectedRowIndexes.map((index) => rows[index]);
            void copyToClipboard(
              serializeRows(selected, columns, rowCopyFormat, includeHeaders),
              `${selected.length} row${selected.length === 1 ? '' : 's'} copied`,
            );
          }}
        >
          Copy selected
        </button>
        <div className="column-width-controls" role="group" aria-label="Table column width">
          <button
            type="button"
            className={
              Object.keys(columnWidths).length === columns.length && columns.length > 0
                ? 'active'
                : ''
            }
            onClick={autoFitAllColumns}
            title="Size every column to its longest loaded value"
          >
            Auto-fit
          </button>
          {(['compact', 'fit', 'wide'] as ColumnWidthMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              className={
                columnWidthMode === mode && Object.keys(columnWidths).length === 0 ? 'active' : ''
              }
              onClick={() => setWidthMode(mode)}
            >
              {mode[0].toUpperCase() + mode.slice(1)}
            </button>
          ))}
        </div>
        <div className="cell-display-controls" role="group" aria-label="Cell content display">
          {(['clip', 'wrap'] as CellDisplayMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              className={cellDisplayMode === mode ? 'active' : ''}
              onClick={() => setCellDisplayMode(mode)}
              title={
                mode === 'wrap'
                  ? 'Wrap long cell values onto two lines'
                  : 'Keep rows compact and clip long values'
              }
            >
              {mode === 'wrap' ? 'Wrap' : 'Clip'}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default DataGrid;
