import { randomUUID } from 'node:crypto';

import { DuckDBConnection } from '../duckdb/connection.js';
import { getConnectionTableRef, getTableRef } from '../duckdb/parquet-loader.js';
import { quoteIdentifier, quoteLiteral } from '../duckdb/sql.js';
import {
  ColumnInfo,
  ColumnStatistics,
  ChartRequest,
  DataQualitySummary,
  PageInfo,
  QueryResult,
  TableSchema,
  TransformOperation,
} from '../types/index.js';

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

function safeFillType(value: string): string {
  const type = value.toUpperCase().replace(/\s+/g, '');
  if (
    new Set([
      'VARCHAR',
      'TEXT',
      'STRING',
      'INTEGER',
      'INT',
      'BIGINT',
      'SMALLINT',
      'TINYINT',
      'DOUBLE',
      'FLOAT',
      'REAL',
      'BOOLEAN',
      'DATE',
      'TIMESTAMP',
      'TIME',
    ]).has(type) ||
    /^DECIMAL\(\d{1,3},\d{1,3}\)$/.test(type)
  )
    return type;
  throw new Error(`Unsupported fill target type: ${value}`);
}

function structuredFilterSql(params: Record<string, unknown>): string {
  if (typeof params.condition === 'string' && params.condition.trim()) return params.condition;
  const column = quoteIdentifier(requiredString(params, 'column'));
  const operator = requiredString(params, 'operator');
  const value = params.value;
  const text = String(value ?? '');
  switch (operator) {
    case 'equals':
      return `${column} = ${sqlValue(value)}`;
    case 'not_equals':
      return `${column} <> ${sqlValue(value)}`;
    case 'greater_than':
      return `${column} > ${sqlValue(value)}`;
    case 'greater_equals':
      return `${column} >= ${sqlValue(value)}`;
    case 'less_than':
      return `${column} < ${sqlValue(value)}`;
    case 'less_equals':
      return `${column} <= ${sqlValue(value)}`;
    case 'contains':
      return `CAST(${column} AS VARCHAR) ILIKE ${quoteLiteral(`%${text}%`)}`;
    case 'not_contains':
      return `CAST(${column} AS VARCHAR) NOT ILIKE ${quoteLiteral(`%${text}%`)}`;
    case 'starts_with':
      return `CAST(${column} AS VARCHAR) ILIKE ${quoteLiteral(`${text}%`)}`;
    case 'ends_with':
      return `CAST(${column} AS VARCHAR) ILIKE ${quoteLiteral(`%${text}`)}`;
    case 'is_null':
      return `${column} IS NULL`;
    case 'is_not_null':
      return `${column} IS NOT NULL`;
    case 'between':
      return `${column} BETWEEN ${sqlValue(value)} AND ${sqlValue(params.value2)}`;
    case 'in':
    case 'not_in': {
      const values = text
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
      if (values.length === 0) throw new Error('At least one comma-separated value is required');
      return `${column} ${operator === 'not_in' ? 'NOT IN' : 'IN'} (${values.map(sqlValue).join(', ')})`;
    }
    default:
      throw new Error(`Unsupported filter operator: ${operator}`);
  }
}

function formulaColumnSql(params: Record<string, unknown>): string {
  const name = quoteIdentifier(requiredString(params, 'name'));
  const formula = requiredString(params, 'formula');
  const column = quoteIdentifier(requiredString(params, 'column'));
  let expression: string;
  switch (formula) {
    case 'if': {
      const condition = structuredFilterSql({
        column: requiredString(params, 'column'),
        operator: requiredString(params, 'operator'),
        value: params.compareValue,
      });
      expression = `CASE WHEN ${condition} THEN ${sqlValue(params.trueValue)} ELSE ${sqlValue(params.falseValue)} END`;
      break;
    }
    case 'date_diff': {
      const second = quoteIdentifier(requiredString(params, 'secondColumn'));
      const unit = requiredString(params, 'unit').toLowerCase();
      if (!new Set(['day', 'week', 'month', 'year']).has(unit))
        throw new Error(`Unsupported date unit: ${unit}`);
      expression = `date_diff(${quoteLiteral(unit)}, ${column}, ${second})`;
      break;
    }
    case 'regex_extract':
      expression = `regexp_extract(CAST(${column} AS VARCHAR), ${quoteLiteral(requiredString(params, 'pattern'))})`;
      break;
    case 'concat': {
      const second = quoteIdentifier(requiredString(params, 'secondColumn'));
      expression = `concat_ws(${quoteLiteral(String(params.separator ?? ' '))}, ${column}, ${second})`;
      break;
    }
    default:
      throw new Error(`Unsupported formula: ${formula}`);
  }
  return `SELECT *, (${expression}) AS ${name} FROM current_data`;
}

