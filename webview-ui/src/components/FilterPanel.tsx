import React, { useState, useCallback } from 'react';
import type { ColumnInfo, FilterState, Filter, FilterOperator } from '../types';

interface FilterPanelProps {
  columns: ColumnInfo[];
  filters: FilterState;
  onFilterChange: (filters: FilterState) => void;
}

const OPERATORS: Array<{ value: FilterOperator; label: string; needsValue: boolean; needsTwoValues?: boolean }> = [
  { value: 'equals', label: '=', needsValue: true },
  { value: 'not_equals', label: '≠', needsValue: true },
  { value: 'contains', label: 'Contains', needsValue: true },
  { value: 'not_contains', label: 'Not contains', needsValue: true },
  { value: 'starts_with', label: 'Starts with', needsValue: true },
  { value: 'ends_with', label: 'Ends with', needsValue: true },
  { value: 'greater_than', label: '>', needsValue: true },
  { value: 'greater_equals', label: '≥', needsValue: true },
  { value: 'less_than', label: '<', needsValue: true },
  { value: 'less_equals', label: '≤', needsValue: true },
  { value: 'between', label: 'Between', needsValue: true, needsTwoValues: true },
  { value: 'is_null', label: 'Is null', needsValue: false },
  { value: 'is_not_null', label: 'Is not null', needsValue: false },
];

