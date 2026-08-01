import { randomUUID } from 'node:crypto';

import { DuckDBConnection } from '../duckdb/connection.js';
import { getTableRef } from '../duckdb/parquet-loader.js';
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
      return `SELECT left_data.*, right_data.* FROM current_data AS left_data ${joinType} JOIN ${getTableRef(filePath)} AS right_data ON left_data.${leftColumn} = right_data.${rightColumn}`;
    }
    case 'union_file': {
      const filePath = requiredString(params, 'filePath');
      return `SELECT * FROM current_data UNION ALL BY NAME SELECT * FROM ${getTableRef(filePath)}`;
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
      const rawValue = requiredString(params, 'value');
      const value = /^-?\d+(\.\d+)?$|^(true|false|null)$/i.test(rawValue)
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

  constructor(private readonly connection: DuckDBConnection) {}

  load(filePath: string): void {
    this.filePath = filePath;
    this.history = [];
    this.redoStack = [];
  }

  apply(type: string, params: Record<string, unknown>): void {
    const sql = operationSql(type, params);
    this.history.push({
      id: randomUUID(),
      type,
      params,
      sql,
      description: descriptionFor(type, params),
    });
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

  remove(id: string): void {
    this.history = this.history.filter((step) => step.id !== id);
    this.redoStack = [];
  }

  reorder(sourceId: string, targetId: string): void {
    const sourceIndex = this.history.findIndex((step) => step.id === sourceId);
    const targetIndex = this.history.findIndex((step) => step.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return;
    const [step] = this.history.splice(sourceIndex, 1);
    this.history.splice(targetIndex, 0, step);
    this.redoStack = [];
  }

  getFilePath(): string {
    return this.filePath;
  }
  getHistory(): TransformOperation[] {
    return [...this.history];
  }
  restore(history: Array<Pick<TransformOperation, 'type' | 'params'>>): void {
    this.history = [];
    this.redoStack = [];
    for (const step of history) this.apply(step.type, step.params);
  }
  getSql(): string {
    return buildPipelineSQL(this.history);
  }

  async getPage(
    offset: number,
    limit: number,
  ): Promise<{ schema: TableSchema; result: QueryResult; page: PageInfo }> {
    const sql = this.getSql();
    const [result, count, described] = await Promise.all([
      this.connection.query(
        `SELECT * FROM (${sql}) AS pipeline_result LIMIT ${limit} OFFSET ${offset}`,
      ),
      this.connection.query(`SELECT COUNT(*) FROM (${sql}) AS pipeline_count`),
      this.connection.query(`DESCRIBE SELECT * FROM (${sql}) AS pipeline_schema`),
    ]);
    const totalRows = Number(count.rows[0]?.[0] ?? 0);
    const columns: ColumnInfo[] = described.rows.map((row) => ({
      name: String(row[0]),
      type: String(row[1]),
      nullable: String(row[2]).toUpperCase() === 'YES',
    }));
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
  ): Promise<{ schema: TableSchema; result: QueryResult; page: PageInfo }> {
    const sql = this.getSql();
    const described = await this.connection.query(
      `DESCRIBE SELECT * FROM (${sql}) AS pipeline_schema`,
    );
    const columns: ColumnInfo[] = described.rows.map((row) => ({
      name: String(row[0]),
      type: String(row[1]),
      nullable: String(row[2]).toUpperCase() === 'YES',
    }));
    const escaped = query.replace(/'/g, "''");
    const predicate = columns
      .map(
        (column) =>
          `COALESCE(CAST(${quoteIdentifier(column.name)} AS VARCHAR), '') ILIKE '%${escaped}%'`,
      )
      .join(' OR ');
    const searchedSql = `SELECT * FROM (${sql}) AS pipeline_search WHERE ${predicate || 'FALSE'}`;
    const [result, count] = await Promise.all([
      this.connection.query(`${searchedSql} LIMIT ${limit} OFFSET ${offset}`),
      this.connection.query(`SELECT COUNT(*) FROM (${searchedSql}) AS pipeline_search_count`),
    ]);
    const totalRows = Number(count.rows[0]?.[0] ?? 0);
    return {
      schema: { columns, rowCount: totalRows, filePath: this.filePath },
      result,
      page: { offset, limit, totalRows },
    };
  }

  async getStatistics(): Promise<ColumnStatistics[]> {
    const sql = this.getSql();
    const described = await this.connection.query(
      `DESCRIBE SELECT * FROM (${sql}) AS pipeline_schema`,
    );
    return Promise.all(
      described.rows.map(async (row) => {
        const name = String(row[0]);
        const type = String(row[1]);
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
              ]
            : []),
        ];
        const result = await this.connection.query(
          `SELECT ${aggregates.join(', ')} FROM (${sql}) AS pipeline_stats`,
        );
        const values = result.rows[0] ?? [];
        const numberAt = (index: number): number | undefined => {
          if (values[index] === null || values[index] === undefined) return undefined;
          const value = Number(values[index]);
          return Number.isFinite(value) ? value : undefined;
        };
        return {
          name,
          type,
          nullCount: Number(values[0] ?? 0),
          distinctCount: Number(values[1] ?? 0),
          min: orderedScalar ? values[2] : undefined,
          max: orderedScalar ? values[3] : undefined,
          mean: numeric ? numberAt(4) : undefined,
          p50: numeric ? numberAt(5) : undefined,
          p90: numeric ? numberAt(6) : undefined,
          p99: numeric ? numberAt(7) : undefined,
        };
      }),
    );
  }

  async getQualitySummary(stats: ColumnStatistics[]): Promise<DataQualitySummary> {
    const sql = this.getSql();
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
