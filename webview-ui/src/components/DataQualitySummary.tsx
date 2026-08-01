import React, { useState } from 'react';

export interface QualityIssue {
  severity: 'warning' | 'info';
  kind: 'nulls' | 'duplicates' | 'outliers';
  message: string;
  column?: string;
  count: number;
}

interface DataQualitySummaryProps {
  issues: QualityIssue[];
  loading: boolean;
}

export const DataQualitySummary: React.FC<DataQualitySummaryProps> = ({ issues, loading }) => {
  const [open, setOpen] = useState(false);
  const status = loading
    ? 'Checking…'
    : issues.length
      ? `${issues.length} issue${issues.length === 1 ? '' : 's'}`
      : 'No detected issues';

  return (
    <section className={`quality-summary ${open ? 'open' : ''} ${issues.length ? 'has-issues' : 'clean'}`}>
      <button
        className="analysis-toggle"
        type="button"
        onClick={() => setOpen(value => !value)}
        aria-expanded={open}
        aria-label={`${open ? 'Collapse' : 'Expand'} data quality`}
      >
        <span className="analysis-toggle-title"><span className="analysis-icon">◇</span>Data quality</span>
        <span className="analysis-toggle-meta"><b>{status}</b><span className="analysis-chevron">›</span></span>
      </button>
      {open && (
        <div className="quality-issues">
          {issues.length ? issues.map((issue, index) => (
            <div className={`quality-issue ${issue.severity}`} key={`${issue.kind}-${issue.column ?? ''}-${index}`}>
              <span>{issue.kind === 'duplicates' ? '⧉' : issue.kind === 'nulls' ? '◌' : '◇'}</span>
              <p>{issue.message}</p>
            </div>
          )) : <p className="quality-clean">No nulls, duplicate rows, or IQR outliers were detected.</p>}
        </div>
      )}
    </section>
  );
};
