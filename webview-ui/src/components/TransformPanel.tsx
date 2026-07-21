import React, { useState, useCallback, useMemo } from 'react';
import type { ColumnInfo, TransformStep, TransformType } from '../types';

interface TransformPanelProps {
  columns: ColumnInfo[];
  steps: TransformStep[];
  onTransform: (type: TransformType, params: Record<string, unknown>) => void;
  onPreview: (stepId: string) => void;
  onUndo: () => void;
  onRedo: () => void;
}

interface TransformTemplate {
  type: TransformType;
  name: string;
  description: string;
  category: string;
}

const TRANSFORM_TEMPLATES: TransformTemplate[] = [
  { type: 'rename_column', name: 'Rename Column', description: 'Rename an existing column', category: 'Columns' },
  { type: 'drop_column', name: 'Drop Column', description: 'Remove a column from the dataset', category: 'Columns' },
  { type: 'add_column', name: 'Add Column', description: 'Create a new column with a formula', category: 'Columns' },
  { type: 'cast_type', name: 'Change Type', description: 'Convert column data type', category: 'Columns' },
  { type: 'merge_columns', name: 'Merge Columns', description: 'Combine multiple columns into one', category: 'Columns' },
  { type: 'split_column', name: 'Split Column', description: 'Split a column into multiple columns', category: 'Columns' },
  { type: 'filter_rows', name: 'Filter Rows', description: 'Keep or remove rows by condition', category: 'Rows' },
  { type: 'sort_rows', name: 'Sort Rows', description: 'Sort rows by one or more columns', category: 'Rows' },
  { type: 'deduplicate', name: 'Remove Duplicates', description: 'Remove duplicate rows', category: 'Rows' },
  { type: 'fill_nulls', name: 'Fill Nulls', description: 'Replace null values', category: 'Rows' },
  { type: 'aggregate', name: 'Aggregate', description: 'Group and aggregate data', category: 'Transform' },
  { type: 'pivot', name: 'Pivot', description: 'Reshape data from long to wide', category: 'Transform' },
  { type: 'unpivot', name: 'Unpivot', description: 'Reshape data from wide to long', category: 'Transform' },
];

const CATEGORIES = ['Columns', 'Rows', 'Transform'];