function nestedPath(params: Record<string, unknown>): Array<string | number> {
  const path = params.path;
  const segments = Array.isArray(path)
    ? path
    : typeof path === 'string' && path.trim() && path.trim() !== '/'
      ? path
          .trim()
          .replace(/^\//, '')
          .split('/')
          .map((segment) => {
            const decoded = segment.replaceAll('~1', '/').replaceAll('~0', '~');
            return /^\d+$/.test(decoded) ? Number(decoded) : decoded;
          })
      : [];
  return segments.map((segment) => {
    if (typeof segment === 'string' && segment.length > 0) return segment;
    if (typeof segment === 'number' && Number.isSafeInteger(segment) && segment >= 0)
      return segment;
    throw new Error('nested path contains an invalid segment');
  });
}

function nestedExpression(params: Record<string, unknown>): string {
  let expression = quoteIdentifier(requiredString(params, 'column'));
  const path = nestedPath(params);
  const accessors = Array.isArray(params.accessors) ? params.accessors : [];
  for (const [index, segment] of path.entries()) {
    const accessor = accessors[index] ?? (typeof segment === 'number' ? 'list' : 'struct');
    if (accessor === 'list') {
      if (typeof segment !== 'number') throw new Error('list path segment must be an index');
      expression = `list_extract(${expression}, ${segment + 1})`;
    } else if (accessor === 'map') {
      expression = `map_extract_value(${expression}, ${quoteLiteral(String(segment))})`;
    } else if (accessor === 'struct') {
      expression = `struct_extract(${expression}, ${quoteLiteral(String(segment))})`;
    } else {
      throw new Error('nested path contains an invalid accessor');
    }
  }
  return expression;
}

function operationSql(
  type: string,
  params: Record<string, unknown>,
  secondaryTableRef: (filePath: string) => string = (filePath) => getTableRef(filePath),
): string {
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
    case 'formula_column':
      return formulaColumnSql(params);
    case 'extract_nested': {
      if (nestedPath(params).length === 0) throw new Error('nested path is required');
      const expression = nestedExpression(params);
      return `SELECT *, ${expression} AS ${quoteIdentifier(requiredString(params, 'name'))} FROM current_data`;
    }
    case 'flatten_nested':
      return `SELECT *, unnest(${nestedExpression(params)}) FROM current_data`;
    case 'explode_nested': {
      const expression = nestedExpression(params);
      const alias = quoteIdentifier(requiredString(params, 'name'));
      const unnested = params.containerKind === 'map' ? `map_entries(${expression})` : expression;
      return `SELECT *, unnest(${unnested}) AS ${alias} FROM current_data`;
    }
    case 'join_file': {
      const filePath = requiredString(params, 'filePath');
      const leftColumn = quoteIdentifier(requiredString(params, 'leftColumn'));
      const rightColumn = quoteIdentifier(requiredString(params, 'rightColumn'));
      const joinType = requiredString(params, 'joinType').toUpperCase();
      if (!new Set(['INNER', 'LEFT', 'RIGHT', 'FULL']).has(joinType)) {
        throw new Error(`Unsupported join type: ${joinType}`);
      }
      return `SELECT left_data.*, right_data.* FROM current_data AS left_data ${joinType} JOIN ${secondaryTableRef(filePath)} AS right_data ON left_data.${leftColumn} = right_data.${rightColumn}`;
    }
    case 'union_file': {
      const filePath = requiredString(params, 'filePath');
      return `SELECT * FROM current_data UNION ALL BY NAME SELECT * FROM ${secondaryTableRef(filePath)}`;
    }
    case 'castType':
    case 'cast_type': {
      const column = requiredString(params, 'column');
      const targetType = requiredString(params, 'targetType').toUpperCase();
      const allowed = new Set([
        'VARCHAR',
        'INTEGER',
        'BIGINT',
        'DOUBLE',
        'BOOLEAN',
        'DATE',
        'TIMESTAMP',
      ]);
      if (!allowed.has(targetType)) throw new Error(`Unsupported target type: ${targetType}`);
      return `SELECT * REPLACE (TRY_CAST(${quoteIdentifier(column)} AS ${targetType}) AS ${quoteIdentifier(column)}) FROM current_data`;
    }
    case 'fillMissing':
    case 'fill_nulls': {
      const column = requiredString(params, 'column');
      // Accept string, number, boolean values from both visual UI and AI contracts.
      const rawParam = params.value;
      if (rawParam === null || rawParam === undefined || rawParam === '') {
        throw new Error('value is required for fill_nulls');
      }
      const rawValue = String(rawParam);
      const targetType =
        typeof params.targetType === 'string' ? safeFillType(params.targetType) : '';
      const value = targetType
        ? `CAST(${quoteLiteral(rawValue)} AS ${safeFillType(targetType)})`
        : typeof rawParam === 'number' || typeof rawParam === 'boolean'
          ? rawValue
          : quoteLiteral(rawValue);
      return `SELECT * REPLACE (COALESCE(${quoteIdentifier(column)}, ${value}) AS ${quoteIdentifier(column)}) FROM current_data`;
    }
    case 'deduplicate': {
      const values = Array.isArray(params.columns)
        ? params.columns
        : [params.columns ?? params.column];
      const columns = values.filter(
        (value): value is string => typeof value === 'string' && value.length > 0,
      );
      return columns.length
        ? `SELECT * FROM current_data QUALIFY ROW_NUMBER() OVER (PARTITION BY ${columns.map(quoteIdentifier).join(', ')}) = 1`
        : 'SELECT DISTINCT * FROM current_data';
    }
    case 'aggregate': {
      const groupBy =
        typeof params.groupBy === 'string' && params.groupBy ? quoteIdentifier(params.groupBy) : '';
      if (typeof params.aggregations === 'string' && params.aggregations.trim()) {
        const aggregations = params.aggregations.trim();
        return `SELECT ${groupBy ? `${groupBy}, ` : ''}${aggregations} FROM current_data${groupBy ? ` GROUP BY ${groupBy}` : ''}`;
      }
      const fn = requiredString(params, 'function').toUpperCase();
      const allowed = new Set(['COUNT', 'COUNT_DISTINCT', 'SUM', 'AVG', 'MIN', 'MAX']);
      if (!allowed.has(fn)) throw new Error(`Unsupported aggregation: ${fn}`);
      const column =
        typeof params.column === 'string' && params.column ? quoteIdentifier(params.column) : '*';
      if (column === '*' && !['COUNT'].includes(fn))
        throw new Error('column is required for this aggregation');
      const expression = fn === 'COUNT_DISTINCT' ? `COUNT(DISTINCT ${column})` : `${fn}(${column})`;
      const alias = quoteIdentifier(
        typeof params.alias === 'string' && params.alias.trim()
          ? params.alias.trim()
          : `${fn.toLowerCase()}_${column === '*' ? 'rows' : String(params.column)}`,
      );
      return `SELECT ${groupBy ? `${groupBy}, ` : ''}${expression} AS ${alias} FROM current_data${groupBy ? ` GROUP BY ${groupBy}` : ''}`;
    }
    case 'pivot': {
      const index = quoteIdentifier(requiredString(params, 'index'));
      const column = quoteIdentifier(requiredString(params, 'column'));
      const value = quoteIdentifier(requiredString(params, 'value'));
      const aggregate = requiredString(params, 'aggregate').toUpperCase();
      if (!new Set(['SUM', 'AVG', 'MIN', 'MAX', 'COUNT']).has(aggregate)) {
        throw new Error(`Unsupported pivot aggregation: ${aggregate}`);
      }
      return `PIVOT current_data ON ${column} USING ${aggregate}(${value}) GROUP BY ${index}`;
    }
    case 'unpivot': {
      const columns = String(params.columns ?? '')
        .split(',')
        .map((column) => column.trim())
        .filter(Boolean);
      if (columns.length < 2) throw new Error('At least two value columns are required');
      const nameColumn = quoteIdentifier(requiredString(params, 'nameColumn'));
      const valueColumn = quoteIdentifier(requiredString(params, 'valueColumn'));
      return `UNPIVOT current_data ON ${columns.map(quoteIdentifier).join(', ')} INTO NAME ${nameColumn} VALUE ${valueColumn}`;
    }
    default:
      throw new Error(`Unsupported transform: ${type}`);
  }
}

