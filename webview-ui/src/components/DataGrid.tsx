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
const BUFFER_SIZE = 10;

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
    const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - BUFFER_SIZE);
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
    <div className="data-grid-container" ref={containerRef}>
      <div className="data-grid-header">
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
      </div>
      <div
        className="data-grid-body"
        onScroll={handleScroll}
        style={{ height: `calc(100% - ${ROW_HEIGHT}px)` }}
      >
        <div style={{ height: totalHeight, position: 'relative' }}>
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
    </div>
  );
};

export default DataGrid;
