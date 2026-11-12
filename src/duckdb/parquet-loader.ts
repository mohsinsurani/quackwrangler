import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import * as path from 'path';

import * as XLSX from '@e965/xlsx';

import { TableSchema, ColumnInfo } from '../types/index.js';

import { DuckDBConnection } from './connection.js';
import { CsvColumnType, csvTypesOption, resolveCsvColumnTypes } from './csv-schema.js';
import { quoteIdentifier, quoteLiteral } from './sql.js';

export type FileType =
  | 'parquet'
  | 'csv'
  | 'tsv'
  | 'json'
  | 'jsonl'
  | 'ndjson'
  | 'xlsx'
  | 'xls'
  | 'ods'
  | 'arrow'
  | 'orc'
  | 'unknown';

export type LoadingMode = 'auto' | 'eager' | 'lazy';

interface XlsxColumnType {
  name: string;
  type: 'BIGINT' | 'DOUBLE' | 'DATE' | 'TIMESTAMP' | 'TIME' | 'BOOLEAN' | 'VARCHAR';
  excelSerial?: boolean;
}

export async function resolveLoadingMode(
  filePath: string,
  mode: LoadingMode,
  eagerFileSizeLimitMb: number,
): Promise<'eager' | 'lazy'> {
  if (mode !== 'auto') return mode;
  if (/^(https?|s3):\/\//i.test(filePath)) return 'lazy';
  const size = (await stat(filePath)).size;
  return size <= eagerFileSizeLimitMb * 1024 * 1024 ? 'eager' : 'lazy';
}

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
    case '.xls':
      return 'xls';
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
      return 'read_csv';
    case 'json':
    case 'jsonl':
    case 'ndjson':
      return 'read_json_auto';
    case 'xlsx':
    case 'xls':
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

function isCsvLike(fileType: FileType): boolean {
  return fileType === 'csv' || fileType === 'tsv';
}

const convertedLegacyExcel = new WeakMap<DuckDBConnection, Map<string, string>>();

async function resolveReaderPath(connection: DuckDBConnection, filePath: string): Promise<string> {
  if (detectFileType(filePath) !== 'xls') return filePath;
  if (/^(https?|s3):\/\//i.test(filePath)) {
    throw new Error('Remote .xls files must be downloaded and converted locally before opening.');
  }
  const cached = convertedLegacyExcel.get(connection)?.get(filePath);
  if (cached) return cached;
  const tempDirectory = connection.getTempDirectory();
  if (!tempDirectory) throw new Error('Legacy .xls conversion requires a DuckDB temp directory.');
  await mkdir(tempDirectory, { recursive: true });
  const workbook = XLSX.read(await readFile(filePath), { type: 'buffer', cellDates: true });
  const convertedPath = path.join(
    tempDirectory,
    `quackwrangler-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}.xlsx`,
  );
  await writeFile(convertedPath, XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' }));
  const cache = convertedLegacyExcel.get(connection) ?? new Map<string, string>();
  convertedLegacyExcel.set(connection, cache);
  cache.set(filePath, convertedPath);
  return convertedPath;
}

/**
 * Column types resolved once per source, keyed by connection then path, so a
 * reader reference can be rebuilt synchronously without re-running detection.
 */
const resolvedCsvSchemas = new WeakMap<DuckDBConnection, Map<string, CsvColumnType[]>>();
const resolvedXlsxSchemas = new WeakMap<DuckDBConnection, Map<string, XlsxColumnType[]>>();

export function cacheCsvColumnTypes(
  connection: DuckDBConnection,
  filePath: string,
  columns: CsvColumnType[],
): void {
  const cache = resolvedCsvSchemas.get(connection) ?? new Map<string, CsvColumnType[]>();
  resolvedCsvSchemas.set(connection, cache);
  cache.set(filePath, columns);
}

export function getCachedCsvColumnTypes(
  connection: DuckDBConnection,
  filePath: string,
): CsvColumnType[] | undefined {
  return resolvedCsvSchemas.get(connection)?.get(filePath);
}

function getCachedXlsxColumnTypes(
  connection: DuckDBConnection,
  filePath: string,
): XlsxColumnType[] | undefined {
  return resolvedXlsxSchemas.get(connection)?.get(filePath);
}

function cacheXlsxColumnTypes(
  connection: DuckDBConnection,
  filePath: string,
  columns: XlsxColumnType[],
): void {
  const cache = resolvedXlsxSchemas.get(connection) ?? new Map<string, XlsxColumnType[]>();
  resolvedXlsxSchemas.set(connection, cache);
  cache.set(filePath, columns);
}

function xlsxValuePredicate(column: string, expression: string): string {
  const id = quoteIdentifier(column);
  return `NULLIF(TRIM(CAST(${id} AS VARCHAR)), '') IS NOT NULL AND ${expression}`;
}

async function resolveXlsxColumnTypes(
  connection: DuckDBConnection,
  filePath: string,
  header = false,
): Promise<XlsxColumnType[]> {
  const headerOption = header ? ', header=true' : '';
  const source = `read_xlsx(${quoteLiteral(filePath)}, all_varchar=true${headerOption})`;
  const schema = await connection.query(`DESCRIBE SELECT * FROM ${source}`);
  const names = schema.rows.map((row: unknown[]) => String(row[0]));
  if (names.length === 0) return [];
  const nativeSchema = await connection.query(
    `DESCRIBE SELECT * FROM read_xlsx(${quoteLiteral(filePath)}${header ? ', header=true' : ''})`,
  );
  const nativeTypes = new Map(
    nativeSchema.rows.map((row: unknown[]) => [String(row[0]), String(row[1]).toUpperCase()]),
  );

  const metrics = names
    .map((name, columnIndex) => {
      const id = quoteIdentifier(name);
      return [
        `COUNT(${id})`,
        `COUNT(*) FILTER (WHERE ${xlsxValuePredicate(name, `TRY_CAST(TRIM(CAST(${id} AS VARCHAR)) AS BIGINT) IS NULL`)})`,
        `COUNT(*) FILTER (WHERE ${xlsxValuePredicate(name, `TRY_CAST(TRIM(CAST(${id} AS VARCHAR)) AS DOUBLE) IS NULL`)})`,
        `COUNT(*) FILTER (WHERE ${xlsxValuePredicate(name, `NOT REGEXP_MATCHES(TRIM(CAST(${id} AS VARCHAR)), '^\\d{4}-\\d{2}-\\d{2}$') OR TRY_CAST(TRIM(CAST(${id} AS VARCHAR)) AS DATE) IS NULL`)})`,
        `COUNT(*) FILTER (WHERE ${xlsxValuePredicate(name, `NOT REGEXP_MATCHES(TRIM(CAST(${id} AS VARCHAR)), '^\\d{4}-\\d{2}-\\d{2}[T ]\\d{2}:\\d{2}:\\d{2}') OR TRY_CAST(TRIM(CAST(${id} AS VARCHAR)) AS TIMESTAMP) IS NULL`)})`,
        `COUNT(*) FILTER (WHERE ${xlsxValuePredicate(name, `REGEXP_MATCHES(TRIM(CAST(${id} AS VARCHAR)), '^[+-]?0[0-9]+$')`)})`,
        `COUNT(*) FILTER (WHERE ${xlsxValuePredicate(name, `LOWER(TRIM(CAST(${id} AS VARCHAR))) NOT IN ('0', '1', 'true', 'false')`)})`,
      ].map(
        (expression, metricIndex) =>
          `${expression} AS ${quoteIdentifier(`m${columnIndex * 7 + metricIndex}`)}`,
      );
    })
    .flat()
    .join(', ');
  const result = await connection.query(
    `WITH source AS (SELECT * FROM ${source}) SELECT ${metrics} FROM source`,
  );
  const row = result.rows[0] ?? [];

  return names.map((name, index) => {
    const offset = index * 7;
    const nonNull = Number(row[offset] ?? 0);
    const invalidInteger = Number(row[offset + 1] ?? 0);
    const invalidDouble = Number(row[offset + 2] ?? 0);
    const invalidDate = Number(row[offset + 3] ?? 0);
    const invalidTimestamp = Number(row[offset + 4] ?? 0);
    const leadingZero = Number(row[offset + 5] ?? 0);
    const invalidBoolean = Number(row[offset + 6] ?? 0);
    const nativeType = nativeTypes.get(name);
    let type: XlsxColumnType['type'] = 'VARCHAR';
    let excelSerial = false;
    if (
      nonNull > 0 &&
      invalidDouble === 0 &&
      ['DATE', 'TIMESTAMP', 'TIME'].includes(nativeType ?? '')
    ) {
      type = nativeType as 'DATE' | 'TIMESTAMP' | 'TIME';
      excelSerial = true;
    } else if (nonNull > 0 && invalidBoolean === 0 && nativeType === 'BOOLEAN') type = 'BOOLEAN';
    else if (nonNull > 0 && invalidInteger === 0 && leadingZero === 0) type = 'BIGINT';
    else if (nonNull > 0 && invalidDouble === 0) type = 'DOUBLE';
    else if (nonNull > 0 && invalidDate === 0) type = 'DATE';
    else if (nonNull > 0 && invalidTimestamp === 0) type = 'TIMESTAMP';
    return { name, type, excelSerial };
  });
}

/**
 * Resolves and caches source types. CSV/TSV use their reject-aware resolver;
 * XLSX starts as text and selectively restores safe integer and decimal types.
 */
export async function prepareSourceSchema(
  connection: DuckDBConnection,
  filePath: string,
  fileType?: FileType,
): Promise<void> {
  const type = fileType || detectFileType(filePath);
  if (type === 'xls') {
    const readerPath = await resolveReaderPath(connection, filePath);
    const columns = await resolveXlsxColumnTypes(connection, readerPath, true);
    if (columns.length > 0) {
      cacheXlsxColumnTypes(connection, readerPath, columns);
      cacheXlsxColumnTypes(connection, filePath, columns);
    }
    return;
  }
  if (isCsvLike(type)) {
    if (getCachedCsvColumnTypes(connection, filePath)) return;
    const columns = await resolveCsvColumnTypes(connection, filePath);
    if (columns.length > 0) cacheCsvColumnTypes(connection, filePath, columns);
    return;
  }
  if (type === 'xlsx' && !getCachedXlsxColumnTypes(connection, filePath)) {
    const columns = await resolveXlsxColumnTypes(connection, filePath);
    if (columns.length > 0) cacheXlsxColumnTypes(connection, filePath, columns);
  }
}

export function getTableRef(
  filePath: string,
  fileType?: FileType,
  csvColumns?: CsvColumnType[],
  xlsxColumns?: XlsxColumnType[],
  xlsxHeader = false,
): string {
  const type = fileType || detectFileType(filePath);
  const readFn = getReadFunction(type);
  if (isCsvLike(type)) {
    // Pin the resolved schema so no query repeats type detection. Without a
    // resolved schema, fall back to DuckDB's own auto-detection.
    if (csvColumns && csvColumns.length > 0) {
      return `${readFn}(${quoteLiteral(filePath)}, ${csvTypesOption(csvColumns)})`;
    }
    return `read_csv_auto(${quoteLiteral(filePath)})`;
  }
  if (type === 'xlsx') {
    const source = `${readFn}(${quoteLiteral(filePath)}, all_varchar=true${xlsxHeader ? ', header=true' : ''})`;
    if (!xlsxColumns || xlsxColumns.length === 0) return source;
    const projection = xlsxColumns
      .map(({ name, type: targetType, excelSerial }) => {
        const id = quoteIdentifier(name);
        if (targetType === 'VARCHAR') return id;
        if (excelSerial && targetType === 'DATE') {
          return `CAST(DATE '1899-12-30' + CAST(FLOOR(TRY_CAST(${id} AS DOUBLE)) AS INTEGER) AS DATE) AS ${id}`;
        }
        if (excelSerial && targetType === 'TIMESTAMP') {
          return `TIMESTAMP '1899-12-30' + TRY_CAST(${id} AS DOUBLE) * INTERVAL 1 DAY AS ${id}`;
        }
        if (excelSerial && targetType === 'TIME') {
          return `CAST(TIMESTAMP '1899-12-30' + TRY_CAST(${id} AS DOUBLE) * INTERVAL 1 DAY AS TIME) AS ${id}`;
        }
        if (targetType === 'BOOLEAN') {
          return `CASE LOWER(TRIM(${id})) WHEN '1' THEN true WHEN 'true' THEN true WHEN '0' THEN false WHEN 'false' THEN false END AS ${id}`;
        }
        return `TRY_CAST(${id} AS ${targetType}) AS ${id}`;
      })
      .join(', ');
    return `(SELECT ${projection} FROM ${source})`;
  }
  if (type === 'ods') {
    return `(SELECT * EXCLUDE (OGC_FID) FROM ${readFn}(${quoteLiteral(filePath)}))`;
  }
  if (type === 'xls') {
    return `${readFn}(${quoteLiteral(filePath)}, all_varchar=true)`;
  }
  return `${readFn}(${quoteLiteral(filePath)})`;
}

/**
 * Builds a reader reference using any schema already resolved for `connection`.
 */
export function getConnectionTableRef(
  connection: DuckDBConnection,
  filePath: string,
  fileType?: FileType,
): string {
  const readerPath = convertedLegacyExcel.get(connection)?.get(filePath) ?? filePath;
  const legacyXls = fileType === 'xls' || detectFileType(filePath) === 'xls';
  const readerType = legacyXls ? 'xlsx' : fileType;
  return getTableRef(
    readerPath,
    readerType,
    getCachedCsvColumnTypes(connection, filePath),
    getCachedXlsxColumnTypes(connection, readerPath) ??
      getCachedXlsxColumnTypes(connection, filePath),
    legacyXls,
  );
}

async function prepareFileReader(connection: DuckDBConnection, fileType: FileType): Promise<void> {
  const extension =
    fileType === 'xlsx' || fileType === 'xls'
      ? 'excel'
      : fileType === 'ods'
        ? 'spatial'
        : fileType === 'arrow'
          ? 'nanoarrow'
          : fileType === 'orc'
            ? 'orc'
            : undefined;
  if (!extension) return;
  const loaded = preparedExtensions.get(connection) ?? new Set<string>();
  preparedExtensions.set(connection, loaded);
  if (loaded.has(extension)) return;
  try {
    await connection.query(`LOAD ${extension}`);
    loaded.add(extension);
    return;
  } catch {
    // A cached extension loads without network access. Install only when this
    // DuckDB version/platform has not downloaded it before.
  }
  try {
    const communityExtension = extension === 'nanoarrow' || extension === 'orc';
    await connection.query(
      communityExtension ? `INSTALL ${extension} FROM community` : `INSTALL ${extension}`,
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
  const fileType = detectFileType(filePath);
  if (fileType === 'xls') {
    await resolveReaderPath(connection, filePath);
    await prepareFileReader(connection, 'xlsx');
    await prepareSourceSchema(connection, filePath, 'xls');
    return;
  }
  await prepareFileReader(connection, fileType);
  await prepareSourceSchema(connection, filePath, fileType);
}

export async function prepareRemoteReader(connection: DuckDBConnection): Promise<void> {
  const loaded = preparedExtensions.get(connection) ?? new Set<string>();
  preparedExtensions.set(connection, loaded);
  if (loaded.has('httpfs')) return;
  try {
    await connection.query('LOAD httpfs');
    loaded.add('httpfs');
    return;
  } catch {
    // Prefer the cached signed extension so repeat remote opens work offline.
  }
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
  await prepareSourceSchema(connection, filePath, fileType);
  const tableRef = getConnectionTableRef(connection, filePath, fileType);

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

export async function loadFile(
  connection: DuckDBConnection,
  filePath: string,
  mode: LoadingMode = 'auto',
  eagerFileSizeLimitMb = 64,
  relationName = 'current_data',
): Promise<'eager' | 'lazy'> {
  const fileType = detectFileType(filePath);
  if (fileType === 'unknown') throw new Error(`Unsupported file type: ${filePath}`);
  if (/^(https?|s3):\/\//i.test(filePath)) await prepareRemoteReader(connection);
  await prepareFileReader(connection, fileType);
  await prepareSourceSchema(connection, filePath, fileType);
  const tableRef = getConnectionTableRef(connection, filePath, fileType);
  const resolvedMode = await resolveLoadingMode(filePath, mode, eagerFileSizeLimitMb);

  const suffix = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  const stagingView = `${relationName}_staging_${suffix}`;
  const stagingTable = `${relationName}_materialized_${suffix}`;
  const finalTable = `${relationName}_materialized`;
  const stagingViewId = quoteIdentifier(stagingView);
  const stagingTableId = quoteIdentifier(stagingTable);
  const finalViewId = quoteIdentifier(relationName);
  const finalTableId = quoteIdentifier(finalTable);

  try {
    if (resolvedMode === 'eager') {
      await connection.query(`CREATE TABLE ${stagingTableId} AS SELECT * FROM ${tableRef}`);
    } else {
      await connection.query(`CREATE VIEW ${stagingViewId} AS SELECT * FROM ${tableRef}`);
    }
    await connection.transaction(async (transaction) => {
      await transaction.query(`DROP VIEW IF EXISTS ${finalViewId}`);
      await transaction.query(`DROP TABLE IF EXISTS ${finalTableId}`);
      if (resolvedMode === 'eager') {
        await transaction.query(`ALTER TABLE ${stagingTableId} RENAME TO ${finalTableId}`);
        await transaction.query(`CREATE VIEW ${finalViewId} AS SELECT * FROM ${finalTableId}`);
      } else {
        await transaction.query(`ALTER VIEW ${stagingViewId} RENAME TO ${finalViewId}`);
      }
    });
  } catch (error) {
    await connection.query(`DROP VIEW IF EXISTS ${stagingViewId}`).catch(() => undefined);
    await connection.query(`DROP TABLE IF EXISTS ${stagingTableId}`).catch(() => undefined);
    throw new Error(`Failed to load file ${filePath}: ${error}`);
  }
  return resolvedMode;
}