function descriptionFor(type: string, params: Record<string, unknown>): string {
  return `${type.replace(/_/g, ' ')}: ${Object.values(params).filter(Boolean).join(', ')}`;
}

interface RecipeReplayOptions {
  chooseColumn: (
    missing: string,
    columns: ColumnInfo[],
    step: number,
    operation: string,
  ) => Promise<string | undefined>;
  assertCurrent: () => void;
}

async function remapRecipeInputs(
  type: string,
  params: Record<string, unknown>,
  resolve: (name: string, commaSeparated?: boolean) => Promise<string>,
): Promise<void> {
  const field = async (key: string): Promise<void> => {
    const value = params[key];
    if (typeof value === 'string' && value.trim()) params[key] = await resolve(value);
  };
  const list = async (key: string): Promise<void> => {
    const values = params[key];
    if (!Array.isArray(values)) return field(key);
    const mapped: unknown[] = [];
    for (const value of values)
      mapped.push(typeof value === 'string' && value ? await resolve(value) : value);
    params[key] = mapped;
  };
  switch (type) {
    case 'filterRows':
    case 'filter_rows':
      if (typeof params.condition === 'string' && params.condition.trim())
        throw new Error(
          'Custom SQL filters cannot be remapped automatically. Replace this step with a structured filter first.',
        );
      await field('column');
      break;
    case 'addColumn':
    case 'add_column':
      if (typeof params.expression === 'string' && params.expression.trim())
        throw new Error(
          'Raw SQL column expressions cannot be remapped automatically. Rebuild this step from the current schema first.',
        );
      break;
    case 'sortRows':
    case 'sort_rows':
    case 'castType':
    case 'cast_type':
    case 'fillMissing':
    case 'fill_nulls':
    case 'extract_nested':
    case 'flatten_nested':
    case 'explode_nested':
      await field('column');
      break;
    case 'renameColumn':
    case 'rename_column':
      await field('oldName');
      break;
    case 'dropColumn':
    case 'drop_column':
      await list(Array.isArray(params.columns) ? 'columns' : 'column');
      break;
    case 'deduplicate':
      await list(params.columns == null ? 'column' : 'columns');
      break;
    case 'join_file':
      await field('leftColumn');
      break;
    case 'aggregate':
      await field('groupBy');
      if (!(typeof params.aggregations === 'string' && params.aggregations.trim()))
        await field('column');
      break;
    case 'formula_column':
      if (typeof params.expression === 'string' && params.expression.trim())
        throw new Error(
          'Raw SQL formulas cannot be remapped automatically. Rebuild this formula with Formula Builder first.',
        );
      await field('column');
      if (params.formula === 'date_diff' || params.formula === 'concat')
        await field('secondColumn');
      break;
    case 'pivot':
      await field('index');
      await field('column');
      await field('value');
      break;
    case 'unpivot': {
      if (typeof params.columns !== 'string') break;
      const mapped: string[] = [];
      for (const name of params.columns
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean))
        mapped.push(await resolve(name, true));
      params.columns = mapped.join(', ');
      break;
    }
  }
}

