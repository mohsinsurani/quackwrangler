import * as path from 'path';

import { TableSchema, ColumnInfo, QueryResult } from '../types/index.js';

import { DuckDBConnection } from './connection.js';

export type FileType = 'parquet' | 'csv' | 'tsv' | 'json' | 'jsonl' | 'ndjson' | 'xlsx' | 'ods' | 'unknown';

const preparedExtensions = new WeakMap<DuckDBConnection, Set<string>>();

export function detectFileType(filePath: string): FileType {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.parquet':
      return 'parquet';
    case '.csv':
      return 'csv';
    case '.tsv':
      return 'tsv';
    case '.json':
      return 'json';
    case '.jsonl':
      return 'jsonl';
    case '.ndjson':
      return 'ndjson';
    case '.xlsx':
      return 'xlsx';
    case '.ods':
      return 'ods';
    default:
      return 'unknown';
  }
}

function getReadFunction(fileType: FileType): string {
  switch (fileType) {
    case 'parquet':
      return 'read_parquet';
    case 'csv':
    case 'tsv':
      return 'read_csv_auto';
    case 'json':
    case 'jsonl':
    case 'ndjson':
      return 'read_json_auto';
    case 'xlsx':
      return 'read_xlsx';
    case 'ods':
      return 'ST_Read';
    default:
      throw new Error(`Unsupported file type: ${fileType}`);
  }
}

export function getTableRef(filePath: string, fileType?: FileType): string {
  const type = fileType || detectFileType(filePath);
  const readFn = getReadFunction(type);
  return `${readFn}('${filePath.replace(/'/g, "''")}')`;
}

async function prepareFileReader(connection: DuckDBConnection, fileType: FileType): Promise<void> {
  const extension = fileType === 'xlsx' ? 'excel' : fileType === 'ods' ? 'spatial' : undefined;
  if (!extension) return;
  const loaded = preparedExtensions.get(connection) ?? new Set<string>();
  preparedExtensions.set(connection, loaded);
  if (loaded.has(extension)) return;
  try {
    await connection.query(`INSTALL ${extension}`);
    await connection.query(`LOAD ${extension}`);
    loaded.add(extension);
  } catch (error) {
    throw new Error(
      `Opening .${fileType} requires DuckDB's ${extension} extension. Check your internet connection and try again. ${error}`,
    );
  }
}

export async function loadFilePreview(
  connection: DuckDBConnection,
  filePath: string,
  limit: number = 100
): Promise<QueryResult> {
  const fileType = detectFileType(filePath);
  await prepareFileReader(connection, fileType);
  const tableRef = getTableRef(filePath, fileType);
  const sql = `SELECT * FROM ${tableRef} LIMIT ${limit}`;
  return connection.query(sql);
}

export async function getFileMetadata(
  connection: DuckDBConnection,
  filePath: string
): Promise<TableSchema> {
  const fileType = detectFileType(filePath);
  await prepareFileReader(connection, fileType);
  const tableRef = getTableRef(filePath, fileType);

  const countResult = await connection.query(`SELECT COUNT(*) as cnt FROM ${tableRef}`);
  const rowCount = countResult.rows[0]?.[0] as number ?? 0;

  const schemaResult = await connection.query(`DESCRIBE SELECT * FROM ${tableRef}`);

  const columns: ColumnInfo[] = schemaResult.rows.map((row: unknown[]) => ({
    name: row[0] as string,
    type: row[1] as string,
    nullable: (row[2] as string)?.toUpperCase() === 'YES',
    description: undefined,
  }));

  return {
    columns,
    rowCount: Number(rowCount),
    filePath,
  };
}

export async function loadFile(
  connection: DuckDBConnection,
  filePath: string
): Promise<void> {
  const fileType = detectFileType(filePath);
  const tableName = 'current_data';
  await prepareFileReader(connection, fileType);
  const tableRef = getTableRef(filePath, fileType);

  try {
    await connection.query(`DROP TABLE IF EXISTS ${tableName}`);
    await connection.query(`CREATE TABLE ${tableName} AS SELECT * FROM ${tableRef}`);
  } catch (error) {
    throw new Error(`Failed to load file ${filePath}: ${error}`);
  }
}
