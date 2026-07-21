import * as path from 'path';
import * as vscode from 'vscode';
import { DuckDBConnection } from './connection';
import { QueryResult } from '../types';

interface SelectOptions {
  columns?: string[];
  filters?: string[];
  sorts?: { column: string; ascending: boolean }[];
  limit?: number;
  offset?: number;
}

function getTableRef(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.parquet':
      return `read_parquet('${filePath.replace(/'/g, "''")}')`;
    case '.csv':
    case '.tsv':
      return `read_csv_auto('${filePath.replace(/'/g, "''")}')`;
    case '.json':
    case '.jsonl':
      return `read_json_auto('${filePath.replace(/'/g, "''")}')`;
    default:
      throw new Error(`Unsupported file type: ${ext}`);
  }
}

export async function executeQuery(
  connection: DuckDBConnection,
  sql: string,
  filePath?: string
): Promise<QueryResult> {
  if (filePath && sql.trim().toUpperCase().startsWith('SELECT')) {
    const tableRef = getTableRef(filePath);
    const fullSql = sql.replace(/FROM\s+current_data/i, `FROM ${tableRef}`);
    return connection.query(fullSql);
  }
  return connection.query(sql);
}

export function buildSelectQuery(
  filePath: string,
  options: SelectOptions = {}
): string {
  const tableRef = getTableRef(filePath);
  const columns = options.columns?.join(', ') || '*';

  let sql = `SELECT ${columns} FROM ${tableRef}`;

  if (options.filters && options.filters.length > 0) {
    sql += ` WHERE ${options.filters.join(' AND ')}`;
  }

  if (options.sorts && options.sorts.length > 0) {
    const orderClauses = options.sorts.map(
      s => `${s.column} ${s.ascending ? 'ASC' : 'DESC'}`
    );
    sql += ` ORDER BY ${orderClauses.join(', ')}`;
  }

  if (options.offset !== undefined && options.limit !== undefined) {
    sql += ` LIMIT ${options.limit} OFFSET ${options.offset}`;
  } else if (options.limit !== undefined) {
    sql += ` LIMIT ${options.limit}`;
  }

  return sql;
}

export async function paginateResults(
  connection: DuckDBConnection,
  baseSql: string,
  offset: number,
  limit: number
): Promise<QueryResult> {
  const trimmedSql = baseSql.replace(/;$/, '');
  const sql = `${trimmedSql} LIMIT ${limit} OFFSET ${offset}`;
  return connection.query(sql);
}

export async function exportResults(
  connection: DuckDBConnection,
  sql: string,
  outputPath: string,
  format: 'parquet' | 'csv' | 'json'
): Promise<void> {
  const trimmedSql = sql.replace(/;$/, '');
  const escapedPath = outputPath.replace(/'/g, "''");

  let exportSql: string;
  switch (format) {
    case 'parquet':
      exportSql = `COPY (${trimmedSql}) TO '${escapedPath}' (FORMAT PARQUET)`;
      break;
    case 'csv':
      exportSql = `COPY (${trimmedSql}) TO '${escapedPath}' (FORMAT CSV, HEADER)`;
      break;
    case 'json':
      exportSql = `COPY (${trimmedSql}) TO '${escapedPath}' (FORMAT JSON)`;
      break;
    default:
      throw new Error(`Unsupported export format: ${format}`);
  }

  await connection.query(exportSql);
}