class RecipeReplayCancelled extends Error {}

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
  private filePath = '';
  private revision = 0;
  private schemaCache?: { revision: number; columns: ColumnInfo[] };
  private rowCountCache?: { revision: number; value: number };
  private statisticsCache?: { revision: number; value: ColumnStatistics[] };

  constructor(
    private readonly connection: DuckDBConnection,
    readonly relationName = 'current_data',
  ) {}

  load(filePath: string): void {
    this.filePath = filePath;
    this.history = [];
    this.redoStack = [];
    this.invalidateCaches();
  }

  private invalidateCaches(): void {
    this.revision += 1;
    this.schemaCache = undefined;
    this.rowCountCache = undefined;
    this.statisticsCache = undefined;
  }

  private async getColumns(sql = this.getSql()): Promise<ColumnInfo[]> {
    const revision = this.revision;
    if (this.schemaCache?.revision === revision) return this.schemaCache.columns;
    const described = await this.connection.query(
      `DESCRIBE SELECT * FROM (${sql}) AS pipeline_schema`,
    );
    const columns = described.rows.map((row) => ({
      name: String(row[0]),
      type: String(row[1]),
      nullable: String(row[2]).toUpperCase() === 'YES',
    }));
    // Only cache if the pipeline hasn't changed while we were querying.
    if (this.revision === revision) this.schemaCache = { revision, columns };
    return columns;
  }

  private async getRowCount(sql = this.getSql()): Promise<number> {
    const revision = this.revision;
    if (this.rowCountCache?.revision === revision) return this.rowCountCache.value;
    const count = await this.connection.query(`SELECT COUNT(*) FROM (${sql}) AS pipeline_count`);
    const value = Number(count.rows[0]?.[0] ?? 0);
    if (this.revision === revision) this.rowCountCache = { revision, value };
    return value;
  }

  apply(type: string, params: Record<string, unknown>): void {
    // Secondary sources reuse any schema already resolved on this connection so
    // joins and unions do not re-run CSV type detection per query.
    const sql = operationSql(type, params, (filePath) =>
      getConnectionTableRef(this.connection, filePath),
    );
    this.history.push({
      id: randomUUID(),
      type,
      params,
      sql,
      description: descriptionFor(type, params),
    });
    this.redoStack = [];
    this.invalidateCaches();
  }

  async applyValidated(type: string, params: Record<string, unknown>): Promise<void> {
    if (type === 'fill_nulls' || type === 'fillMissing') {
      const column = requiredString(params, 'column');
      const info = (await this.getColumns()).find((item) => item.name === column);
      if (!info) throw new Error(`Unknown column: ${column}`);
      if (params.value === null || params.value === undefined || String(params.value) === '')
        throw new Error('value is required for fill_nulls');
      const supportedTypes = new Set([
        'VARCHAR',
        'TEXT',
        'STRING',
        'INTEGER',
        'INT',
        'BIGINT',
        'SMALLINT',
        'TINYINT',
        'DOUBLE',
        'FLOAT',
        'REAL',
        'DECIMAL',
        'BOOLEAN',
        'DATE',
        'TIMESTAMP',
        'TIME',
      ]);
      const baseType = info.type.toUpperCase().split('(')[0];
      if (!supportedTypes.has(baseType))
        throw new Error(`Fill missing values does not support ${info.type} columns yet`);
      const castTarget = safeFillType(info.type);
      const validationType = castTarget;
      if (!['VARCHAR', 'TEXT', 'STRING'].includes(baseType))
        await this.connection.query(
          `SELECT CAST(${quoteLiteral(String(params.value))} AS ${validationType})`,
        );
      else if (typeof params.value !== 'string')
        throw new Error('Text columns require a text replacement value');
      params = { ...params, targetType: castTarget };
    }
    const sql = operationSql(type, params, (filePath) =>
      getConnectionTableRef(this.connection, filePath),
    );
    const operation: TransformOperation = {
      id: randomUUID(),
      type,
      params: structuredClone(params),
      sql,
      description: descriptionFor(type, params),
    };
    const startingRevision = this.revision;
    // A sort straight after another sort replaces it: the earlier ORDER BY cannot affect the
    // result, so clicking a column header repeatedly must not grow the step list.
    const last = this.history[this.history.length - 1];
    const base =
      type === 'sort_rows' && last?.type === 'sort_rows' ? this.history.slice(0, -1) : this.history;
    const candidateHistory = [...base, operation];
    const validation = await this.validateHistory(candidateHistory);
    this.assertRevisionUnchanged(startingRevision);
    this.history = candidateHistory;
    this.redoStack = [];
    this.invalidateCaches();
    this.cacheValidation(validation);
  }

  undo(): void {
    const step = this.history.pop();
    if (step) {
      this.redoStack.push(step);
      this.invalidateCaches();
    }
  }

  async undoValidated(): Promise<void> {
    if (!this.history.length) return;
    const removed = this.history[this.history.length - 1];
    const startingRevision = this.revision;
    const candidateHistory = this.history.slice(0, -1);
    const validation = await this.validateHistory(candidateHistory);
    this.assertRevisionUnchanged(startingRevision);
    this.history = candidateHistory;
    this.redoStack = [...this.redoStack, removed];
    this.invalidateCaches();
    this.cacheValidation(validation);
  }

  redo(): void {
    const step = this.redoStack.pop();
    if (step) {
      this.history.push(step);
      this.invalidateCaches();
    }
  }

  async redoValidated(): Promise<void> {
    if (!this.redoStack.length) return;
    const restored = this.redoStack[this.redoStack.length - 1];
    const startingRevision = this.revision;
    const candidateHistory = [...this.history, restored];
    const validation = await this.validateHistory(candidateHistory);
    this.assertRevisionUnchanged(startingRevision);
    this.history = candidateHistory;
    this.redoStack = this.redoStack.slice(0, -1);
    this.invalidateCaches();
    this.cacheValidation(validation);
  }

  async removeValidated(id: string): Promise<void> {
    const next = this.history.filter((step) => step.id !== id);
    if (next.length !== this.history.length)
      await this.restoreValidated(next.map(({ type, params }) => ({ type, params })));
  }

  async reorderValidated(sourceId: string, targetId: string): Promise<void> {
    const next = this.getHistory();
    const sourceIndex = next.findIndex((step) => step.id === sourceId);
    const targetIndex = next.findIndex((step) => step.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return;
    const [step] = next.splice(sourceIndex, 1);
    next.splice(targetIndex, 0, step);
    await this.restoreValidated(next.map(({ type, params }) => ({ type, params })));
  }

  remove(id: string): void {
    const previousLength = this.history.length;
    this.history = this.history.filter((step) => step.id !== id);
    this.redoStack = [];
    if (this.history.length !== previousLength) this.invalidateCaches();
  }

  reorder(sourceId: string, targetId: string): void {
    const sourceIndex = this.history.findIndex((step) => step.id === sourceId);
    const targetIndex = this.history.findIndex((step) => step.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return;
    const [step] = this.history.splice(sourceIndex, 1);
    this.history.splice(targetIndex, 0, step);
    this.redoStack = [];
    this.invalidateCaches();
  }

  getFilePath(): string {
    return this.filePath;
  }
  getHistory(): TransformOperation[] {
    return [...this.history];
  }
  getRevision(): number {
    return this.revision;
  }
  canUndo(): boolean {
    return this.history.length > 0;
  }
  canRedo(): boolean {
    return this.redoStack.length > 0;
  }
  restore(history: Array<Pick<TransformOperation, 'type' | 'params'>>): void {
    const candidate = this.buildHistory(history);
    this.history = candidate;
    this.redoStack = [];
    this.invalidateCaches();
  }

  async restoreValidated(
    history: Array<Pick<TransformOperation, 'type' | 'params'>>,
    replay?: RecipeReplayOptions,
  ): Promise<boolean> {
    const startingRevision = this.revision;
    const assertCurrent = (): void => {
      this.assertRevisionUnchanged(startingRevision);
      replay?.assertCurrent();
    };
    let candidate: TransformOperation[];
    try {
      candidate = await this.buildValidatedHistory(history, replay && { ...replay, assertCurrent });
    } catch (error) {
      if (error instanceof RecipeReplayCancelled) return false;
      throw error;
    }
    const validation = await this.validateHistory(candidate);
    assertCurrent();
    this.history = candidate;
    this.redoStack = [];
    this.invalidateCaches();
    this.cacheValidation(validation);
    return true;
  }

  private buildHistory(
    history: Array<Pick<TransformOperation, 'type' | 'params'>>,
  ): TransformOperation[] {
    return history.map((step) => {
      const params = structuredClone(step.params);
      const sql = operationSql(step.type, params, (filePath) =>
        getConnectionTableRef(this.connection, filePath),
      );
      return {
        id: randomUUID(),
        type: step.type,
        params,
        sql,
        description: descriptionFor(step.type, params),
      };
    });
  }

  private async buildValidatedHistory(
    history: Array<Pick<TransformOperation, 'type' | 'params'>>,
    replay?: RecipeReplayOptions,
  ): Promise<TransformOperation[]> {
    const candidate: TransformOperation[] = [];
    const replacements = new Map<string, string>();
    for (const [index, step] of history.entries()) {
      try {
        let params = structuredClone(step.params);
        const describeInput = async (): Promise<ColumnInfo[]> => {
          const sql = buildPipelineSQL(candidate, this.relationName);
          const described = await this.connection.query(
            `DESCRIBE SELECT * FROM (${sql}) AS preceding_pipeline_schema`,
          );
          return described.rows.map((row) => ({
            name: String(row[0]),
            type: String(row[1]),
            nullable: String(row[2]).toUpperCase() === 'YES',
          }));
        };
        const columns = replay ? await describeInput() : undefined;
        if (replay && columns) {
          await remapRecipeInputs(step.type, params, async (name, commaSeparated) => {
            const eligible = commaSeparated
              ? columns.filter(
                  (column) => !column.name.includes(',') && column.name.trim() === column.name,
                )
              : columns;
            const actual =
              eligible.find((column) => column.name === name) ??
              eligible.find((column) => column.name.toLowerCase() === name.toLowerCase());
            if (actual) return actual.name;
            const saved = replacements.get(name.toLowerCase());
            if (saved && eligible.some((column) => column.name === saved)) return saved;
            replay.assertCurrent();
            if (!eligible.length)
              throw new Error(
                `Step ${index + 1}: no replacement column is available for “${name}”.`,
              );
            const selected = await replay.chooseColumn(name, eligible, index + 1, step.type);
            if (selected === undefined) throw new RecipeReplayCancelled();
            replay.assertCurrent();
            if (!eligible.some((column) => column.name === selected))
              throw new Error('Invalid recipe column selection');
            replacements.set(name.toLowerCase(), selected);
            return selected;
          });
        }
        if (step.type === 'fill_nulls' || step.type === 'fillMissing') {
          const column = requiredString(params, 'column');
          const info = (columns ?? (await describeInput())).find((item) => item.name === column);
          if (!info) throw new Error(`Unknown column: ${column}`);
          if (params.value === null || params.value === undefined || String(params.value) === '')
            throw new Error('value is required for fill_nulls');
          const baseType = info.type.toUpperCase().split('(')[0];
          const supportedTypes = new Set([
            'VARCHAR',
            'TEXT',
            'STRING',
            'INTEGER',
            'INT',
            'BIGINT',
            'SMALLINT',
            'TINYINT',
            'DOUBLE',
            'FLOAT',
            'REAL',
            'DECIMAL',
            'BOOLEAN',
            'DATE',
            'TIMESTAMP',
            'TIME',
          ]);
          if (!supportedTypes.has(baseType))
            throw new Error(`Fill missing values does not support ${info.type} columns yet`);
          const targetType = safeFillType(info.type);
          if (['VARCHAR', 'TEXT', 'STRING'].includes(baseType) && typeof params.value !== 'string')
            throw new Error('Text columns require a text replacement value');
          if (!['VARCHAR', 'TEXT', 'STRING'].includes(baseType))
            await this.connection.query(
              `SELECT CAST(${quoteLiteral(String(params.value))} AS ${targetType})`,
            );
          params = { ...params, targetType };
        }
        const sql = operationSql(step.type, params, (filePath) =>
          getConnectionTableRef(this.connection, filePath),
        );
        candidate.push({
          id: randomUUID(),
          type: step.type,
          params,
          sql,
          description: descriptionFor(step.type, params),
        });
      } catch (error) {
        if (error instanceof RecipeReplayCancelled) throw error;
        if (replay && error instanceof Error)
          throw new Error(
            `Step ${index + 1} (${step.type.replaceAll('_', ' ')}): ${error.message}`,
          );
        throw error;
      }
    }
    return candidate;
  }

  private async validateHistory(history: TransformOperation[]): Promise<{
    columns: ColumnInfo[];
    rowCount: number;
  }> {
    const sql = buildPipelineSQL(history, this.relationName);
    const described = await this.connection.query(
      `DESCRIBE SELECT * FROM (${sql}) AS validated_pipeline_schema`,
    );
    const count = await this.connection.query(
      `SELECT COUNT(*) FROM (${sql}) AS validated_pipeline_count`,
    );
    await this.connection.query(`SELECT * FROM (${sql}) AS validated_pipeline_page LIMIT 1`);
    return {
      columns: described.rows.map((row) => ({
        name: String(row[0]),
        type: String(row[1]),
        nullable: String(row[2]).toUpperCase() === 'YES',
      })),
      rowCount: Number(count.rows[0]?.[0] ?? 0),
    };
  }

  private cacheValidation(validation: { columns: ColumnInfo[]; rowCount: number }): void {
    this.schemaCache = { revision: this.revision, columns: validation.columns };
    this.rowCountCache = { revision: this.revision, value: validation.rowCount };
    this.statisticsCache = undefined;
  }

  private assertRevisionUnchanged(revision: number): void {
    if (this.revision !== revision)
      throw new Error(
        'The pipeline changed while a history update was validating; the older update was discarded.',
      );
  }

  getSql(): string {
    return buildPipelineSQL(this.history, this.relationName);
  }

  async getPage(
    offset: number,
    limit: number,
  ): Promise<{ schema: TableSchema; result: QueryResult; page: PageInfo }> {
    const sql = this.getSql();
    const [result, totalRows, columns] = await Promise.all([
      this.connection.query(
        `SELECT * FROM (${sql}) AS pipeline_result LIMIT ${limit} OFFSET ${offset}`,
      ),
      this.getRowCount(sql),
      this.getColumns(sql),
    ]);
    return {
      schema: { columns, rowCount: totalRows, filePath: this.filePath },
      result,
      page: { offset, limit, totalRows },
    };
  }

  async search(
    query: string,
    offset: number,
    limit: number,
    filter?: { column: string; operator: 'is_null' | 'is_not_null' },
  ): Promise<{ schema: TableSchema; result: QueryResult; page: PageInfo }> {
    const sql = this.getSql();
    const columns = await this.getColumns(sql);
    const escaped = query.replace(/'/g, "''");
    const predicate = columns
      .map(
        (column) =>
          `COALESCE(CAST(${quoteIdentifier(column.name)} AS VARCHAR), '') ILIKE '%${escaped}%'`,
      )
      .join(' OR ');
    const searchPredicate = predicate || 'TRUE';
    const filterPredicate = filter
      ? `${quoteIdentifier(filter.column)} ${filter.operator === 'is_null' ? 'IS NULL' : 'IS NOT NULL'}`
      : '';
    if (filter && !columns.some((column) => column.name === filter.column))
      throw new Error(`Unknown filter column: ${filter.column}`);
    const searchedSql = `SELECT * FROM (${sql}) AS pipeline_search WHERE (${searchPredicate})${filterPredicate ? ` AND (${filterPredicate})` : ''}`;
    const result = await this.connection.query(
      `SELECT *, COUNT(*) OVER () AS __qw_total_rows FROM (${searchedSql}) AS pipeline_search_page LIMIT ${limit} OFFSET ${offset}`,
    );
    let totalRows = Number(result.rows[0]?.[result.columns.length - 1] ?? 0);
    result.columns = result.columns.slice(0, -1);
    result.rows = result.rows.map((row) => row.slice(0, -1));
    result.rowCount = result.rows.length;
    if (result.rows.length === 0 && offset > 0) {
      const count = await this.connection.query(
        `SELECT COUNT(*) FROM (${searchedSql}) AS pipeline_search_count`,
      );
      totalRows = Number(count.rows[0]?.[0] ?? 0);
    }
    return {
      schema: { columns, rowCount: totalRows, filePath: this.filePath },
      result,
      page: { offset, limit, totalRows },
    };
  }

  async getStatistics(): Promise<ColumnStatistics[]> {
    const revision = this.revision;
    if (this.statisticsCache?.revision === revision) return this.statisticsCache.value;
    const sql = this.getSql();
    const columns = await this.getColumns(sql);

    // Bound concurrency to avoid exhausting DuckDB connections on wide schemas.
    const CONCURRENCY = 8;
    const results: ColumnStatistics[] = [];
    for (let i = 0; i < columns.length; i += CONCURRENCY) {
      const batch = columns.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map(async ({ name, type }) => {
          const id = quoteIdentifier(name);
          const normalizedType = type.toUpperCase().trim();
          const numeric =
            /^(?:U?TINYINT|U?SMALLINT|U?INTEGER|U?BIGINT|UHUGEINT|HUGEINT|FLOAT|REAL|DOUBLE|DECIMAL(?:\([^)]*\))?)$/.test(
              normalizedType,
            );
          const orderedScalar =
            numeric ||
            /^(?:VARCHAR|CHAR(?:\([^)]*\))?|BPCHAR|BOOLEAN|DATE|TIME(?: WITH TIME ZONE)?|TIMESTAMP(?: WITH TIME ZONE)?|TIMESTAMP_[A-Z]+|UUID)$/.test(
              normalizedType,
            );
          const aggregates = [
            `COUNT(*) - COUNT(${id})`,
            `COUNT(DISTINCT ${id})`,
            ...(orderedScalar ? [`MIN(${id})`, `MAX(${id})`] : []),
            ...(numeric
              ? [
                  `AVG(${id})`,
                  `QUANTILE_CONT(${id}, 0.5)`,
                  `QUANTILE_CONT(${id}, 0.9)`,
                  `QUANTILE_CONT(${id}, 0.99)`,
                  `(WITH histogram_source AS (${sql}), histogram_bounds AS (SELECT MIN(${id}) AS low_value, MAX(${id}) AS high_value FROM histogram_source), histogram_counts AS (SELECT ${Array.from({ length: 10 }, (_, bin) => `COUNT(*) FILTER (WHERE histogram_source.${id} >= histogram_bounds.low_value + (histogram_bounds.high_value - histogram_bounds.low_value) * ${bin / 10} AND histogram_source.${id} ${bin === 9 ? '<=' : '<'} histogram_bounds.low_value + (histogram_bounds.high_value - histogram_bounds.low_value) * ${(bin + 1) / 10}) AS bin_${bin}`).join(', ')} FROM histogram_source CROSS JOIN histogram_bounds) SELECT list_value(${Array.from({ length: 10 }, (_, bin) => `bin_${bin}`).join(', ')}) FROM histogram_counts)`,
                ]
              : []),
          ];
          const result = await this.connection.query(
            `SELECT ${aggregates.join(', ')} FROM (${sql}) AS pipeline_stats`,
          );
          const values = result.rows[0] ?? [];
          const percentileOffset = orderedScalar ? 4 : 2;
          const numberAt = (index: number): number | undefined => {
            if (values[index] === null || values[index] === undefined) return undefined;
            const v = Number(values[index]);
            return Number.isFinite(v) ? v : undefined;
          };
          return {
            name,
            type,
            nullCount: Number(values[0] ?? 0),
            distinctCount: Number(values[1] ?? 0),
            min: orderedScalar ? values[2] : undefined,
            max: orderedScalar ? values[3] : undefined,
            mean: numeric ? numberAt(percentileOffset) : undefined,
            p50: numeric ? numberAt(percentileOffset + 1) : undefined,
            p90: numeric ? numberAt(percentileOffset + 2) : undefined,
            p99: numeric ? numberAt(percentileOffset + 3) : undefined,
            histogram:
              numeric && Array.isArray(values[percentileOffset + 4])
                ? Array.from(values[percentileOffset + 4] as Iterable<unknown>, (value) =>
                    Number(value),
                  )
                : undefined,
          };
        }),
      );
      results.push(...batchResults);
    }
    // Only cache if the pipeline hasn't changed while we were computing.
    if (this.revision === revision) this.statisticsCache = { revision, value: results };
    return results;
  }

  async getQualitySummary(
    stats: ColumnStatistics[],
    sql = this.getSql(),
  ): Promise<DataQualitySummary> {
    const duplicateResult = await this.connection.query(
      `SELECT (SELECT COUNT(*) FROM (${sql}) AS all_rows) - (SELECT COUNT(*) FROM (SELECT DISTINCT * FROM (${sql}) AS distinct_source) AS distinct_rows)`,
    );
    const duplicateRows = Number(duplicateResult.rows[0]?.[0] ?? 0);
    const issues: DataQualitySummary['issues'] = [];
    for (const stat of stats) {
      if (stat.nullCount > 0) {
        issues.push({
          severity: 'warning',
          kind: 'nulls',
          column: stat.name,
          count: stat.nullCount,
          message: `${stat.name} contains ${stat.nullCount.toLocaleString()} null value${stat.nullCount === 1 ? '' : 's'}`,
        });
      }
      if (typeof stat.p50 === 'number' && typeof stat.p99 === 'number' && stat.p99 > stat.p50) {
        const id = quoteIdentifier(stat.name);
        const outlierResult = await this.connection.query(
          `WITH source AS (${sql}), bounds AS (SELECT QUANTILE_CONT(${id}, 0.25) AS q1, QUANTILE_CONT(${id}, 0.75) AS q3 FROM source) SELECT COUNT(*) FROM source, bounds WHERE ${id} < q1 - 1.5 * (q3 - q1) OR ${id} > q3 + 1.5 * (q3 - q1)`,
        );
        const count = Number(outlierResult.rows[0]?.[0] ?? 0);
        if (count > 0) {
          issues.push({
            severity: 'info',
            kind: 'outliers',
            column: stat.name,
            count,
            message: `${stat.name} has ${count.toLocaleString()} potential IQR outlier${count === 1 ? '' : 's'}`,
          });
        }
      }
    }
    if (duplicateRows > 0) {
      issues.unshift({
        severity: 'warning',
        kind: 'duplicates',
        count: duplicateRows,
        message: `${duplicateRows.toLocaleString()} duplicate row${duplicateRows === 1 ? '' : 's'} detected`,
      });
    }
    return { duplicateRows, issues };
  }

  async getChartData(chart: ChartRequest): Promise<QueryResult> {
    const sql = this.getSql();
    const x = quoteIdentifier(
      requiredString(chart as unknown as Record<string, unknown>, 'xColumn'),
    );
    const y = chart.yColumn ? quoteIdentifier(chart.yColumn) : undefined;
    if (chart.type === 'histogram') {
      return this.connection.query(
        `WITH source AS (${sql}), bounds AS (SELECT MIN(${x}) AS min_value, MAX(${x}) AS max_value FROM source), binned AS (SELECT ${x}, CASE WHEN max_value = min_value THEN 0 ELSE LEAST(19, FLOOR((${x} - min_value) / (max_value - min_value) * 20)) END AS bin FROM source, bounds WHERE ${x} IS NOT NULL) SELECT MIN(${x}) AS bin_start, MAX(${x}) AS bin_end, COUNT(*) AS count FROM binned GROUP BY bin ORDER BY bin`,
      );
    }
    if (chart.type === 'box') {
      return this.connection.query(
        `SELECT MIN(${x}), QUANTILE_CONT(${x}, 0.25), MEDIAN(${x}), QUANTILE_CONT(${x}, 0.75), MAX(${x}) FROM (${sql}) AS chart_source WHERE ${x} IS NOT NULL`,
      );
    }
    if (chart.type === 'correlation') {
      const columns = (chart.columns ?? [])
        .filter((column) => typeof column === 'string')
        .slice(0, 12);
      if (columns.length < 2) throw new Error('At least two numeric columns are required');
      const pairs = columns.flatMap((left, leftIndex) =>
        columns.slice(leftIndex).map((right) => [left, right]),
      );
      return this.connection.query(
        pairs
          .map(
            ([left, right]) =>
              `SELECT ${quoteLiteral(left)} AS x, ${quoteLiteral(right)} AS y, CORR(${quoteIdentifier(left)}, ${quoteIdentifier(right)}) AS value FROM (${sql}) AS chart_source`,
          )
          .join(' UNION ALL '),
      );
    }
    if (chart.type === 'scatter' || chart.type === 'line') {
      if (!y) throw new Error('A Y column is required');
      return this.connection.query(
        `SELECT ${x} AS x, ${y} AS y FROM (${sql}) AS chart_source WHERE ${x} IS NOT NULL AND ${y} IS NOT NULL ORDER BY ${x} LIMIT 500`,
      );
    }
    const aggregation = chart.aggregation ?? 'COUNT';
    if (!new Set(['COUNT', 'SUM', 'AVG', 'MIN', 'MAX']).has(aggregation)) {
      throw new Error(`Unsupported chart aggregation: ${aggregation}`);
    }
    if (aggregation !== 'COUNT' && !y) throw new Error('A value column is required');
    const measure = aggregation === 'COUNT' ? 'COUNT(*)' : `${aggregation}(${y})`;
    return this.connection.query(
      `SELECT ${x} AS category, ${measure} AS value FROM (${sql}) AS chart_source GROUP BY ${x} ORDER BY value DESC LIMIT 30`,
    );
  }
}
