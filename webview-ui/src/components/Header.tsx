import React from 'react';
import type { ViewTab } from '../types';

interface HeaderProps {
  fileName: string;
  rowCount: number;
  columnCount: number;
  isLoading: boolean;
  activeTab: ViewTab;
  onTabChange: (tab: ViewTab) => void;
  onRefresh: () => void;
}

const TABS: Array<{ id: ViewTab; label: string }> = [
  { id: 'data', label: 'Data View' },
  { id: 'transform', label: 'Transform' },
  { id: 'export', label: 'Export' },
];

export const Header: React.FC<HeaderProps> = React.memo(
  ({ fileName, rowCount, columnCount, isLoading, activeTab, onTabChange, onRefresh }) => {
    return (
      <header className="header">
        <div className="header-top">
          <div className="header-title">
            <span className="quack-icon">🦆</span>
            <h1 className="file-name">{fileName || 'QuackWrangler'}</h1>
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
        <nav className="header-tabs">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              className={`tab-btn ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => onTabChange(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </header>
    );
  }
);

Header.displayName = 'Header';
