import React, { useState, useCallback } from 'react';
import type { TransformStep, ColumnInfo } from '../types';

interface OperationsPanelProps {
  columns: ColumnInfo[];
  transformSteps: TransformStep[];
  onTransform: (type: string, params: Record<string, unknown>) => void;
  onExport: (format: 'parquet' | 'csv' | 'json') => void;
  onRemoveStep: (stepId: string) => void;
  onUndo: () => void;
  onRedo: () => void;
}

interface OperationCategory {
  name: string;
  icon: string;
  operations: OperationDef[];
}

interface OperationDef {
  id: string;
  name: string;
  icon: string;
  params: ParamDef[];
}

interface ParamDef {
  name: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'column';
  required: boolean;
  options?: Array<{ label: string; value: string }>;
  defaultValue?: unknown;
}

const OPERATION_CATEGORIES: OperationCategory[] = [
  {
    name: 'Filter',
    icon: '🔍',
    operations: [
      {
        id: 'filter_rows',
        name: 'Filter Rows',
        icon: '🔍',
        params: [
          { name: 'column', label: 'Column', type: 'column', required: true },
          {
            name: 'operator', label: 'Operator', type: 'select', required: true, defaultValue: 'equals',
            options: [
              { label: 'Equals (=)', value: 'equals' },
              { label: 'Does not equal (≠)', value: 'not_equals' },
              { label: 'Contains', value: 'contains' },
              { label: "Doesn't contain", value: 'not_contains' },
              { label: 'Starts with', value: 'starts_with' },
              { label: 'Ends with', value: 'ends_with' },
              { label: 'Greater than (>)', value: 'greater_than' },
              { label: 'Greater than or equal (≥)', value: 'greater_equals' },
              { label: 'Less than (<)', value: 'less_than' },
              { label: 'Less than or equal (≤)', value: 'less_equals' },
              { label: 'Between', value: 'between' },
              { label: 'In list', value: 'in' },
              { label: 'Not in list', value: 'not_in' },
              { label: 'Is null', value: 'is_null' },
              { label: 'Is not null', value: 'is_not_null' },
            ],
          },
          { name: 'value', label: 'Value', type: 'text', required: false },
          { name: 'value2', label: 'Upper value', type: 'text', required: false },
        ],
      },
      {
        id: 'deduplicate',
        name: 'Remove Duplicates',
        icon: '✨',
        params: [
          { name: 'columns', label: 'Columns', type: 'column', required: true },
        ],
      },
    ],
  },
  {
    name: 'Transform',
    icon: '🔄',
    operations: [
      {
        id: 'rename_column',
        name: 'Rename Column',
        icon: '✏️',
        params: [
          { name: 'oldName', label: 'From', type: 'column', required: true },
          { name: 'newName', label: 'To', type: 'text', required: true },
        ],
      },
      {
        id: 'drop_column',
        name: 'Drop Column',
        icon: '🗑️',
        params: [
          { name: 'column', label: 'Column', type: 'column', required: true },
        ],
      },
      {
        id: 'add_column',
        name: 'Add Column',
        icon: '➕',
        params: [
          { name: 'name', label: 'Name', type: 'text', required: true },
          { name: 'expression', label: 'Expression', type: 'text', required: true },
        ],
      },
      {
        id: 'cast_type',
        name: 'Cast Type',
        icon: '🔀',
        params: [
          { name: 'column', label: 'Column', type: 'column', required: true },
          {
            name: 'targetType',
            label: 'Type',
            type: 'select',
            required: true,
            options: [
              { label: 'String', value: 'VARCHAR' },
              { label: 'Integer', value: 'INTEGER' },
              { label: 'Float', value: 'DOUBLE' },
              { label: 'Boolean', value: 'BOOLEAN' },
              { label: 'Date', value: 'DATE' },
              { label: 'Timestamp', value: 'TIMESTAMP' },
            ],
          },
        ],
      },
      {
        id: 'fill_nulls',
        name: 'Fill Nulls',
        icon: '🔧',
        params: [
          { name: 'column', label: 'Column', type: 'column', required: true },
          { name: 'value', label: 'Fill Value', type: 'text', required: true },
        ],
      },
      {
        id: 'sort_rows',
        name: 'Sort',
        icon: '↕️',
        params: [
          { name: 'column', label: 'Column', type: 'column', required: true },
          {
            name: 'direction',
            label: 'Direction',
            type: 'select',
            required: true,
            options: [
              { label: 'Ascending', value: 'ASC' },
              { label: 'Descending', value: 'DESC' },
            ],
          },
        ],
      },
    ],
  },
  {
    name: 'Aggregate',
    icon: '📊',
    operations: [
      {
        id: 'aggregate',
        name: 'Group & Aggregate',
        icon: '📊',
        params: [
          { name: 'groupBy', label: 'Group By', type: 'column', required: false },
          {
            name: 'function', label: 'Function', type: 'select', required: true, defaultValue: 'COUNT',
            options: [
              { label: 'Count rows', value: 'COUNT' },
              { label: 'Count distinct', value: 'COUNT_DISTINCT' },
              { label: 'Sum', value: 'SUM' },
              { label: 'Average', value: 'AVG' },
              { label: 'Minimum', value: 'MIN' },
              { label: 'Maximum', value: 'MAX' },
            ],
          },
          { name: 'column', label: 'Value Column', type: 'column', required: false },
          { name: 'alias', label: 'Result Name', type: 'text', required: false },
        ],
      },
    ],
  },
  {
    name: 'Export',
    icon: '📤',
    operations: [
      {
        id: 'export_parquet',
        name: 'Export Parquet',
        icon: '📁',
        params: [],
      },
      {
        id: 'export_csv',
        name: 'Export CSV',
        icon: '📄',
        params: [],
      },
      {
        id: 'export_json',
        name: 'Export JSON',
        icon: '📋',
        params: [],
      },
    ],
  },
];

