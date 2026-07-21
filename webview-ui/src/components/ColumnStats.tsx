import React, { useMemo } from 'react';
import type { ColumnInfo } from '../types';

interface ColumnStatsProps {
  column: ColumnInfo;
  onRefresh: (columnName: string) => void;
}

function MiniHistogram({ histogram }: { histogram: NonNullable<ColumnInfo['stats']>[ 'histogram'] }) {
  if (!histogram || histogram.length === 0) return null;

  const maxCount = Math.max(...histogram.map((h) => h.count), 1);

  return (
    <div className="mini-histogram">
      {histogram.map((bin, i) => (
        <div
          key={i}
          className="histogram-bar"
          style={{ height: `${(bin.count / maxCount) * 100}%` }}
          title={`${bin.binStart.toFixed(2)} - ${bin.binEnd.toFixed(2)}: ${bin.count}`}
        />
      ))}
    </div>
  );
}

function TopValuesList({ topValues }: { topValues: NonNullable<ColumnInfo['stats']>[ 'topValues'] }) {
  if (!topValues || topValues.length === 0) return null;

  const maxCount = topValues[0]?.count || 1;

  return (
    <div className="top-values-list">
      {topValues.slice(0, 5).map((item, i) => (
        <div key={i} className="top-value-row">
          <span className="top-value-label" title={item.value}>
            {item.value.length > 30 ? item.value.slice(0, 30) + '…' : item.value}
          </span>
          <div className="top-value-bar-container">
            <div
              className="top-value-bar"
              style={{ width: `${(item.count / maxCount) * 100}%` }}
            />
            <span className="top-value-count">{item.count.toLocaleString()}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

export const ColumnStats: React.FC<ColumnStatsProps> = React.memo(({ column, onRefresh }) => {
  const stats = column.stats;

  const nullPercentage = useMemo(() => {
    if (column.totalRows === 0) return 0;
    return ((column.nullCount / column.totalRows) * 100).toFixed(1);
  }, [column.nullCount, column.totalRows]);

  const uniquePercentage = useMemo(() => {
    if (column.totalRows === 0) return 0;
    return ((column.uniqueCount / column.totalRows) * 100).toFixed(1);
  }, [column.uniqueCount, column.totalRows]);

  const isNumeric = column.dataType === 'number';

  return (
    <div className="column-stats-panel">
      <div className="stats-header">
        <h3 className="stats-title">Column Stats</h3>
        <button
          className="stats-refresh-btn"
          onClick={() => onRefresh(column.name)}
          title="Refresh statistics"
        >
          ↻
        </button>
      </div>

      <div className="stats-column-name">{column.displayName}</div>

      <div className="stats-section">
        <div className="stats-row">
          <span className="stats-label">Type</span>
          <span className="stats-value type-badge">{column.dataType}</span>
        </div>
        <div className="stats-row">
          <span className="stats-label">Total Rows</span>
          <span className="stats-value">{column.totalRows.toLocaleString()}</span>
        </div>
      </div>

      <div className="stats-section">
        <h4 className="stats-section-title">Null Values</h4>
        <div className="stats-row">
          <span className="stats-label">Count</span>
          <span className="stats-value">
            {column.nullCount.toLocaleString()} ({nullPercentage}%)
          </span>
        </div>
        <div className="stats-bar-container">
          <div
            className="stats-bar null-bar"
            style={{ width: `${nullPercentage}%` }}
          />
        </div>
      </div>

      <div className="stats-section">
        <h4 className="stats-section-title">Uniqueness</h4>
        <div className="stats-row">
          <span className="stats-label">Unique Values</span>
          <span className="stats-value">
            {column.uniqueCount.toLocaleString()} ({uniquePercentage}%)
          </span>
        </div>
        <div className="stats-bar-container">
          <div
            className="stats-bar unique-bar"
            style={{ width: `${uniquePercentage}%` }}
          />
        </div>
      </div>

      {isNumeric && stats && (
        <div className="stats-section">
          <h4 className="stats-section-title">Numeric Statistics</h4>
          <div className="stats-grid">
            {stats.min !== undefined && (
              <div className="stats-grid-item">
                <span className="stats-grid-label">Min</span>
                <span className="stats-grid-value">{Number(stats.min).toLocaleString()}</span>
              </div>
            )}
            {stats.max !== undefined && (
              <div className="stats-grid-item">
                <span className="stats-grid-label">Max</span>
                <span className="stats-grid-value">{Number(stats.max).toLocaleString()}</span>
              </div>
            )}
            {stats.mean !== undefined && (
              <div className="stats-grid-item">
                <span className="stats-grid-label">Mean</span>
                <span className="stats-grid-value">{stats.mean.toFixed(4)}</span>
              </div>
            )}
            {stats.std !== undefined && (
              <div className="stats-grid-item">
                <span className="stats-grid-label">Std Dev</span>
                <span className="stats-grid-value">{stats.std.toFixed(4)}</span>
              </div>
            )}
            {stats.median !== undefined && (
              <div className="stats-grid-item">
                <span className="stats-grid-label">Median</span>
                <span className="stats-grid-value">{stats.median.toLocaleString()}</span>
              </div>
            )}
            {stats.p25 !== undefined && stats.p75 !== undefined && (
              <div className="stats-grid-item">
                <span className="stats-grid-label">IQR</span>
                <span className="stats-grid-value">
                  {stats.p25.toLocaleString()} - {stats.p75.toLocaleString()}
                </span>
              </div>
            )}
          </div>
          {stats.histogram && <MiniHistogram histogram={stats.histogram} />}
        </div>
      )}

      {stats?.topValues && (
        <div className="stats-section">
          <h4 className="stats-section-title">Top Values</h4>
          <TopValuesList topValues={stats.topValues} />
        </div>
      )}

      {!stats && (
        <div className="stats-loading">
          <button className="stats-load-btn" onClick={() => onRefresh(column.name)}>
            Load detailed statistics
          </button>
        </div>
      )}
    </div>
  );
});

ColumnStats.displayName = 'ColumnStats';
