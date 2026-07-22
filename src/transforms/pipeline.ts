import { randomUUID } from 'node:crypto';

import { DuckDBConnection } from '../duckdb/connection.js';
import {
  ColumnInfo,
  ColumnStatistics,
  EngineType,
  PageInfo,
  QueryResult,
  TableSchema,
  TransformOperation,
} from '../types/index.js';

const quoteIdentifier = (value: string): string => `"${value.replace(/"/g, '""')}"`;
const quoteLiteral = (value: string): string => `'${value.replace(/'/g, "''")}'`;

function requiredString(params: Record<string, unknown>, name: string): string {
  const value = params[name];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} is required`);
  }
  return value;
}

function sqlValue(value: unknown): string {
  const text = String(value ?? '').trim();
  if (/^-?(?:\d+\.?\d*|\.\d+)$/.test(text) || /^(?:true|false|null)$/i.test(text)) return text;
  return quoteLiteral(text);
}

function structuredFilterSql(params: Record<string, unknown>): string {
  if (typeof params.condition === 'string' && params.condition.trim()) return params.condition;
  const column = quoteIdentifier(requiredString(params, 'column'));
  const operator = requiredString(params, 'operator');
  const value = params.value;
  const text = String(value ?? '');
  switch (operator) {
    case 'equals': return `${column} = ${sqlValue(value)}`;
    case 'not_equals': return `${column} <> ${sqlValue(value)}`;
    case 'greater_than': return `${column} > ${sqlValue(value)}`;
    case 'greater_equals': return `${column} >= ${sqlValue(value)}`;
    case 'less_than': return `${column} < ${sqlValue(value)}`;
    case 'less_equals': return `${column} <= ${sqlValue(value)}`;
    case 'contains': return `CAST(${column} AS VARCHAR) ILIKE ${quoteLiteral(`%${text}%`)}`;
    case 'not_contains': return `CAST(${column} AS VARCHAR) NOT ILIKE ${quoteLiteral(`%${text}%`)}`;
    case 'starts_with': return `CAST(${column} AS VARCHAR) ILIKE ${quoteLiteral(`${text}%`)}`;
    case 'ends_with': return `CAST(${column} AS VARCHAR) ILIKE ${quoteLiteral(`%${text}`)}`;
    case 'is_null': return `${column} IS NULL`;
    case 'is_not_null': return `${column} IS NOT NULL`;
    case 'between': return `${column} BETWEEN ${sqlValue(value)} AND ${sqlValue(params.value2)}`;
    case 'in':
    case 'not_in': {
      const values = text.split(',').map(item => item.trim()).filter(Boolean);
      if (values.length === 0) throw new Error('At least one comma-separated value is required');
      return `${column} ${operator === 'not_in' ? 'NOT IN' : 'IN'} (${values.map(sqlValue).join(', ')})`;
    }
    default: throw new Error(`Unsupported filter operator: ${operator}`);
  }
}

function operationSql(type: string, params: Record<string, unknown>): string {
  switch (type) {
    case 'filterRows':
    case 'filter_rows':
      return `SELECT * FROM current_data WHERE ${structuredFilterSql(params)}`;
    case 'sortRows':
    case 'sort_rows': {
      const column = quoteIdentifier(requiredString(params, 'column'));
      const ascending = params.ascending ?? params.direction !== 'DESC';
      return `SELECT * FROM current_data ORDER BY ${column} ${ascending ? 'ASC' : 'DESC'}`;
    }
    case 'dropColumn':
    case 'drop_column': {
      const values = Array.isArray(params.columns) ? params.columns : [params.column];
      const columns = values.filter((value): value is string => typeof value === 'string');
      if (columns.length === 0) throw new Error('column is required');
      return `SELECT * EXCLUDE (${columns.map(quoteIdentifier).join(', ')}) FROM current_data`;
    }
    case 'renameColumn':
    case 'rename_column': {
      const oldName = requiredString(params, 'oldName');
      const newName = requiredString(params, 'newName');
      return `SELECT * RENAME (${quoteIdentifier(oldName)} AS ${quoteIdentifier(newName)}) FROM current_data`;
    }
    case 'addColumn':
    case 'add_column':
      return `SELECT *, (${requiredString(params, 'expression')}) AS ${quoteIdentifier(requiredString(params, 'name'))} FROM current_data`;
    case 'castType':
    case 'cast_type': {
      const column = requiredString(params, 'column');
      const targetType = requiredString(params, 'targetType').toUpperCase();
      const allowed = new Set(['VARCHAR', 'INTEGER', 'BIGINT', 'DOUBLE', 'BOOLEAN', 'DATE', 'TIMESTAMP']);
      if (!allowed.has(targetType)) throw new Error(`Unsupported target type: ${targetType}`);
      return `SELECT * REPLACE (TRY_CAST(${quoteIdentifier(column)} AS ${targetType}) AS ${quoteIdentifier(column)}) FROM current_data`;
    }
    case 'fillMissing':
    case 'fill_nulls': {
      const column = requiredString(params, 'column');
      const rawValue = requiredString(params, 'value');
      const value = /^-?\d+(\.\d+)?$|^(true|false|null)$/i.test(rawValue) ? rawValue : quoteLiteral(rawValue);
      return `SELECT * REPLACE (COALESCE(${quoteIdentifier(column)}, ${value}) AS ${quoteIdentifier(column)}) FROM current_data`;
    }
    case 'deduplicate': {
      const values = Array.isArray(params.columns) ? params.columns : [params.columns ?? params.column];
      const columns = values.filter((value): value is string => typeof value === 'string' && value.length > 0);
      return columns.length
        ? `SELECT * FROM current_data QUALIFY ROW_NUMBER() OVER (PARTITION BY ${columns.map(quoteIdentifier).join(', ')}) = 1`
        : 'SELECT DISTINCT * FROM current_data';
    }
    case 'aggregate': {
      const groupBy = typeof params.groupBy === 'string' && params.groupBy ? quoteIdentifier(params.groupBy) : '';
      if (typeof params.aggregations === 'string' && params.aggregations.trim()) {
        const aggregations = params.aggregations.trim();
        return `SELECT ${groupBy ? `${groupBy}, ` : ''}${aggregations} FROM current_data${groupBy ? ` GROUP BY ${groupBy}` : ''}`;
      }
      const fn = requiredString(params, 'function').toUpperCase();
      const allowed = new Set(['COUNT', 'COUNT_DISTINCT', 'SUM', 'AVG', 'MIN', 'MAX']);
      if (!allowed.has(fn)) throw new Error(`Unsupported aggregation: ${fn}`);
      const column = typeof params.column === 'string' && params.column ? quoteIdentifier(params.column) : '*';
      if (column === '*' && !['COUNT'].includes(fn)) throw new Error('column is required for this aggregation');
      const expression = fn === 'COUNT_DISTINCT' ? `COUNT(DISTINCT ${column})` : `${fn}(${column})`;
      const alias = quoteIdentifier(
        typeof params.alias === 'string' && params.alias.trim()
          ? params.alias.trim()
          : `${fn.toLowerCase()}_${column === '*' ? 'rows' : String(params.column)}`,
      );
      return `SELECT ${groupBy ? `${groupBy}, ` : ''}${expression} AS ${alias} FROM current_data${groupBy ? ` GROUP BY ${groupBy}` : ''}`;
    }
    default:
      throw new Error(`Unsupported transform: ${type}`);
  }
}

function descriptionFor(type: string, params: Record<string, unknown>): string {
  return `${type.replace(/_/g, ' ')}: ${Object.values(params).filter(Boolean).join(', ')}`;
}

export function buildPipelineSQL(history: TransformOperation[], source = 'current_data'): string {
  if (history.length === 0) return `SELECT * FROM ${source}`;
  const ctes = history.map((step, index) => {
    const input = index === 0 ? source : `step_${index}`;
    const sql = step.sql.replace(/\bcurrent_data\b/g, input);
    return `step_${index + 1} AS (\n  ${sql}\n)`;
  });
  return `WITH ${ctes.join(',\n')}\nSELECT * FROM step_${history.length}`;
}

export class WranglingSession {
  private history: TransformOperation[] = [];
  private redoStack: TransformOperation[] = [];
  private engine: EngineType = 'duckdb';
  private filePath = '';

  constructor(private readonly connection: DuckDBConnection) {}

  load(filePath: string, engine: EngineType = 'duckdb'): void {
    this.filePath = filePath;
    this.engine = engine;
    this.history = [];
    this.redoStack = [];
  }

  apply(type: string, params: Record<string, unknown>): void {
    const sql = operationSql(type, params);
    this.history.push({ id: randomUUID(), type, params, sql, description: descriptionFor(type, params) });
    this.redoStack = [];
  }

  undo(): void {
    const step = this.history.pop();
    if (step) this.redoStack.push(step);
  }

  redo(): void {
    const step = this.redoStack.pop();
    if (step) this.history.push(step);
  }

  reset(): void {
    this.redoStack.push(...this.history.reverse());
    this.history = [];
  }

  remove(id: string): void {
    this.history = this.history.filter(step => step.id !== id);
    this.redoStack = [];
  }

  setEngine(engine: EngineType): void { this.engine = engine; }
  getEngine(): EngineType { return this.engine; }
  getFilePath(): string { return this.filePath; }
  getHistory(): TransformOperation[] { return [...this.history]; }
  getSql(): string { return buildPipelineSQL(this.history); }

  async getPage(offset: number, limit: number): Promise<{ schema: TableSchema; result: QueryResult; page: PageInfo }> {
    const sql = this.getSql();
    const [result, count, described] = await Promise.all([
      this.connection.query(`SELECT * FROM (${sql}) AS pipeline_result LIMIT ${limit} OFFSET ${offset}`),
      this.connection.query(`SELECT COUNT(*) FROM (${sql}) AS pipeline_count`),
      this.connection.query(`DESCRIBE SELECT * FROM (${sql}) AS pipeline_schema`),
    ]);
    const totalRows = Number(count.rows[0]?.[0] ?? 0);
    const columns: ColumnInfo[] = described.rows.map(row => ({
      name: String(row[0]), type: String(row[1]), nullable: String(row[2]).toUpperCase() === 'YES',
    }));
    return {
      schema: { columns, rowCount: totalRows, filePath: this.filePath },
      result,
      page: { offset, limit, totalRows },
    };
  }

  async getStatistics(): Promise<ColumnStatistics[]> {
    const sql = this.getSql();
    const described = await this.connection.query(`DESCRIBE SELECT * FROM (${sql}) AS pipeline_schema`);
    return Promise.all(described.rows.map(async row => {
      const name = String(row[0]);
      const type = String(row[1]);
      const id = quoteIdentifier(name);
      const normalizedType = type.toUpperCase().trim();
      const numeric = /^(?:U?TINYINT|U?SMALLINT|U?INTEGER|U?BIGINT|UHUGEINT|HUGEINT|FLOAT|REAL|DOUBLE|DECIMAL(?:\([^)]*\))?)$/.test(normalizedType);
      const orderedScalar = numeric || /^(?:VARCHAR|CHAR(?:\([^)]*\))?|BPCHAR|BOOLEAN|DATE|TIME(?: WITH TIME ZONE)?|TIMESTAMP(?: WITH TIME ZONE)?|TIMESTAMP_[A-Z]+|UUID)$/.test(normalizedType);
      const aggregates = [
        `COUNT(*) - COUNT(${id})`,
        `COUNT(DISTINCT ${id})`,
        ...(orderedScalar ? [`MIN(${id})`, `MAX(${id})`] : []),
        ...(numeric ? [`AVG(${id})`] : []),
      ];
      const result = await this.connection.query(
        `SELECT ${aggregates.join(', ')} FROM (${sql}) AS pipeline_stats`,
      );
      const values = result.rows[0] ?? [];
      return {
        name,
        type,
        nullCount: Number(values[0] ?? 0),
        distinctCount: Number(values[1] ?? 0),
        min: orderedScalar ? values[2] : undefined,
        max: orderedScalar ? values[3] : undefined,
        mean: numeric ? Number(values[4]) : undefined,
      };
    }));
  }
}
