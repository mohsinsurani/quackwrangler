import React, { useState, useCallback, useMemo } from 'react';
import type { ColumnInfo, ExportConfig, ExportFormat } from '../types';

interface ExportPanelProps {
  columns: ColumnInfo[];
  config: ExportConfig;
  onExport: (config: ExportConfig) => void;
  onCopyCode: (code: string) => void;
}

const FORMAT_OPTIONS: Array<{ value: ExportFormat; label: string; description: string; icon: string }> = [
  { value: 'parquet', label: 'Parquet', description: 'Columnar binary format, efficient for analytics', icon: '📊' },
  { value: 'csv', label: 'CSV', description: 'Comma-separated values, universal compatibility', icon: '📄' },
  { value: 'json', label: 'JSON', description: 'JavaScript Object Notation, nested structure support', icon: '{ }' },
  { value: 'sql', label: 'SQL', description: 'SQL INSERT statements for database import', icon: '🗃' },
  { value: 'excel', label: 'Excel', description: 'Microsoft Excel .xlsx format', icon: '📗' },
];

function generateCodePreview(config: ExportConfig, columns: ColumnInfo[]): string {
  const colNames = columns.map((c) => c.name);

  switch (config.format) {
    case 'csv': {
      const header = colNames.join(config.delimiter || ',');
      return `${header}\n<row_data>  # ${columns.length} columns × N rows\n\n# Python (pandas)\ndf.to_csv('${config.sqlTableName || 'output'}.csv', sep='${config.delimiter || ','}', index=False)`;
    }
    case 'json': {
      return `[\n  {\n${colNames.map((c) => `    "${c}": <value>`).join(',\n')}\n  },\n  ...\n]\n\n# Python (pandas)\ndf.to_json('${config.sqlTableName || 'output'}.json', orient='records', indent=2)`;
    }
    case 'parquet': {
      return `# Apache Parquet format\n# Columns: ${colNames.join(', ')}\n\n# Python (pandas + pyarrow)\ndf.to_parquet('${config.sqlTableName || 'output'}.parquet', engine='pyarrow', compression='snappy')`;
    }
    case 'sql': {
      const tableName = config.sqlTableName || 'my_table';
      const colList = colNames.join(', ');
      const placeholders = colNames.map(() => '?').join(', ');
      return `CREATE TABLE ${tableName} (\n${columns.map((c) => `  ${c.name} ${c.dataType === 'number' ? 'DECIMAL' : c.dataType === 'boolean' ? 'BOOLEAN' : 'VARCHAR'}`).join(',\n')}\n);\n\nINSERT INTO ${tableName} (${colList})\nVALUES (${placeholders});`;
    }
    case 'excel': {
      return `# Excel export\n# Columns: ${colNames.join(', ')}\n\n# Python (pandas + openpyxl)\ndf.to_excel('${config.sqlTableName || 'output'}.xlsx', index=False, sheet_name='Sheet1')`;
    }
    default:
      return '';
  }
}

export const ExportPanel: React.FC<ExportPanelProps> = React.memo(
  ({ columns, config, onExport, onCopyCode }) => {
    const [copied, setCopied] = useState(false);

    const codePreview = useMemo(() => generateCodePreview(config, columns), [config, columns]);

    const handleFormatChange = useCallback(
      (format: ExportFormat) => {
        onExport({ ...config, format });
      },
      [config, onExport]
    );

    const handleDestinationChange = useCallback(
      (destination: 'file' | 'notebook') => {
        onExport({ ...config, destination });
      },
      [config, onExport]
    );

    const handleOptionChange = useCallback(
      (key: string, value: unknown) => {
        onExport({ ...config, [key]: value });
      },
      [config, onExport]
    );

    const handleCopy = useCallback(() => {
      onCopyCode(codePreview);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }, [codePreview, onCopyCode]);

    const handleExport = useCallback(() => {
      onExport(config);
    }, [config, onExport]);

    return (
      <div className="export-panel">
        <div className="export-sidebar">
          <div className="export-section">
            <h3 className="export-section-title">Export Format</h3>
            <div className="format-options">
              {FORMAT_OPTIONS.map((fmt) => (
                <button
                  key={fmt.value}
                  className={`format-option ${config.format === fmt.value ? 'selected' : ''}`}
                  onClick={() => handleFormatChange(fmt.value)}
                >
                  <span className="format-icon">{fmt.icon}</span>
                  <div className="format-info">
                    <span className="format-label">{fmt.label}</span>
                    <span className="format-description">{fmt.description}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="export-section">
            <h3 className="export-section-title">Destination</h3>
            <div className="destination-options">
              <button
                className={`dest-option ${config.destination === 'file' ? 'selected' : ''}`}
                onClick={() => handleDestinationChange('file')}
              >
                <span className="dest-icon">💾</span>
                <span className="dest-label">File</span>
              </button>
              <button
                className={`dest-option ${config.destination === 'notebook' ? 'selected' : ''}`}
                onClick={() => handleDestinationChange('notebook')}
              >
                <span className="dest-icon">📓</span>
                <span className="dest-label">Notebook</span>
              </button>
            </div>
          </div>

          <div className="export-section">
            <h3 className="export-section-title">Options</h3>
            <div className="option-group">
              <label className="option-label">
                <input
                  type="checkbox"
                  checked={config.includeHeaders}
                  onChange={(e) => handleOptionChange('includeHeaders', e.target.checked)}
                />
                Include headers
              </label>
            </div>
            {config.format === 'csv' && (
              <div className="option-group">
                <label className="option-label">Delimiter</label>
                <select
                  className="option-select"
                  value={config.delimiter}
                  onChange={(e) => handleOptionChange('delimiter', e.target.value)}
                >
                  <option value=",">Comma (,)</option>
                  <option value=";">Semicolon (;)</option>
                  <option value="\t">Tab</option>
                  <option value="|">Pipe (|)</option>
                </select>
              </div>
            )}
            {(config.format === 'sql' || config.destination === 'notebook') && (
              <div className="option-group">
                <label className="option-label">Table Name</label>
                <input
                  className="option-input"
                  type="text"
                  value={config.sqlTableName}
                  onChange={(e) => handleOptionChange('sqlTableName', e.target.value)}
                  placeholder="table_name"
                />
              </div>
            )}
          </div>
        </div>

        <div className="export-main">
          <div className="code-preview-section">
            <div className="code-preview-header">
              <h3>Code Preview</h3>
              <button
                className={`copy-btn ${copied ? 'copied' : ''}`}
                onClick={handleCopy}
              >
                {copied ? '✓ Copied' : '📋 Copy'}
              </button>
            </div>
            <pre className="code-preview">{codePreview}</pre>
          </div>

          <div className="export-summary">
            <div className="summary-row">
              <span className="summary-label">Format</span>
              <span className="summary-value">{FORMAT_OPTIONS.find((f) => f.value === config.format)?.label}</span>
            </div>
            <div className="summary-row">
              <span className="summary-label">Columns</span>
              <span className="summary-value">{columns.length}</span>
            </div>
            <div className="summary-row">
              <span className="summary-label">Destination</span>
              <span className="summary-value">{config.destination === 'file' ? 'File System' : 'Jupyter Notebook'}</span>
            </div>
          </div>

          <button className="export-btn" onClick={handleExport}>
            Export Data
          </button>
        </div>
      </div>
    );
  }
);

ExportPanel.displayName = 'ExportPanel';
