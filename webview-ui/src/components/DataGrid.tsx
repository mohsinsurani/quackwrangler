import React, { useMemo, useCallback, useRef, useState, useEffect } from 'react';

interface Column {
  name: string;
  type: string;
}

interface DataGridProps {
  columns: Column[];
  rows: any[][];
  sortBy?: string;
  sortDirection?: 'asc' | 'desc';
  onSort?: (column: string) => void;
  onCellClick?: (row: number, col: number, value: any) => void;
  selectedRows?: Set<number>;
  onRowSelect?: (row: number) => void;
}

const ROW_HEIGHT = 32;
const HEADER_HEIGHT = 52;
const BUFFER_SIZE = 10;

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
    const prefix = Array.isArray(value) ? `${value.length} item${value.length === 1 ? '' : 's'} · ` : '';
    return `${prefix}${json}`;
  } catch {
    return String(value);
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
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(600);
  const [inspectedCell, setInspectedCell] = useState<{ row: number; column: string; value: unknown } | null>(null);

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

  const visibleRange = useMemo(() => {
    const bodyScrollTop = Math.max(0, scrollTop - HEADER_HEIGHT);
    const startIndex = Math.max(0, Math.floor(bodyScrollTop / ROW_HEIGHT) - BUFFER_SIZE);
    const visibleCount = Math.ceil(containerHeight / ROW_HEIGHT) + 2 * BUFFER_SIZE;
    const endIndex = Math.min(rows.length, startIndex + visibleCount);
    return { startIndex, endIndex };
  }, [scrollTop, containerHeight, rows.length]);

  const visibleRows = useMemo(() => {
    return rows.slice(visibleRange.startIndex, visibleRange.endIndex);
  }, [rows, visibleRange]);

  const totalHeight = rows.length * ROW_HEIGHT;

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  const formatValue = useCallback((value: any, type: string): string => {
    if (value === null || value === undefined) return 'null';
    if (typeof value === 'object') return formatCellValue(value);
    if (type === 'DOUBLE' || type === 'FLOAT') {
      return typeof value === 'number' ? value.toFixed(2) : String(value);
    }
    if (type === 'TIMESTAMP') {
      return new Date(value).toLocaleString();
    }
    return String(value);
  }, []);

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
      <div className="data-grid-scroll" ref={containerRef} onScroll={handleScroll}>
        <div className="data-grid-row header-row">
          <div className="data-grid-cell row-number">#</div>
          {columns.map((col) => (
            <div
              key={col.name}
              className={`data-grid-cell header-cell ${sortBy === col.name ? 'sorted' : ''}`}
              onClick={() => onSort?.(col.name)}
            >
              <span className="column-name">{col.name}</span>
              <span className="column-type">{col.type}</span>
              {sortBy === col.name && (
                <span className="sort-indicator">{sortDirection === 'asc' ? ' ↑' : ' ↓'}</span>
              )}
            </div>
          ))}
        </div>
        <div className="data-grid-body" style={{ height: totalHeight }}>
          <div
            style={{
              position: 'absolute',
              top: visibleRange.startIndex * ROW_HEIGHT,
              width: '100%',
            }}
          >
            {visibleRows.map((row, localIndex) => {
              const rowIndex = visibleRange.startIndex + localIndex;
              const isSelected = selectedRows.has(rowIndex);
              return (
                <div
                  key={rowIndex}
                  className={`data-grid-row ${isSelected ? 'selected' : ''}`}
                  onClick={() => onRowSelect?.(rowIndex)}
                >
                  <div className="data-grid-cell row-number">{rowIndex + 1}</div>
                  {row.map((cell, colIndex) => (
                    <div
                      key={colIndex}
                      className={`data-grid-cell ${getTypeClass(columns[colIndex]?.type || '')} ${
                        cell === null ? 'null-value' : ''
                      }`}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (cell !== null && typeof cell === 'object') {
                          setInspectedCell({ row: rowIndex, column: columns[colIndex]?.name ?? `Column ${colIndex + 1}`, value: cell });
                        }
                        onCellClick?.(rowIndex, colIndex, cell);
                      }}
                      title={formatValue(cell, columns[colIndex]?.type || '')}
                    >
                      {formatValue(cell, columns[colIndex]?.type || '')}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className="data-grid-footer">
        <span className="row-count">{rows.length.toLocaleString()} rows</span>
        <span className="col-count">{columns.length} columns</span>
      </div>
      {inspectedCell && (
        <div className="cell-inspector-backdrop" role="presentation" onClick={() => setInspectedCell(null)}>
          <section className="cell-inspector" role="dialog" aria-modal="true" aria-label={`Inspect ${inspectedCell.column}`} onClick={event => event.stopPropagation()}>
            <header>
              <div><strong>{inspectedCell.column}</strong><span>Row {inspectedCell.row + 1} · nested value</span></div>
              <button type="button" onClick={() => setInspectedCell(null)} aria-label="Close cell inspector">×</button>
            </header>
            <pre>{formatCellDetails(inspectedCell.value)}</pre>
            <footer>
              <button type="button" onClick={() => navigator.clipboard.writeText(formatCellDetails(inspectedCell.value))}>Copy JSON</button>
              <button type="button" className="primary-button" onClick={() => setInspectedCell(null)}>Close</button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
};

export default DataGrid;
