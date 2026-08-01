import * as path from 'path';

import { TableSchema, ColumnInfo } from '../types/index.js';

import { DuckDBConnection } from './connection.js';
import { quoteLiteral } from './sql.js';

export type FileType =
  | 'parquet'
  | 'csv'
  | 'tsv'
  | 'json'
  | 'jsonl'
  | 'ndjson'
  | 'xlsx'
  | 'ods'
  | 'arrow'
  | 'orc'
  | 'unknown';

const preparedExtensions = new WeakMap<DuckDBConnection, Set<string>>();

export function detectFileType(filePath: string): FileType {
  const cleanPath = /^(https?|s3):\/\//i.test(filePath) ? new URL(filePath).pathname : filePath;
  const ext = path.extname(cleanPath).toLowerCase();
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
    case '.arrow':
    case '.arrows':
    case '.ipc':
      return 'arrow';
    case '.orc':
      return 'orc';
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
    case 'arrow':
      return 'read_arrow';
    case 'orc':
      return 'read_orc';
    default:
      throw new Error(`Unsupported file type: ${fileType}`);
  }
}

export function getTableRef(filePath: string, fileType?: FileType): string {
  const type = fileType || detectFileType(filePath);
  const readFn = getReadFunction(type);
  return `${readFn}(${quoteLiteral(filePath)})`;
}

async function prepareFileReader(connection: DuckDBConnection, fileType: FileType): Promise<void> {
  if (fileType === 'orc') {
    throw new Error(
      'ORC is recognized but this DuckDB runtime has no supported ORC reader. Convert the file to Parquet or CSV before opening it.',
    );
  }
  const extension =
    fileType === 'xlsx'
      ? 'excel'
      : fileType === 'ods'
        ? 'spatial'
        : fileType === 'arrow'
          ? 'nanoarrow'
          : undefined;
  if (!extension) return;
  const loaded = preparedExtensions.get(connection) ?? new Set<string>();
  preparedExtensions.set(connection, loaded);
  if (loaded.has(extension)) return;
  try {
    await connection.query(
      extension === 'nanoarrow' ? 'INSTALL nanoarrow FROM community' : `INSTALL ${extension}`,
    );
    await connection.query(`LOAD ${extension}`);
    loaded.add(extension);
  } catch (error) {
    throw new Error(
      `Opening ${fileType} requires DuckDB's signed ${extension} extension. Check your internet connection and try again. ${error}`,
    );
  }
}

export async function prepareDataFileReader(
  connection: DuckDBConnection,
  filePath: string,
): Promise<void> {
  if (/^(https?|s3):\/\//i.test(filePath)) await prepareRemoteReader(connection);
  await prepareFileReader(connection, detectFileType(filePath));
}

export async function prepareRemoteReader(connection: DuckDBConnection): Promise<void> {
  const loaded = preparedExtensions.get(connection) ?? new Set<string>();
  preparedExtensions.set(connection, loaded);
  if (loaded.has('httpfs')) return;
  try {
    await connection.query('INSTALL httpfs');
    await connection.query('LOAD httpfs');
    loaded.add('httpfs');
  } catch (error) {
    throw new Error(`Remote files require DuckDB's httpfs extension. ${error}`);
  }
}

export async function getFileMetadata(
  connection: DuckDBConnection,
  filePath: string,
): Promise<TableSchema> {
  const fileType = detectFileType(filePath);
  if (fileType === 'unknown') throw new Error('Unsupported or missing remote file extension');
  if (/^(https?|s3):\/\//i.test(filePath)) await prepareRemoteReader(connection);
  await prepareFileReader(connection, fileType);
  const tableRef = getTableRef(filePath, fileType);

  const countResult = await connection.query(`SELECT COUNT(*) as cnt FROM ${tableRef}`);
  const rowCount = (countResult.rows[0]?.[0] as number) ?? 0;

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

export async function loadFile(connection: DuckDBConnection, filePath: string): Promise<void> {
  const fileType = detectFileType(filePath);
  if (fileType === 'unknown') throw new Error(`Unsupported file type: ${filePath}`);
  if (/^(https?|s3):\/\//i.test(filePath)) await prepareRemoteReader(connection);
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