export const TransformPanel: React.FC<TransformPanelProps> = React.memo(
  ({ columns, steps, onTransform, onPreview, onUndo, onRedo }) => {
    const [selectedTemplate, setSelectedTemplate] = useState<TransformTemplate | null>(null);
    const [params, setParams] = useState<Record<string, unknown>>({});
    const [expandedStep, setExpandedStep] = useState<string | null>(null);

    const canUndo = steps.length > 0;
    const canRedo = false;

    const columnNames = useMemo(() => columns.map((c) => c.name), [columns]);

    const handleTemplateSelect = useCallback((template: TransformTemplate) => {
      setSelectedTemplate(template);
      setParams({});
    }, []);

    const handleParamChange = useCallback((key: string, value: unknown) => {
      setParams((prev) => ({ ...prev, [key]: value }));
    }, []);

    const handleApply = useCallback(() => {
      if (!selectedTemplate) return;
      onTransform(selectedTemplate.type, params);
      setSelectedTemplate(null);
      setParams({});
    }, [selectedTemplate, params, onTransform]);

    const handleCancel = useCallback(() => {
      setSelectedTemplate(null);
      setParams({});
    }, []);

    const renderParamForm = (template: TransformTemplate) => {
      switch (template.type) {
        case 'rename_column':
          return (
            <>
              <div className="param-group">
                <label className="param-label">Source Column</label>
                <select
                  className="param-select"
                  value={(params.source as string) || ''}
                  onChange={(e) => handleParamChange('source', e.target.value)}
                >
                  <option value="">Select column</option>
                  {columnNames.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              </div>
              <div className="param-group">
                <label className="param-label">New Name</label>
                <input
                  className="param-input"
                  type="text"
                  value={(params.newName as string) || ''}
                  onChange={(e) => handleParamChange('newName', e.target.value)}
                  placeholder="Enter new column name"
                />
              </div>
            </>
          );
        case 'drop_column':
          return (
            <div className="param-group">
              <label className="param-label">Column to Drop</label>
              <select
                className="param-select"
                value={(params.column as string) || ''}
                onChange={(e) => handleParamChange('column', e.target.value)}
              >
                <option value="">Select column</option>
                {columnNames.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </div>
          );
        case 'add_column':
          return (
            <>
              <div className="param-group">
                <label className="param-label">New Column Name</label>
                <input
                  className="param-input"
                  type="text"
                  value={(params.name as string) || ''}
                  onChange={(e) => handleParamChange('name', e.target.value)}
                  placeholder="Enter column name"
                />
              </div>
              <div className="param-group">
                <label className="param-label">Formula / Expression</label>
                <textarea
                  className="param-textarea"
                  value={(params.expression as string) || ''}
                  onChange={(e) => handleParamChange('expression', e.target.value)}
                  placeholder="e.g., col_a + col_b"
                  rows={3}
                />
              </div>
            </>
          );
        case 'filter_rows':
          return (
            <div className="param-group">
              <label className="param-label">Filter Expression</label>
              <textarea
                className="param-textarea"
                value={(params.condition as string) || ''}
                onChange={(e) => handleParamChange('condition', e.target.value)}
                placeholder="e.g., age > 18 AND status == 'active'"
                rows={3}
              />
            </div>
          );
        case 'sort_rows':
          return (
            <>
              <div className="param-group">
                <label className="param-label">Sort Column</label>
                <select
                  className="param-select"
                  value={(params.column as string) || ''}
                  onChange={(e) => handleParamChange('column', e.target.value)}
                >
                  <option value="">Select column</option>
                  {columnNames.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              </div>
              <div className="param-group">
                <label className="param-label">Direction</label>
                <select
                  className="param-select"
                  value={(params.direction as string) || 'asc'}
                  onChange={(e) => handleParamChange('direction', e.target.value)}
                >
                  <option value="asc">Ascending</option>
                  <option value="desc">Descending</option>
                </select>
              </div>
            </>
          );
        case 'fill_nulls':
          return (
            <>
              <div className="param-group">
                <label className="param-label">Column</label>
                <select
                  className="param-select"
                  value={(params.column as string) || ''}
                  onChange={(e) => handleParamChange('column', e.target.value)}
                >
                  <option value="">Select column</option>
                  {columnNames.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              </div>
              <div className="param-group">
                <label className="param-label">Fill Strategy</label>
                <select
                  className="param-select"
                  value={(params.strategy as string) || 'value'}
                  onChange={(e) => handleParamChange('strategy', e.target.value)}
                >
                  <option value="value">Custom Value</option>
                  <option value="mean">Mean</option>
                  <option value="median">Median</option>
                  <option value="mode">Mode</option>
                  <option value="forward">Forward Fill</option>
                  <option value="backward">Backward Fill</option>
                </select>
              </div>
              {(params.strategy === 'value' || !params.strategy) && (
                <div className="param-group">
                  <label className="param-label">Fill Value</label>
                  <input
                    className="param-input"
                    type="text"
                    value={(params.fillValue as string) || ''}
                    onChange={(e) => handleParamChange('fillValue', e.target.value)}
                    placeholder="Value to fill"
                  />
                </div>
              )}
            </>
          );
        case 'cast_type':
          return (
            <>
              <div className="param-group">
                <label className="param-label">Column</label>
                <select
                  className="param-select"
                  value={(params.column as string) || ''}
                  onChange={(e) => handleParamChange('column', e.target.value)}
                >
                  <option value="">Select column</option>
                  {columnNames.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              </div>
              <div className="param-group">
                <label className="param-label">Target Type</label>
                <select
                  className="param-select"
                  value={(params.targetType as string) || 'string'}
                  onChange={(e) => handleParamChange('targetType', e.target.value)}
                >
                  <option value="string">String</option>
                  <option value="number">Number</option>
                  <option value="boolean">Boolean</option>
                  <option value="date">Date</option>
                </select>
              </div>
            </>
          );
        case 'deduplicate':
          return (
            <div className="param-group">
              <label className="param-label">Columns to Check</label>
              <select
                className="param-select param-multi"
                multiple
                value={(params.columns as string[]) || []}
                onChange={(e) => {
                  const values = Array.from(e.target.selectedOptions, (o) => o.value);
                  handleParamChange('columns', values);
                }}
              >
                {columnNames.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </div>
          );
        case 'aggregate':
          return (
            <>
              <div className="param-group">
                <label className="param-label">Group By Columns</label>
                <select
                  className="param-select param-multi"
                  multiple
                  value={(params.groupBy as string[]) || []}
                  onChange={(e) => {
                    const values = Array.from(e.target.selectedOptions, (o) => o.value);
                    handleParamChange('groupBy', values);
                  }}
                >
                  {columnNames.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              </div>
              <div className="param-group">
                <label className="param-label">Aggregations (JSON)</label>
                <textarea
                  className="param-textarea"
                  value={(params.aggregations as string) || ''}
                  onChange={(e) => handleParamChange('aggregations', e.target.value)}
                  placeholder='{"column": "sum", "other_col": "mean"}'
                  rows={3}
                />
              </div>
            </>
          );
        default:
          return (
            <div className="param-group">
              <label className="param-label">Parameters (JSON)</label>
              <textarea
                className="param-textarea"
                value={(params.rawParams as string) || ''}
                onChange={(e) => handleParamChange('rawParams', e.target.value)}
                placeholder='{"key": "value"}'
                rows={4}
              />
            </div>
          );
      }
    };

    const getPreviewContent = (step: TransformStep) => {
      if (!step.preview) return null;

      return (
        <div className="step-preview">
          <div className="preview-stats">
            {step.preview.addedColumns.length > 0 && (
              <span className="preview-badge added">+{step.preview.addedColumns.length} columns</span>
            )}
            {step.preview.removedColumns.length > 0 && (
              <span className="preview-badge removed">-{step.preview.removedColumns.length} columns</span>
            )}
            {step.preview.addedRows > 0 && (
              <span className="preview-badge added">+{step.preview.addedRows} rows</span>
            )}
            {step.preview.removedRows > 0 && (
              <span className="preview-badge removed">-{step.preview.removedRows} rows</span>
            )}
            {step.preview.changedCells > 0 && (
              <span className="preview-badge changed">~{step.preview.changedCells} cells</span>
            )}
          </div>
        </div>
      );
    };

    return (
      <div className="transform-panel">
        <div className="transform-sidebar">
          <div className="transform-sidebar-header">
            <h3>Operations</h3>
            <div className="undo-redo-buttons">
              <button
                className="undo-btn"
                onClick={onUndo}
                disabled={!canUndo}
                title="Undo"
              >
                ↶
              </button>
              <button
                className="redo-btn"
                onClick={onRedo}
                disabled={!canRedo}
                title="Redo"
              >
                ↷
              </button>
            </div>
          </div>

          <div className="transform-templates">
            {CATEGORIES.map((category) => (
              <div key={category} className="template-category">
                <h4 className="category-title">{category}</h4>
                {TRANSFORM_TEMPLATES.filter((t) => t.category === category).map((template) => (
                  <button
                    key={template.type}
                    className={`template-btn ${selectedTemplate?.type === template.type ? 'selected' : ''}`}
                    onClick={() => handleTemplateSelect(template)}
                  >
                    <span className="template-name">{template.name}</span>
                    <span className="template-desc">{template.description}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>

        <div className="transform-main">
          <div className="transform-editor">
            {selectedTemplate ? (
              <>
                <div className="editor-header">
                  <h3>{selectedTemplate.name}</h3>
                  <p className="editor-description">{selectedTemplate.description}</p>
                </div>
                <div className="editor-form">
                  {renderParamForm(selectedTemplate)}
                </div>
                <div className="editor-actions">
                  <button className="editor-cancel-btn" onClick={handleCancel}>
                    Cancel
                  </button>
                  <button className="editor-apply-btn" onClick={handleApply}>
                    Apply Transform
                  </button>
                </div>
              </>
            ) : (
              <div className="editor-empty">
                <div className="empty-icon">🔧</div>
                <p>Select an operation from the sidebar</p>
                <p className="empty-hint">Choose a transform to begin shaping your data</p>
              </div>
            )}
          </div>

          <div className="step-history">
            <h3 className="history-title">
              Transform History
              {steps.length > 0 && <span className="history-count">{steps.length}</span>}
            </h3>
            {steps.length === 0 ? (
              <div className="history-empty">
                <p>No transforms applied yet</p>
              </div>
            ) : (
              <div className="history-list">
                {[...steps].reverse().map((step, i) => (
                  <div
                    key={step.id}
                    className={`history-item ${expandedStep === step.id ? 'expanded' : ''}`}
                  >
                    <div className="history-item-header">
                      <span className="history-index">#{steps.length - i}</span>
                      <span className="history-name">
                        {TRANSFORM_TEMPLATES.find((t) => t.type === step.name)?.name || step.name}
                      </span>
                      <button
                        className="history-expand-btn"
                        onClick={() => setExpandedStep(expandedStep === step.id ? null : step.id)}
                      >
                        {expandedStep === step.id ? '−' : '+'}
                      </button>
                    </div>
                    {expandedStep === step.id && (
                      <div className="history-item-details">
                        <pre className="history-params">
                          {JSON.stringify(step.params, null, 2)}
                        </pre>
                        {step.preview && getPreviewContent(step)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }
);

TransformPanel.displayName = 'TransformPanel';