export const OperationsPanel: React.FC<OperationsPanelProps> = React.memo(
  ({ columns, transformSteps, onTransform, onExport, onRemoveStep, onUndo, onRedo }) => {
    const [selectedOp, setSelectedOp] = useState<OperationDef | null>(null);
    const [formData, setFormData] = useState<Record<string, unknown>>({});
    const [formError, setFormError] = useState('');
    const [draggedStep, setDraggedStep] = useState<string | null>(null);
    const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
      new Set(OPERATION_CATEGORIES.map((c) => c.name))
    );

    const toggleCategory = useCallback((name: string) => {
      setExpandedCategories((prev) => {
        const next = new Set(prev);
        if (next.has(name)) {
          next.delete(name);
        } else {
          next.add(name);
        }
        return next;
      });
    }, []);

    const handleSelectOp = useCallback((op: OperationDef) => {
      if (op.id.startsWith('export_')) {
        onExport(op.id.slice('export_'.length) as 'parquet' | 'csv' | 'json');
        return;
      }
      setSelectedOp(op);
      setFormError('');
      const initial: Record<string, unknown> = {};
      op.params.forEach((p) => {
        if (p.defaultValue !== undefined) {
          initial[p.name] = p.defaultValue;
        } else if (p.type === 'column' && p.required && columns.length > 0) {
          initial[p.name] = columns[0].name;
        } else {
          initial[p.name] = '';
        }
      });
      setFormData(initial);
    }, [columns, onExport]);

    const handleParamChange = useCallback((name: string, value: unknown) => {
      setFormError('');
      setFormData((prev) => ({ ...prev, [name]: value }));
    }, []);

    const handleSubmit = useCallback(() => {
      if (!selectedOp) return;
      const missingRequired = selectedOp.params.find(param =>
        param.required && String(formData[param.name] ?? '').trim() === '',
      );
      if (missingRequired) {
        setFormError(`${missingRequired.label} is required`);
        return;
      }
      if (selectedOp.id === 'filter_rows') {
        const operator = String(formData.operator || 'equals');
        if (!['is_null', 'is_not_null'].includes(operator) && String(formData.value ?? '').trim() === '') {
          setFormError('Value is required for this filter');
          return;
        }
        if (operator === 'between' && String(formData.value2 ?? '').trim() === '') {
          setFormError('Upper value is required for Between');
          return;
        }
      }
      if (selectedOp.id === 'aggregate' && String(formData.function || 'COUNT') !== 'COUNT' && !formData.column) {
        setFormError('Value Column is required for this aggregation');
        return;
      }
      onTransform(selectedOp.id, formData);
      setSelectedOp(null);
      setFormData({});
      setFormError('');
    }, [selectedOp, formData, onTransform]);

    const handleCancel = useCallback(() => {
      setSelectedOp(null);
      setFormData({});
      setFormError('');
    }, []);

    const handleDragStart = useCallback((stepId: string, e: React.DragEvent) => {
      setDraggedStep(stepId);
      e.dataTransfer.effectAllowed = 'move';
    }, []);

    const handleDragOver = useCallback((e: React.DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    }, []);

    const handleDrop = useCallback((targetId: string) => {
      if (!draggedStep || draggedStep === targetId) return;
      // Reordering is handled by parent
      setDraggedStep(null);
    }, [draggedStep]);

    const handleDragEnd = useCallback(() => {
      setDraggedStep(null);
    }, []);

    return (
      <div className="operations-panel">
        <div className="operations-header">
          <h3>Operations</h3>
          <div className="undo-redo-buttons">
            <button
              className="undo-btn"
              onClick={onUndo}
              disabled={transformSteps.length === 0}
              title="Undo last transform"
            >
              ↶
            </button>
            <button
              className="redo-btn"
              onClick={onRedo}
              title="Redo"
            >
              ↷
            </button>
          </div>
        </div>

        {transformSteps.length > 0 && (
          <div className="active-transforms">
            <div className="active-transforms-label">Active Transforms</div>
            <div className="transform-chips">
              {transformSteps.map((step, idx) => (
                <div
                  key={step.id}
                  className={`transform-chip ${draggedStep === step.id ? 'dragging' : ''}`}
                  draggable
                  onDragStart={(e) => handleDragStart(step.id, e)}
                  onDragOver={handleDragOver}
                  onDrop={() => handleDrop(step.id)}
                  onDragEnd={handleDragEnd}
                >
                  <span className="chip-index">{idx + 1}</span>
                  <span className="chip-name">{step.name}</span>
                  <button
                    className="chip-remove"
                    onClick={() => onRemoveStep(step.id)}
                    title="Remove transform"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="operations-categories">
          {OPERATION_CATEGORIES.map((category) => (
            <div key={category.name} className="operation-category">
              <button
                className="category-header"
                onClick={() => toggleCategory(category.name)}
              >
                <span className="category-icon">{category.icon}</span>
                <span className="category-name">{category.name}</span>
                <span className={`category-chevron ${expandedCategories.has(category.name) ? 'expanded' : ''}`}>
                  ›
                </span>
              </button>
              {expandedCategories.has(category.name) && (
                <div className="category-operations">
                  {category.operations.map((op) => (
                    <button
                      key={op.id}
                      className={`operation-btn ${selectedOp?.id === op.id ? 'selected' : ''}`}
                      onClick={() => handleSelectOp(op)}
                    >
                      <span className="op-icon">{op.icon}</span>
                      <span className="op-name">{op.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        {selectedOp && (
          <div className="operation-form">
            <div className="form-header">
              <span className="form-icon">{selectedOp.icon}</span>
              <span className="form-title">{selectedOp.name}</span>
              <button className="form-close" onClick={handleCancel}>×</button>
            </div>
            <div className="form-body">
              {selectedOp.params.length === 0 ? (
                <p className="form-no-params">No parameters required</p>
              ) : (
                selectedOp.params.filter(param => {
                  if (selectedOp.id === 'filter_rows') {
                    const operator = String(formData.operator || 'equals');
                    if (param.name === 'value') return !['is_null', 'is_not_null'].includes(operator);
                    if (param.name === 'value2') return operator === 'between';
                  }
                  if (selectedOp.id === 'aggregate' && param.name === 'column') {
                    return String(formData.function || 'COUNT') !== 'COUNT';
                  }
                  return true;
                }).map((param) => (
                  <div key={param.name} className="param-group">
                    <label className="param-label">
                      {param.label}
                      {param.required && <span className="required">*</span>}
                    </label>
                    {param.type === 'select' && param.options ? (
                      <select
                        className="param-select"
                        value={String(formData[param.name] || '')}
                        onChange={(e) => handleParamChange(param.name, e.target.value)}
                      >
                        <option value="">Select...</option>
                        {param.options.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    ) : param.type === 'column' ? (
                      <select
                        className="param-select"
                        value={String(formData[param.name] || '')}
                        onChange={(e) => handleParamChange(param.name, e.target.value)}
                      >
                        <option value="">Select column...</option>
                        {columns.map((col) => (
                          <option key={col.name} value={col.name}>
                            {col.displayName}
                          </option>
                        ))}
                      </select>
                    ) : param.type === 'number' ? (
                      <input
                        className="param-input"
                        type="number"
                        value={String(formData[param.name] || '')}
                        onChange={(e) => handleParamChange(param.name, Number(e.target.value))}
                        placeholder={`Enter ${param.label.toLowerCase()}...`}
                      />
                    ) : (
                      <input
                        className="param-input"
                        type="text"
                        value={String(formData[param.name] || '')}
                        onChange={(e) => handleParamChange(param.name, e.target.value)}
                        placeholder={`Enter ${param.label.toLowerCase()}...`}
                      />
                    )}
                  </div>
                ))
              )}
            </div>
            <div className="form-actions">
              {formError && <div className="form-validation-error" role="alert">{formError}</div>}
              <button className="form-cancel-btn" onClick={handleCancel}>
                Cancel
              </button>
              <button className="form-apply-btn" onClick={handleSubmit}>
                Apply
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }
);

OperationsPanel.displayName = 'OperationsPanel';
