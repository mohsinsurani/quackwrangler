import React, { useEffect, useState } from 'react';

interface QueryConsoleProps {
  loading: boolean;
  active: boolean;
  onRun: (sql: string) => void;
  onClear: () => void;
}

export const QueryConsole: React.FC<QueryConsoleProps> = ({ loading, active, onRun, onClear }) => {
  const [sql, setSql] = useState('SELECT * FROM current_data LIMIT 100');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (active) setOpen(true);
  }, [active]);

  return (
    <section className={`query-console ${open ? 'open' : ''}`}>
      <button className="query-console-toggle" type="button" onClick={() => setOpen(value => !value)}>
        <span><b>⌘</b> Custom DuckDB query</span>
        <span className="query-console-chevron">›</span>
      </button>
      {open && (
        <div className="query-console-body">
          <textarea
            value={sql}
            onChange={event => setSql(event.target.value)}
            onKeyDown={event => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault();
                if (sql.trim() && !loading) onRun(sql);
              }
            }}
            spellCheck={false}
            aria-label="Custom DuckDB SQL"
          />
          <div className="query-console-actions">
            <span>Query <code>current_data</code> · ⌘/Ctrl+Enter to run</span>
            {active && <button type="button" onClick={onClear} disabled={loading}>Return to pipeline</button>}
            <button className="primary-button" type="button" onClick={() => onRun(sql)} disabled={loading || !sql.trim()}>
              {loading ? 'Running…' : 'Run query'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
};