function createFilterId(): string {
  return `filter_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export const FilterPanel: React.FC<FilterPanelProps> = React.memo(({ columns, filters, onFilterChange }) => {
  const [editingFilter, setEditingFilter] = useState<Partial<Filter> | null>(null);
  const [tempValue, setTempValue] = useState('');
  const [tempValue2, setTempValue2] = useState('');

  const addFilter = useCallback(() => {
    const newFilter: Filter = {
      id: createFilterId(),
      column: columns[0]?.name || '',
      operator: 'equals',
      value: '',
      enabled: true,
    };
    setEditingFilter(newFilter);
    setTempValue('');
    setTempValue2('');
  }, [columns]);

  const updateFilter = useCallback(
    (updated: Partial<Filter>) => {
      setEditingFilter((prev) => (prev ? { ...prev, ...updated } : null));
    },
    []
  );

  const saveFilter = useCallback(() => {
    if (!editingFilter || !editingFilter.column) return;

    const operator = OPERATORS.find((op) => op.value === editingFilter.operator);
    let value: string | number | [number, number] = tempValue;

    if (operator?.needsTwoValues) {
      value = [parseFloat(tempValue) || 0, parseFloat(tempValue2) || 0];
    } else if (editingFilter.operator === 'is_null' || editingFilter.operator === 'is_not_null') {
      value = '';
    } else if (editingFilter.operator?.includes('greater') || editingFilter.operator?.includes('less') || editingFilter.operator === 'between') {
      value = parseFloat(tempValue) || 0;
    }

    const filter: Filter = {
      id: editingFilter.id || createFilterId(),
      column: editingFilter.column,
      operator: editingFilter.operator || 'equals',
      value,
      enabled: true,
    };

    const existingIndex = filters.filters.findIndex((f) => f.id === filter.id);
    const nextFilters = [...filters.filters];
    if (existingIndex >= 0) {
      nextFilters[existingIndex] = filter;
    } else {
      nextFilters.push(filter);
    }

    onFilterChange({ filters: nextFilters, appliedFilters: nextFilters });
    setEditingFilter(null);
    setTempValue('');
    setTempValue2('');
  }, [editingFilter, tempValue, tempValue2, filters, onFilterChange]);

  const removeFilter = useCallback(
    (filterId: string) => {
      const nextFilters = filters.filters.filter((f) => f.id !== filterId);
      onFilterChange({ filters: nextFilters, appliedFilters: nextFilters });
    },
    [filters, onFilterChange]
  );

  const toggleFilter = useCallback(
    (filterId: string) => {
      const nextFilters = filters.filters.map((f) =>
        f.id === filterId ? { ...f, enabled: !f.enabled } : f
      );
      onFilterChange({ filters: nextFilters, appliedFilters: nextFilters.filter((f) => f.enabled) });
    },
    [filters, onFilterChange]
  );

  const clearAllFilters = useCallback(() => {
    onFilterChange({ filters: [], appliedFilters: [] });
  }, [onFilterChange]);

  const startEditFilter = useCallback((filter: Filter) => {
    setEditingFilter(filter);
    if (filter.operator === 'between') {
      const vals = filter.value as [number, number];
      setTempValue(String(vals[0]));
      setTempValue2(String(vals[1]));
    } else {
      setTempValue(String(filter.value));
      setTempValue2('');
    }
  }, []);

  const activeFilterCount = filters.filters.filter((f) => f.enabled).length;

  return (
    <div className="filter-panel">
      <div className="filter-header">
        <h3 className="filter-title">
          Filters
          {activeFilterCount > 0 && (
            <span className="filter-count">{activeFilterCount}</span>
          )}
        </h3>
        <div className="filter-actions">
          {filters.filters.length > 0 && (
            <button className="filter-clear-all" onClick={clearAllFilters}>
              Clear all
            </button>
          )}
          <button className="filter-add-btn" onClick={addFilter}>
            + Add
          </button>
        </div>
      </div>

      <div className="filter-chips">
        {filters.filters.map((filter) => (
          <div
            key={filter.id}
            className={`filter-chip ${filter.enabled ? '' : 'disabled'}`}
          >
            <button
              className="chip-toggle"
              onClick={() => toggleFilter(filter.id)}
              title={filter.enabled ? 'Disable filter' : 'Enable filter'}
            >
              {filter.enabled ? '●' : '○'}
            </button>
            <span className="chip-column">{filter.column}</span>
            <span className="chip-operator">
              {OPERATORS.find((op) => op.value === filter.operator)?.label}
            </span>
            {filter.operator !== 'is_null' && filter.operator !== 'is_not_null' && (
              <span className="chip-value">
                {Array.isArray(filter.value)
                  ? `${filter.value[0]} - ${filter.value[1]}`
                  : String(filter.value)}
              </span>
            )}
            <button className="chip-edit" onClick={() => startEditFilter(filter)} title="Edit filter">
              ✎
            </button>
            <button className="chip-remove" onClick={() => removeFilter(filter.id)} title="Remove filter">
              ×
            </button>
          </div>
        ))}
      </div>

      {editingFilter && (
        <div className="filter-editor">
          <div className="filter-editor-row">
            <select
              className="filter-select"
              value={editingFilter.column}
              onChange={(e) => updateFilter({ column: e.target.value })}
            >
              {columns.map((col) => (
                <option key={col.name} value={col.name}>
                  {col.displayName} ({col.dataType})
                </option>
              ))}
            </select>
          </div>

          <div className="filter-editor-row">
            <select
              className="filter-select"
              value={editingFilter.operator}
              onChange={(e) => updateFilter({ operator: e.target.value as FilterOperator })}
            >
              {OPERATORS.map((op) => (
                <option key={op.value} value={op.value}>
                  {op.label}
                </option>
              ))}
            </select>
          </div>

          {OPERATORS.find((op) => op.value === editingFilter.operator)?.needsValue && (
            <div className="filter-editor-row">
              <input
                className="filter-input"
                type="text"
                placeholder="Value"
                value={tempValue}
                onChange={(e) => setTempValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveFilter();
                  if (e.key === 'Escape') setEditingFilter(null);
                }}
                autoFocus
              />
              {OPERATORS.find((op) => op.value === editingFilter.operator)?.needsTwoValues && (
                <>
                  <span className="filter-separator">and</span>
                  <input
                    className="filter-input"
                    type="text"
                    placeholder="Max value"
                    value={tempValue2}
                    onChange={(e) => setTempValue2(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveFilter();
                      if (e.key === 'Escape') setEditingFilter(null);
                    }}
                  />
                </>
              )}
            </div>
          )}

          <div className="filter-editor-actions">
            <button className="filter-cancel-btn" onClick={() => setEditingFilter(null)}>
              Cancel
            </button>
            <button className="filter-apply-btn" onClick={saveFilter}>
              Apply
            </button>
          </div>
        </div>
      )}

      {filters.filters.length === 0 && !editingFilter && (
        <div className="filter-empty">
          <p>No filters applied</p>
          <button className="filter-add-first" onClick={addFilter}>
            Add your first filter
          </button>
        </div>
      )}
    </div>
  );
});

FilterPanel.displayName = 'FilterPanel';
