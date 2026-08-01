import React, { useState, useCallback } from 'react';
import type { TransformStep, ColumnInfo } from '../types';

interface OperationsPanelProps {
  columns: ColumnInfo[];
  transformSteps: TransformStep[];
  onTransform: (type: string, params: Record<string, unknown>) => void;
  onExport: (format: 'parquet' | 'csv' | 'json') => void;
  onRemoveStep: (stepId: string) => void;
  onReorderSteps: (sourceId: string, targetId: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  onCollapse: () => void;
  secondaryFile?: { filePath: string; columns: string[] };
  onSelectSecondaryFile: () => void;
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
  type: 'text' | 'number' | 'select' | 'column' | 'secondary-column' | 'file';
  required: boolean;
  options?: Array<{ label: string; value: string }>;
  defaultValue?: unknown;
}

const FILTER_OPERATOR_OPTIONS = [
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
] as const;

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
            name: 'operator',
            label: 'Operator',
            type: 'select',
            required: true,
            defaultValue: 'equals',
            options: [...FILTER_OPERATOR_OPTIONS],
          },
          { name: 'value', label: 'Value', type: 'text', required: false },
          { name: 'value2', label: 'Upper value', type: 'text', required: false },
        ],
      },
      {
        id: 'deduplicate',
        name: 'Remove Duplicates',
        icon: '✨',
        params: [{ name: 'columns', label: 'Columns', type: 'column', required: true }],
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
        params: [{ name: 'column', label: 'Column', type: 'column', required: true }],
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
        id: 'formula_column',
        name: 'Formula Builder',
        icon: 'ƒ',
        params: [
          { name: 'name', label: 'New Column Name', type: 'text', required: true },
          {
            name: 'formula',
            label: 'Formula',
            type: 'select',
            required: true,
            defaultValue: 'if',
            options: [
              { label: 'IF condition', value: 'if' },
              { label: 'Date difference', value: 'date_diff' },
              { label: 'Extract text with regex', value: 'regex_extract' },
              { label: 'Combine text', value: 'concat' },
            ],
          },
          { name: 'column', label: 'Column', type: 'column', required: true },
          {
            name: 'operator',
            label: 'Condition',
            type: 'select',
            required: false,
            defaultValue: 'equals',
            options: FILTER_OPERATOR_OPTIONS.filter((option) =>
              [
                'equals',
                'not_equals',
                'greater_than',
                'greater_equals',
                'less_than',
                'less_equals',
                'contains',
                'is_null',
              ].includes(option.value),
            ),
          },
          { name: 'compareValue', label: 'Compare With', type: 'text', required: false },
          { name: 'trueValue', label: 'Value When True', type: 'text', required: false },
          { name: 'falseValue', label: 'Value When False', type: 'text', required: false },
          { name: 'secondColumn', label: 'End / Second Column', type: 'column', required: false },
          {
            name: 'unit',
            label: 'Date Unit',
            type: 'select',
            required: false,
            defaultValue: 'day',
            options: [
              { label: 'Days', value: 'day' },
              { label: 'Weeks', value: 'week' },
              { label: 'Months', value: 'month' },
              { label: 'Years', value: 'year' },
            ],
          },
          { name: 'pattern', label: 'Regex Pattern', type: 'text', required: false },
          {
            name: 'separator',
            label: 'Separator',
            type: 'text',
            required: false,
            defaultValue: ' ',
          },
        ],
      },
      {
        id: 'extract_nested',
        name: 'Extract Nested Field',
        icon: '⌁',
        params: [
          { name: 'column', label: 'Nested Column', type: 'column', required: true },
          {
            name: 'path',
            label: 'JSON Pointer (for example /metadata/id)',
            type: 'text',
            required: true,
          },
          { name: 'name', label: 'New Column Name', type: 'text', required: true },
        ],
      },
      {
        id: 'flatten_nested',
        name: 'Flatten Object',
        icon: '⇲',
        params: [
          { name: 'column', label: 'Object Column', type: 'column', required: true },
          { name: 'path', label: 'Nested JSON Pointer (optional)', type: 'text', required: false },
        ],
      },
      {
        id: 'explode_nested',
        name: 'Explode Array',
        icon: '⇵',
        params: [
          { name: 'column', label: 'Array Column', type: 'column', required: true },
          { name: 'path', label: 'Nested JSON Pointer (optional)', type: 'text', required: false },
          { name: 'name', label: 'Exploded Column Name', type: 'text', required: true },
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
            name: 'function',
            label: 'Function',
            type: 'select',
            required: true,
            defaultValue: 'COUNT',
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
      {
        id: 'pivot',
        name: 'Pivot',
        icon: '↔️',
        params: [
          { name: 'index', label: 'Row / Index Column', type: 'column', required: true },
          { name: 'column', label: 'Column to Pivot', type: 'column', required: true },
          { name: 'value', label: 'Value Column', type: 'column', required: true },
          {
            name: 'aggregate',
            label: 'Aggregation',
            type: 'select',
            required: true,
            defaultValue: 'SUM',
            options: [
              { label: 'Sum', value: 'SUM' },
              { label: 'Average', value: 'AVG' },
              { label: 'Minimum', value: 'MIN' },
              { label: 'Maximum', value: 'MAX' },
              { label: 'Count', value: 'COUNT' },
            ],
          },
        ],
      },
      {
        id: 'unpivot',
        name: 'Unpivot',
        icon: '↕️',
        params: [
          {
            name: 'columns',
            label: 'Value Columns (comma-separated)',
            type: 'text',
            required: true,
          },
          {
            name: 'nameColumn',
            label: 'Name Column',
            type: 'text',
            required: true,
            defaultValue: 'variable',
          },
          {
            name: 'valueColumn',
            label: 'Value Column',
            type: 'text',
            required: true,
            defaultValue: 'value',
          },
        ],
      },
    ],
  },
  {
    name: 'Combine Files',
    icon: '⑂',
    operations: [
      {
        id: 'join_file',
        name: 'Join Another File',
        icon: '⑂',
        params: [
          { name: 'filePath', label: 'Second File', type: 'file', required: true },
          {
            name: 'joinType',
            label: 'Join Type',
            type: 'select',
            required: true,
            defaultValue: 'LEFT',
            options: [
              { label: 'Left join', value: 'LEFT' },
              { label: 'Inner join', value: 'INNER' },
              { label: 'Right join', value: 'RIGHT' },
              { label: 'Full join', value: 'FULL' },
            ],
          },
          { name: 'leftColumn', label: 'Column in Current File', type: 'column', required: true },
          {
            name: 'rightColumn',
            label: 'Column in Second File',
            type: 'secondary-column',
            required: true,
          },
        ],
      },
      {
        id: 'union_file',
        name: 'Append / Union File',
        icon: '↧',
        params: [{ name: 'filePath', label: 'File to Append', type: 'file', required: true }],
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
  ({
    columns,
    transformSteps,
    onTransform,
    onExport,
    onRemoveStep,
    onReorderSteps,
    onUndo,
    onRedo,
    onCollapse,
    secondaryFile,
    onSelectSecondaryFile,
  }) => {
    const [selectedOp, setSelectedOp] = useState<OperationDef | null>(null);
    const [formData, setFormData] = useState<Record<string, unknown>>({});
    const [formError, setFormError] = useState('');
    const [draggedStep, setDraggedStep] = useState<string | null>(null);
    const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
      new Set(OPERATION_CATEGORIES.map((c) => c.name)),
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

    const handleSelectOp = useCallback(
      (op: OperationDef) => {
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
      },
      [columns, onExport],
    );

    const handleParamChange = useCallback((name: string, value: unknown) => {
      setFormError('');
      setFormData((prev) => ({ ...prev, [name]: value }));
    }, []);

    React.useEffect(() => {
      if (!selectedOp || !['join_file', 'union_file'].includes(selectedOp.id) || !secondaryFile)
        return;
      setFormData((current) => ({
        ...current,
        filePath: secondaryFile.filePath,
        ...(selectedOp.id === 'join_file' && !current.rightColumn
          ? { rightColumn: secondaryFile.columns[0] ?? '' }
          : {}),
      }));
    }, [secondaryFile, selectedOp]);

    const handleSubmit = useCallback(() => {
      if (!selectedOp) return;
      const missingRequired = selectedOp.params.find(
        (param) => param.required && String(formData[param.name] ?? '').trim() === '',
      );
      if (missingRequired) {
        setFormError(`${missingRequired.label} is required`);
        return;
      }
      if (selectedOp.id === 'filter_rows') {
        const operator = String(formData.operator || 'equals');
        if (
          !['is_null', 'is_not_null'].includes(operator) &&
          String(formData.value ?? '').trim() === ''
        ) {
          setFormError('Value is required for this filter');
          return;
        }
        if (operator === 'between' && String(formData.value2 ?? '').trim() === '') {
          setFormError('Upper value is required for Between');
          return;
        }
      }
      if (
        selectedOp.id === 'aggregate' &&
        String(formData.function || 'COUNT') !== 'COUNT' &&
        !formData.column
      ) {
        setFormError('Value Column is required for this aggregation');
        return;
      }
      if (selectedOp.id === 'formula_column') {
        const formula = String(formData.formula || 'if');
        if (
          formula === 'if' &&
          String(formData.operator) !== 'is_null' &&
          !String(formData.compareValue ?? '').trim()
        ) {
          setFormError('Compare With is required for this condition');
          return;
        }
        if (
          formula === 'if' &&
          !String(formData.trueValue ?? '').trim() &&
          !String(formData.falseValue ?? '').trim()
        ) {
          setFormError('Enter at least one result value');
          return;
        }
        if ((formula === 'date_diff' || formula === 'concat') && !formData.secondColumn) {
          setFormError('End / Second Column is required');
          return;
        }
        if (formula === 'regex_extract' && !String(formData.pattern ?? '').trim()) {
          setFormError('Regex Pattern is required');
          return;
        }
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

    const handleDrop = useCallback(
      (targetId: string) => {
        if (!draggedStep || draggedStep === targetId) return;
        onReorderSteps(draggedStep, targetId);
        setDraggedStep(null);
      },
      [draggedStep, onReorderSteps],
    );

    const handleDragEnd = useCallback(() => {
      setDraggedStep(null);
    }, []);

    return (
      <div className="operations-panel">
        <div className="operations-header">
          <div className="operations-title">
            <h3>Operations</h3>
            <button
              className="operations-collapse"
              type="button"
              onClick={onCollapse}
              title="Collapse operations"
              aria-label="Collapse operations"
            >
              ‹
            </button>
          </div>
          <div className="undo-redo-buttons">
            <button
              className="undo-btn"
              onClick={onUndo}
              disabled={transformSteps.length === 0}
              title="Undo last transform"
            >
              ↶
            </button>
            <button className="redo-btn" onClick={onRedo} title="Redo">
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
              <button className="category-header" onClick={() => toggleCategory(category.name)}>
                <span className="category-icon">{category.icon}</span>
                <span className="category-name">{category.name}</span>
                <span
                  className={`category-chevron ${expandedCategories.has(category.name) ? 'expanded' : ''}`}
                >
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
              <button className="form-close" onClick={handleCancel}>
                ×
              </button>
            </div>
            <div className="form-body">
              {selectedOp.params.length === 0 ? (
                <p className="form-no-params">No parameters required</p>
              ) : (
                selectedOp.params
                  .filter((param) => {
                    if (selectedOp.id === 'filter_rows') {
                      const operator = String(formData.operator || 'equals');
                      if (param.name === 'value')
                        return !['is_null', 'is_not_null'].includes(operator);
                      if (param.name === 'value2') return operator === 'between';
                    }
                    if (selectedOp.id === 'aggregate' && param.name === 'column') {
                      return String(formData.function || 'COUNT') !== 'COUNT';
                    }
                    if (selectedOp.id === 'formula_column') {
                      const formula = String(formData.formula || 'if');
                      if (
                        ['operator', 'compareValue', 'trueValue', 'falseValue'].includes(param.name)
                      ) {
                        return (
                          formula === 'if' &&
                          !(param.name === 'compareValue' && formData.operator === 'is_null')
                        );
                      }
                      if (param.name === 'secondColumn')
                        return formula === 'date_diff' || formula === 'concat';
                      if (param.name === 'unit') return formula === 'date_diff';
                      if (param.name === 'pattern') return formula === 'regex_extract';
                      if (param.name === 'separator') return formula === 'concat';
                    }
                    return true;
                  })
                  .map((param) => (
                    <div key={param.name} className="param-group">
                      <label className="param-label">
                        {param.label}
                        {param.required && <span className="required">*</span>}
                      </label>
                      {param.type === 'file' ? (
                        <div className="file-param">
                          <input
                            className="param-input"
                            type="text"
                            readOnly
                            value={String(formData[param.name] || '')}
                            placeholder="No file selected"
                          />
                          <button type="button" onClick={onSelectSecondaryFile}>
                            Choose…
                          </button>
                        </div>
                      ) : param.type === 'select' && param.options ? (
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
                      ) : param.type === 'column' || param.type === 'secondary-column' ? (
                        <select
                          className="param-select"
                          value={String(formData[param.name] || '')}
                          onChange={(e) => handleParamChange(param.name, e.target.value)}
                        >
                          <option value="">Select column...</option>
                          {(param.type === 'secondary-column'
                            ? (secondaryFile?.columns ?? []).map((name) => ({
                                name,
                                displayName: name,
                              }))
                            : columns
                          ).map((col) => (
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
              {formError && (
                <div className="form-validation-error" role="alert">
                  {formError}
                </div>
              )}
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
  },
);

OperationsPanel.displayName = 'OperationsPanel';
