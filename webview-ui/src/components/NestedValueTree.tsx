import React, { useMemo, useState } from 'react';

export type NestedPathSegment = string | number;
type NestedAccessor = 'struct' | 'list' | 'map';

interface NestedValueTreeProps {
  value: unknown;
  column: string;
  onTransform?: (type: string, params: Record<string, unknown>) => void;
  onCopy: (text: string, status: string) => void;
}

function isContainer(value: unknown): value is Record<string, unknown> | unknown[] {
  return value !== null && typeof value === 'object';
}

function containerKind(value: unknown): NestedAccessor {
  if (Array.isArray(value)) return 'list';
  if (value instanceof Map) return 'map';
  return 'struct';
}

function entriesFor(value: Record<string, unknown> | unknown[]): Array<[string | number, unknown]> {
  if (Array.isArray(value)) return value.map((item, index) => [index, item]);
  if (value instanceof Map) return [...value.entries()] as Array<[string, unknown]>;
  return Object.entries(value);
}

function pointerToken(segment: NestedPathSegment): string {
  return String(segment).replaceAll('~', '~0').replaceAll('/', '~1');
}

export function nestedJsonPointer(path: NestedPathSegment[]): string {
  return path.length ? `/${path.map(pointerToken).join('/')}` : '/';
}

export function nestedValueLabel(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return `Array(${value.length})`;
  if (value instanceof Map) return `Map(${value.size})`;
  if (typeof value === 'object') return `Object(${Object.keys(value).length})`;
  if (typeof value === 'string') return value;
  return String(value);
}

function suggestedName(column: string, path: NestedPathSegment[]): string {
  const tail = path[path.length - 1];
  return typeof tail === 'string' ? tail : `${column}_item_${tail}`;
}

const TreeNode: React.FC<{
  name: string;
  value: unknown;
  path: NestedPathSegment[];
  accessors: NestedAccessor[];
  column: string;
  depth: number;
  onTransform?: NestedValueTreeProps['onTransform'];
  onCopy: NestedValueTreeProps['onCopy'];
}> = ({ name, value, path, accessors, column, depth, onTransform, onCopy }) => {
  const container = isContainer(value);
  const [expanded, setExpanded] = useState(depth < 1);
  const children = useMemo(() => (container ? entriesFor(value) : []), [container, value]);
  const pointer = nestedJsonPointer(path);

  return (
    <div className="nested-node">
      <div className="nested-node-row" style={{ paddingLeft: `${depth * 14 + 6}px` }}>
        <button
          type="button"
          className={`nested-disclosure ${container ? '' : 'leaf'}`}
          onClick={() => container && setExpanded((current) => !current)}
          aria-label={container ? `${expanded ? 'Collapse' : 'Expand'} ${name}` : `${name} value`}
        >
          {container ? (expanded ? '⌄' : '›') : '·'}
        </button>
        <span className="nested-key" title={name}>
          {name}
        </span>
        <span
          className={`nested-value nested-${Array.isArray(value) ? 'array' : typeof value}`}
          title={nestedValueLabel(value)}
        >
          {nestedValueLabel(value)}
        </span>
        <div className="nested-node-actions">
          <button
            type="button"
            onClick={() => onCopy(pointer, 'JSON path copied')}
            title={`Copy JSON Pointer ${pointer}`}
          >
            Path
          </button>
          {path.length > 0 && onTransform && (
            <button
              type="button"
              onClick={() =>
                onTransform('extract_nested', {
                  column,
                  path,
                  accessors,
                  name: suggestedName(column, path),
                })
              }
            >
              Extract
            </button>
          )}
          {container && !Array.isArray(value) && !(value instanceof Map) && onTransform && (
            <button
              type="button"
              onClick={() => onTransform('flatten_nested', { column, path, accessors })}
            >
              Flatten
            </button>
          )}
          {(Array.isArray(value) || value instanceof Map) && onTransform && (
            <button
              type="button"
              onClick={() =>
                onTransform('explode_nested', {
                  column,
                  path,
                  accessors,
                  containerKind: value instanceof Map ? 'map' : 'list',
                  name: suggestedName(column, path),
                })
              }
            >
              Explode
            </button>
          )}
        </div>
      </div>
      {container && expanded && (
        <div role="group" aria-label={`${name} children`}>
          {children.length ? (
            children.map(([key, child]) => (
              <TreeNode
                key={`${typeof key}:${String(key)}`}
                name={String(key)}
                value={child}
                path={[...path, key]}
                accessors={[...accessors, containerKind(value)]}
                column={column}
                depth={depth + 1}
                onTransform={onTransform}
                onCopy={onCopy}
              />
            ))
          ) : (
            <div className="nested-empty" style={{ paddingLeft: `${(depth + 1) * 14 + 24}px` }}>
              Empty
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export const NestedValueTree: React.FC<NestedValueTreeProps> = ({
  value,
  column,
  onTransform,
  onCopy,
}) => (
  <div className="nested-tree" role="tree" aria-label={`${column} nested value`}>
    <TreeNode
      name={column}
      value={value}
      path={[]}
      accessors={[]}
      column={column}
      depth={0}
      onTransform={onTransform}
      onCopy={onCopy}
    />
  </div>
);
