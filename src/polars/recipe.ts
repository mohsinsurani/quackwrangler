import type { TransformOperation } from '../types/index.js';

const SUPPORTED = new Set([
  'filter_rows',
  'filterRows',
  'rename_column',
  'renameColumn',
  'drop_column',
  'dropColumn',
  'sort_rows',
  'sortRows',
]);

export function buildPolarsRecipe(sourcePath: string, history: TransformOperation[]): string {
  if (/^(https?|s3):\/\//i.test(sourcePath))
    throw new Error('Polars recipes currently require a local Parquet source.');
  if (!sourcePath.toLowerCase().endsWith('.parquet'))
    throw new Error(
      'Polars recipes currently require a Parquet source so DuckDB and Polars use the same stored types.',
    );

  const unsupported = history.find((step) => !SUPPORTED.has(step.type));
  if (unsupported)
    throw new Error(
      `Polars recipe export does not support “${unsupported.description}” yet. Continue from the Parquet result to preserve the exact data.`,
    );

  for (const step of history) {
    if (step.type === 'filter_rows' || step.type === 'filterRows') {
      if (!['is_null', 'is_not_null'].includes(String(step.params.operator)))
        throw new Error(
          'Polars recipe export currently supports null filters only. Continue from the Parquet result to preserve the exact data.',
        );
      if (typeof step.params.column !== 'string' || !step.params.column)
        throw new Error('The recipe contains a null filter without a valid column.');
    }
    if (step.type === 'rename_column' || step.type === 'renameColumn') {
      if (typeof step.params.oldName !== 'string' || typeof step.params.newName !== 'string')
        throw new Error('The recipe contains an invalid column rename.');
    }
    if (step.type === 'drop_column' || step.type === 'dropColumn') {
      const columns = Array.isArray(step.params.columns)
        ? step.params.columns
        : [step.params.column];
      if (columns.length === 0 || columns.some((column) => typeof column !== 'string' || !column))
        throw new Error('The recipe contains an invalid column removal.');
    }
    if (step.type === 'sort_rows' || step.type === 'sortRows') {
      if (typeof step.params.column !== 'string' || !step.params.column)
        throw new Error('The recipe contains an invalid sort.');
      if (step.params.nullsFirst === true)
        throw new Error(
          'Sorting nulls first is not yet supported in Polars recipes. Continue from the Parquet result to preserve the exact ordering.',
        );
    }
    const columnNames = [
      ...(step.type === 'filter_rows' ||
      step.type === 'filterRows' ||
      step.type === 'sort_rows' ||
      step.type === 'sortRows'
        ? [step.params.column]
        : []),
      ...(step.type === 'rename_column' || step.type === 'renameColumn'
        ? [step.params.oldName, step.params.newName]
        : []),
      ...(step.type === 'drop_column' || step.type === 'dropColumn'
        ? Array.isArray(step.params.columns)
          ? step.params.columns
          : [step.params.column]
        : []),
    ];
    if (columnNames.some((column) => typeof column === 'string' && /[*?\[\]{}]/.test(column)))
      throw new Error(
        'This column name is interpreted as a Polars selector. Continue from the Parquet result to preserve the exact data.',
      );
    if (columnNames.some((column) => typeof column === 'string' && column.includes('`')))
      throw new Error(
        'Backticks in column names are not supported in Polars recipes. Continue from the Parquet result to preserve the exact data.',
      );
  }

  const lines = [
    'import polars as pl',
    '',
    `source = ${JSON.stringify(sourcePath)}`,
    'query = pl.scan_parquet(source)',
  ];
  for (const step of history) {
    const params = step.params;
    if (step.type === 'filter_rows' || step.type === 'filterRows') {
      const column = JSON.stringify(params.column);
      const method = params.operator === 'is_null' ? 'is_null' : 'is_not_null';
      lines.push(`query = query.filter(pl.col(${column}).${method}())`);
    } else if (step.type === 'rename_column' || step.type === 'renameColumn') {
      lines.push(
        `query = query.rename({${JSON.stringify(params.oldName)}: ${JSON.stringify(params.newName)}})`,
      );
    } else if (step.type === 'drop_column' || step.type === 'dropColumn') {
      const columns = Array.isArray(params.columns) ? params.columns : [params.column];
      lines.push(`query = query.drop(${JSON.stringify(columns)})`);
    } else if (step.type === 'sort_rows' || step.type === 'sortRows') {
      const descending = params.ascending === false || params.direction === 'DESC';
      lines.push(
        `query = query.sort(${JSON.stringify(params.column)}, descending=${descending ? 'True' : 'False'}, nulls_last=True, maintain_order=True)`,
      );
    }
  }
  lines.push('', 'result = query.collect()');
  return `${lines.join('\n')}\n`;
}
