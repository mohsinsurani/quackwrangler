import React from 'react';

import type { DatabaseInfo, DatabaseTable } from '../types';

interface HeaderProps {
  fileName: string;
  database?: DatabaseInfo;
  onSelectTable?: (table: DatabaseTable) => void;
  rowCount: number;
  columnCount: number;
  isLoading: boolean;
  aiLoading?: boolean;
  onRefresh: () => void;
  onCancel?: () => void;
  onGenerateAI: () => void;
}

export const Header: React.FC<HeaderProps> = React.memo(
  ({
    fileName,
    database,
    onSelectTable,
    rowCount,
    columnCount,
    isLoading,
    aiLoading = false,
    onRefresh,
    onCancel,
    onGenerateAI,
  }) => {
    const tableKey = (table: DatabaseTable): string => `${table.schema}\u0000${table.name}`;
    const tableLabel = (table: DatabaseTable): string => {
      const name = table.schema === 'main' ? table.name : `${table.schema}.${table.name}`;
      return table.view ? `${name} (view)` : name;
    };
    return (
      <header className="header">
        <div className="header-top">
          <div className="header-title">
            <span className="quack-icon codicon codicon-table" aria-hidden="true" />
            <h1 className="file-name">{fileName || 'QuackWrangler'}</h1>
            {database && onSelectTable && (
              <div className="table-switcher">
                <span className="codicon codicon-database" aria-hidden="true" />
                <select
                  className="table-select"
                  aria-label="Table"
                  title={
                    database.textColumns
                      ? 'This table mixes text and numbers in some columns, so every column is read as text.'
                      : `Choose a table from this ${database.kind === 'sqlite' ? 'SQLite' : 'DuckDB'} database`
                  }
                  value={tableKey(database.selected)}
                  disabled={isLoading || database.tables.length < 2}
                  onChange={(event) => {
                    const next = database.tables.find(
                      (table) => tableKey(table) === event.target.value,
                    );
                    if (next) onSelectTable(next);
                  }}
                >
                  {database.tables.map((table) => (
                    <option key={tableKey(table)} value={tableKey(table)}>
                      {tableLabel(table)}
                    </option>
                  ))}
                </select>
                {database.textColumns && (
                  <span
                    className="table-notice"
                    title="This table mixes text and numbers in some columns, so every column is read as text."
                  >
                    all text
                  </span>
                )}
              </div>
            )}
            {fileName && (
              <div className="data-info">
                <span className="info-badge">{rowCount.toLocaleString()} rows</span>
                <span className="info-separator">·</span>
                <span className="info-badge">{columnCount.toLocaleString()} cols</span>
              </div>
            )}
          </div>
          <div className="header-actions">
            {isLoading && <div className="loading-spinner" aria-label="Loading" />}
            {isLoading && onCancel && (
              <button
                type="button"
                className="cancel-btn"
                onClick={onCancel}
                title="Stop what is running. Your data and steps stay as they were."
                aria-label="Cancel the current operation"
              >
                <span className="codicon codicon-debug-stop" aria-hidden="true" />
                <span>Cancel</span>
              </button>
            )}
            {fileName && (
              <button
                className="ai-plan-btn"
                onClick={onGenerateAI}
                disabled={isLoading || aiLoading}
                title={
                  aiLoading
                    ? 'AI plan in progress…'
                    : 'Describe a goal and let AI plan visual transforms'
                }
                aria-label={
                  aiLoading ? 'AI plan in progress' : 'Generate visual transforms with AI'
                }
                aria-busy={aiLoading}
              >
                <span
                  className={`ai-plan-icon codicon ${aiLoading ? 'codicon-loading codicon-modifier-spin' : 'codicon-sparkle'}`}
                  aria-hidden="true"
                />
                <span>{aiLoading ? 'AI planning…' : 'AI plan'}</span>
              </button>
            )}
            <button
              className="refresh-btn"
              onClick={onRefresh}
              disabled={isLoading}
              title="Refresh data"
            >
              <svg
                className={`refresh-icon ${isLoading ? 'spinning' : ''}`}
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="currentColor"
              >
                <path d="M13.485 1.929a1 1 0 0 1 .217 1.087l-1.5 5A1 1 0 0 1 11.25 7.5H1.25a1 1 0 0 1-.952-1.308l1.5-5a1 1 0 0 1 1.087-.217l.5.143a4.992 4.992 0 0 0-1.509 4.382h10.529a4.992 4.992 0 0 0-1.509-4.382l.5-.143a1 1 0 0 1 1.087.217l-1.5 5a1 1 0 0 1-.952.621H9.25v2h2a1 1 0 0 1 0 2h-2v2a1 1 0 0 1-2 0v-2h-2a1 1 0 0 1 0-2h2v-2H1.25a3 3 0 0 1-2.857-2.092l-1.5-5A3 3 0 0 1 .536.092l10 2.828a1 1 0 0 1-.051 1.009z" />
              </svg>
            </button>
          </div>
        </div>
      </header>
    );
  },
);

Header.displayName = 'Header';
