import * as path from 'path';
import { DuckDBConnection } from './connection';
import { TableSchema, ColumnInfo, QueryResult } from '../types';

export type FileType = 'parquet' | 'csv' | 'tsv' | 'json' | 'jsonl' | 'unknown';

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
      return 'read_json_auto';
    default:
      throw new Error(`Unsupported file type: ${fileType}`);
  }
}

function getTableRef(filePath: string, fileType?: FileType): string {
  const type = fileType || detectFileType(filePath);
  const readFn = getReadFunction(type);
  return `${readFn}('${filePath.replace(/'/g, "''")}')`;
}

export async function loadFilePreview(
  connection: DuckDBConnection,
  filePath: string,
  limit: number = 100
): Promise<QueryResult> {
  const tableRef = getTableRef(filePath);
  const sql = `SELECT * FROM ${tableRef} LIMIT ${limit}`;
  return connection.query(sql);
}

export async function getFileMetadata(
  connection: DuckDBConnection,
  filePath: string
): Promise<TableSchema> {
  const tableRef = getTableRef(filePath);
  const fileType = detectFileType(filePath);

  const countResult = await connection.query(`SELECT COUNT(*) as cnt FROM ${tableRef}`);
  const rowCount = (countResult.rows[0] as any).cnt ?? countResult.rows[0][0] as number;

  const schemaResult = await connection.query(`DESCRIBE SELECT * FROM ${tableRef}`);

  const columns: ColumnInfo[] = schemaResult.rows.map((row, index) => ({
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
  const tableRef = getTableRef(filePath, fileType);

  try {
    await connection.query(`DROP TABLE IF EXISTS ${tableName}`);
    await connection.query(`CREATE TABLE ${tableName} AS SELECT * FROM ${tableRef}`);
  } catch (error) {
    throw new Error(`Failed to load file ${filePath}: ${error}`);
  }
}
