import React, { useState, useCallback } from 'react';

import type { TransformStep, ColumnInfo } from '../types';

interface OperationsPanelProps {
  columns: ColumnInfo[];
  transformSteps: TransformStep[];
  canUndo: boolean;
  canRedo: boolean;
  onTransform: (type: string, params: Record<string, unknown>) => void;
  onRemoveStep: (stepId: string) => void;
  onReorderSteps: (sourceId: string, targetId: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  onCollapse: () => void;
  secondaryFile?: {
    filePath: string;
    columns: string[];
    table?: { schema: string; name: string };
  };
  onSelectSecondaryFile: () => void;
}

interface OperationCategory {
  name: string;
  operations: OperationDef[];
}

interface OperationDef {
  id: string;
  name: string;
  params: ParamDef[];
}

const operationCodicons: Record<string, string> = {
  filter_rows: 'filter',
  deduplicate: 'copy',
  rename_column: 'edit',
  drop_column: 'remove',
  add_column: 'add',
  formula_column: 'symbol-operator',
  extract_nested: 'symbol-field',
  flatten_nested: 'collapse-all',
  explode_nested: 'expand-all',
  cast_type: 'symbol-type-parameter',
  fill_nulls: 'beaker',
  sort_rows: 'sort-precedence',
  aggregate: 'graph',
  pivot: 'table',
  unpivot: 'table',
  join_file: 'combine',
  union_file: 'git-merge',
};

const categoryCodicons: Record<string, string> = {
  Filter: 'filter',
  Transform: 'tools',
  Aggregate: 'graph',
  'Combine Files': 'combine',
};

interface SortKeyValue {
  column: string;
  direction: 'ASC' | 'DESC';
}

/** An ordered list of sort keys: pick a column and direction for each, add or remove keys. */
function SortKeyEditor({
  id,
  columns,
  value,
  onChange,
}: {
  id: string;
  columns: ColumnInfo[];
  value: SortKeyValue[];
  onChange: (next: SortKeyValue[]) => void;
}): React.ReactElement {
  const used = new Set(value.map((key) => key.column));
  const available = columns.filter((column) => !used.has(column.name));
  const update = (index: number, patch: Partial<SortKeyValue>): void =>
    onChange(value.map((key, position) => (position === index ? { ...key, ...patch } : key)));
  return (
    <div id={id} className="sort-keys" role="group" aria-label="Sort keys">
      {value.map((key, index) => (
        <div key={index} className="sort-key-row">
          <span className="sort-key-rank" aria-hidden="true">
            {index + 1}
          </span>
          <select
            className="param-select"
            aria-label={`Sort key ${index + 1} column`}
            value={key.column}
            onChange={(event) => update(index, { column: event.target.value })}
          >
            {columns
              .filter((column) => column.name === key.column || !used.has(column.name))
              .map((column) => (
                <option key={column.name} value={column.name}>
                  {column.displayName}
                </option>
              ))}
          </select>
          <select
            className="param-select sort-direction"
            aria-label={`Sort key ${index + 1} direction`}
            value={key.direction}
            onChange={(event) => update(index, { direction: event.target.value as 'ASC' | 'DESC' })}
          >
            <option value="ASC">Ascending</option>
            <option value="DESC">Descending</option>
          </select>
          <button
            type="button"
            className="sort-key-remove"
            aria-label={`Remove sort key ${index + 1}`}
            disabled={value.length < 2}
            onClick={() => onChange(value.filter((_, position) => position !== index))}
          >
            <span className="codicon codicon-close" aria-hidden="true" />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="sort-key-add"
        disabled={available.length === 0}
        onClick={() => onChange([...value, { column: available[0].name, direction: 'ASC' }])}
      >
        <span className="codicon codicon-add" aria-hidden="true" /> Then by…
      </button>
    </div>
  );
}

function OperationIcon({ name, category = false }: { name: string; category?: boolean }) {
  const icon = category ? categoryCodicons[name] : operationCodicons[name];
  return <span className={`codicon codicon-${icon ?? 'circle-outline'}`} aria-hidden="true" />;
}

interface ParamDef {
  name: string;
  label: string;
  type:
    'text' | 'number' | 'select' | 'column' | 'columns' | 'sort-keys' | 'secondary-column' | 'file';
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
    operations: [
      {
        id: 'filter_rows',
        name: 'Filter Rows',
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
        // Leaving every column unticked compares whole rows.
        params: [
          {
            name: 'columns',
            label: 'Columns that make a row a duplicate (none = whole row)',
            type: 'columns',
            required: false,
          },
        ],
      },
    ],
  },
  {
    name: 'Transform',
    operations: [
      {
        id: 'rename_column',
        name: 'Rename Column',
        params: [
          { name: 'oldName', label: 'From', type: 'column', required: true },
          { name: 'newName', label: 'To', type: 'text', required: true },
        ],
      },
      {
        id: 'drop_column',
        name: 'Drop Columns',
        params: [{ name: 'columns', label: 'Columns to remove', type: 'columns', required: true }],
      },
      {
        id: 'add_column',
        name: 'Add Column',
        params: [
          { name: 'name', label: 'Name', type: 'text', required: true },
          { name: 'expression', label: 'Expression', type: 'text', required: true },
        ],
      },
      {
        id: 'formula_column',
        name: 'Formula Builder',
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
        params: [
          { name: 'column', label: 'Object Column', type: 'column', required: true },
          { name: 'path', label: 'Nested JSON Pointer (optional)', type: 'text', required: false },
        ],
      },
      {
        id: 'explode_nested',
        name: 'Explode Array',
        params: [
          { name: 'column', label: 'Array Column', type: 'column', required: true },
          { name: 'path', label: 'Nested JSON Pointer (optional)', type: 'text', required: false },
          { name: 'name', label: 'Exploded Column Name', type: 'text', required: true },
        ],
      },
      {
        id: 'cast_type',
        name: 'Cast Type',
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
        params: [
          { name: 'column', label: 'Column', type: 'column', required: true },
          { name: 'value', label: 'Fill Value', type: 'text', required: true },
        ],
      },
      {
        id: 'sort_rows',
        name: 'Sort',
        params: [
          { name: 'keys', label: 'Sort by (first column wins)', type: 'sort-keys', required: true },
        ],
      },
    ],
  },
  {
    name: 'Aggregate',
    operations: [
      {
        id: 'aggregate',
        name: 'Group & Aggregate',
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
    operations: [
      {
        id: 'join_file',
        name: 'Join Another File',
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
        params: [{ name: 'filePath', label: 'File to Append', type: 'file', required: true }],
      },
    ],
  },
];

export const OperationsPanel: React.FC<OperationsPanelProps> = React.memo(
  ({
    columns,
    transformSteps,
    canUndo,
    canRedo,
    onTransform,
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
    const [operationSearch, setOperationSearch] = useState('');
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
        setSelectedOp(op);
        setFormError('');
        const initial: Record<string, unknown> = {};
        op.params.forEach((p) => {
          if (p.defaultValue !== undefined) {
            initial[p.name] = p.defaultValue;
          } else if (p.type === 'column' && p.required && columns.length > 0) {
            initial[p.name] = columns[0].name;
          } else if (p.type === 'columns') {
            initial[p.name] = [];
          } else if (p.type === 'sort-keys') {
            initial[p.name] =
              columns.length > 0 ? [{ column: columns[0].name, direction: 'ASC' }] : [];
          } else {
            initial[p.name] = '';
          }
        });
        setFormData(initial);
      },
      [columns],
    );

    const handleParamChange = useCallback((name: string, value: unknown) => {
      setFormError('');
      setFormData((prev) => ({ ...prev, [name]: value }));
    }, []);

    React.useEffect(() => {
      if (!selectedOp || !['join_file', 'union_file'].includes(selectedOp.id) || !secondaryFile)
        return;
      setFormData((current) => {
        const changed =
          current.filePath !== secondaryFile.filePath ||
          JSON.stringify(current.table ?? null) !== JSON.stringify(secondaryFile.table ?? null);
        const next: Record<string, unknown> = {
          ...current,
          filePath: secondaryFile.filePath,
        };
        // A database source also names the table inside it; other files have no table.
        if (secondaryFile.table) next.table = secondaryFile.table;
        else delete next.table;
        // A different source has different columns, so the old match column no longer applies.
        if (selectedOp.id === 'join_file' && (changed || !current.rightColumn))
          next.rightColumn = secondaryFile.columns[0] ?? '';
        return next;
      });
    }, [secondaryFile, selectedOp]);

    const handleSubmit = useCallback(() => {
      if (!selectedOp) return;
      const missingRequired = selectedOp.params.find((param) => {
        if (!param.required) return false;
        const value = formData[param.name];
        if (param.type === 'columns') return !Array.isArray(value) || value.length === 0;
        if (param.type === 'sort-keys')
          return (
            !Array.isArray(value) ||
            value.length === 0 ||
            value.some((key) => !(key as { column?: string }).column)
          );
        return String(value ?? '').trim() === '';
      });
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

    React.useEffect(() => {
      if (!selectedOp) return;
      const handleShortcut = (event: KeyboardEvent) => {
        if (event.defaultPrevented) return;
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopImmediatePropagation();
          handleCancel();
          return;
        }
        if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
        const target = event.target;
        if (!(target instanceof HTMLElement) || !target.closest('.operation-form')) return;
        if (
          target.closest('button') ||
          target instanceof HTMLSelectElement ||
          target instanceof HTMLTextAreaElement
        )
          return;
        event.preventDefault();
        event.stopImmediatePropagation();
        handleSubmit();
      };
      window.addEventListener('keydown', handleShortcut);
      return () => window.removeEventListener('keydown', handleShortcut);
    }, [selectedOp, handleCancel, handleSubmit]);

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
              <span className="codicon codicon-close" aria-hidden="true" />
            </button>
          </div>
          <div className="undo-redo-buttons">
            <button
              className="undo-btn"
              onClick={onUndo}
              disabled={!canUndo || transformSteps.length === 0}
              title="Undo last transform"
              aria-label="Undo last transform"
            >
              Undo
            </button>
            <button
              className="redo-btn"
              onClick={onRedo}
              disabled={!canRedo}
              title="Redo last undo"
              aria-label="Redo last undo"
            >
              Redo
            </button>
          </div>
        </div>
        {transformSteps.length > 0 && (
          <div className="active-transforms">
            <div className="active-transforms-label">Applied steps · {transformSteps.length}</div>
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
                  <span className="chip-name">
                    {step.description || step.name.replaceAll('_', ' ')}
                  </span>
                  <button
                    className="chip-remove"
                    onClick={() => onRemoveStep(step.id)}
                    title={`Remove ${step.name}`}
                    aria-label={`Remove ${step.name} transform`}
                  >
                    <span className="codicon codicon-close" aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <input
          className="operation-search"
          type="search"
          value={operationSearch}
          onChange={(event) => setOperationSearch(event.target.value)}
          placeholder="Find an operation…"
          aria-label="Find an operation"
        />
        <div className="operations-categories">
          {OPERATION_CATEGORIES.map((category) => {
            const matchingOperations = category.operations.filter((operation) =>
              operation.name.toLowerCase().includes(operationSearch.trim().toLowerCase()),
            );
            if (operationSearch && matchingOperations.length === 0) return null;
            return (
              <div key={category.name} className="operation-category">
                <button
                  className="category-header"
                  onClick={() => toggleCategory(category.name)}
                  aria-expanded={operationSearch ? true : expandedCategories.has(category.name)}
                >
                  <span className="category-icon">
                    <OperationIcon name={category.name} category />
                  </span>
                  <span className="category-name">{category.name}</span>
                  <span
                    className={`category-chevron ${expandedCategories.has(category.name) ? 'expanded' : ''}`}
                  >
                    <span className="codicon codicon-chevron-right" aria-hidden="true" />
                  </span>
                </button>
                {(operationSearch || expandedCategories.has(category.name)) && (
                  <div className="category-operations">
                    {matchingOperations.map((op) => (
                      <button
                        key={op.id}
                        className={`operation-btn ${selectedOp?.id === op.id ? 'selected' : ''}`}
                        onClick={() => handleSelectOp(op)}
                      >
                        <span className="op-icon">
                          <OperationIcon name={op.id} />
                        </span>
                        <span className="op-name">{op.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {selectedOp && (
          <div className="operation-form">
            <div className="form-header">
              <span className="form-icon">
                <OperationIcon name={selectedOp.id} />
              </span>
              <span className="form-title">{selectedOp.name}</span>
              <button
                className="form-close"
                onClick={handleCancel}
                aria-label={`Close ${selectedOp.name} form`}
              >
                <span className="codicon codicon-close" aria-hidden="true" />
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
                  .map((param) => {
                    const inputId = `form-param-${selectedOp.id}-${param.name}`;
                    return (
                      <div key={param.name} className="param-group">
                        <label className="param-label" htmlFor={inputId}>
                          {param.label}
                          {param.required && <span className="required">*</span>}
                        </label>
                        {param.type === 'file' ? (
                          <div className="file-param">
                            <input
                              id={inputId}
                              className="param-input"
                              type="text"
                              readOnly
                              value={
                                formData.table && formData[param.name]
                                  ? `${String(formData[param.name])} · ${String((formData.table as { name: string }).name)}`
                                  : String(formData[param.name] || '')
                              }
                              placeholder="No file selected"
                            />
                            <button type="button" onClick={onSelectSecondaryFile}>
                              Choose…
                            </button>
                          </div>
                        ) : param.type === 'select' && param.options ? (
                          <select
                            id={inputId}
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
                        ) : param.type === 'columns' ? (
                          <div
                            id={inputId}
                            className="column-checklist"
                            role="group"
                            aria-label={param.label}
                          >
                            {columns.map((col) => {
                              const selected = Array.isArray(formData[param.name])
                                ? (formData[param.name] as string[])
                                : [];
                              return (
                                <label key={col.name} className="column-check">
                                  <input
                                    type="checkbox"
                                    checked={selected.includes(col.name)}
                                    onChange={(event) =>
                                      handleParamChange(
                                        param.name,
                                        event.target.checked
                                          ? [...selected, col.name]
                                          : selected.filter((name) => name !== col.name),
                                      )
                                    }
                                  />
                                  <span title={col.name}>{col.displayName}</span>
                                </label>
                              );
                            })}
                          </div>
                        ) : param.type === 'sort-keys' ? (
                          <SortKeyEditor
                            id={inputId}
                            columns={columns}
                            value={
                              Array.isArray(formData[param.name])
                                ? (formData[param.name] as SortKeyValue[])
                                : []
                            }
                            onChange={(next) => handleParamChange(param.name, next)}
                          />
                        ) : param.type === 'column' || param.type === 'secondary-column' ? (
                          <select
                            id={inputId}
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
                            id={inputId}
                            className="param-input"
                            type="number"
                            value={String(formData[param.name] || '')}
                            onChange={(e) => handleParamChange(param.name, Number(e.target.value))}
                            placeholder={`Enter ${param.label.toLowerCase()}...`}
                          />
                        ) : (
                          <input
                            id={inputId}
                            className="param-input"
                            type="text"
                            value={String(formData[param.name] || '')}
                            onChange={(e) => handleParamChange(param.name, e.target.value)}
                            placeholder={`Enter ${param.label.toLowerCase()}...`}
                          />
                        )}
                      </div>
                    );
                  })
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
