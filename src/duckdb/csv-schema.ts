import { randomBytes } from 'node:crypto';

import { DuckDBConnection } from './connection.js';
import { quoteIdentifier, quoteLiteral } from './sql.js';

export interface CsvColumnType {
  name: string;
  type: string;
}

/**
 * DuckDB type names that `sniff_csv` can return. Sniffed types are produced by
 * DuckDB itself rather than user input, but they are re-emitted into SQL, so
 * they are allow-listed before being interpolated.
 */
const SNIFFABLE_TYPES = new Set([
  'BIGINT',
  'BOOLEAN',
  'DATE',
  'DECIMAL',
  'DOUBLE',
  'FLOAT',
  'HUGEINT',
  'INTEGER',
  'INTERVAL',
  'SMALLINT',
  'TIME',
  'TIMESTAMP',
  'TIMESTAMP WITH TIME ZONE',
  'TIMESTAMP_MS',
  'TIMESTAMP_NS',
  'TIMESTAMP_S',
  'TINYINT',
  'UBIGINT',
  'UINTEGER',
  'USMALLINT',
  'UTINYINT',
  'UUID',
  'VARCHAR',
]);

const WIDEST_TYPE = 'VARCHAR';

function normalizeSniffedType(type: string): string {
  const upper = type.trim().toUpperCase();
  if (SNIFFABLE_TYPES.has(upper)) return upper;
  // DECIMAL(p,s) and similar parameterized forms are safe once the base name is
  // known; anything else falls back to the widest lossless type.
  const base = upper.replace(/\(.*\)$/, '').trim();
  if (SNIFFABLE_TYPES.has(base)) return upper.replace(/[^A-Z0-9(),. ]/g, '');
  return WIDEST_TYPE;
}

export function csvTypesOption(columns: CsvColumnType[]): string {
  const entries = columns
    .map((column) => `${quoteLiteral(column.name)}: ${quoteLiteral(column.type)}`)
    .join(', ');
  return `types={${entries}}`;
}

function parseSniffedColumns(value: unknown): CsvColumnType[] {
  if (!Array.isArray(value)) return [];
  const columns: CsvColumnType[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const name = record.name;
    const type = record.type;
    if (typeof name !== 'string' || typeof type !== 'string') continue;
    columns.push({ name, type: normalizeSniffedType(type) });
  }
  return columns;
}

/**
 * Resolves CSV/TSV column types once per source.
 *
 * A sampled `sniff_csv` is cheap but can pick a numeric type from early rows and
 * then fail on a later textual value. Scanning the whole file for detection
 * (`sample_size=-1`) is correct but must be repeated by every query that
 * references the reader, which makes interactive paging slow on large files.
 *
 * Instead this performs one bounded validation scan that projects every column
 * with the sampled types and records conversion failures as rejects. Only the
 * columns that actually failed are widened to VARCHAR. The result is reused for
 * all later queries, so steady-state reads carry no detection cost.
 */
export async function resolveCsvColumnTypes(
  connection: DuckDBConnection,
  filePath: string,
): Promise<CsvColumnType[]> {
  const sniff = await connection.query(`SELECT Columns FROM sniff_csv(${quoteLiteral(filePath)})`);
  const sampled = parseSniffedColumns(sniff.rows[0]?.[0]);
  if (sampled.length === 0) return [];

  // Columns already at the widest type cannot reject on conversion.
  if (sampled.every((column) => column.type === WIDEST_TYPE)) return sampled;

  const suffix = randomBytes(6).toString('hex');
  const rejectsScan = `qw_csv_rejects_scan_${suffix}`;
  const rejectsTable = `qw_csv_rejects_${suffix}`;
  // COUNT(column) forces each column to be produced; a bare COUNT(*) can skip
  // the projection entirely and silently miss conversion errors.
  const projection = sampled.map((column) => `COUNT(${quoteIdentifier(column.name)})`).join(' + ');

  let rejected: Set<string>;
  try {
    // DuckDB creates the rejects tables as temporary objects owned by the
    // connection that ran the scan, so the scan and the lookup must share a
    // single connection. `transaction` provides that guarantee.
    rejected = await connection.transaction(async (session) => {
      await session.query(
        `SELECT ${projection} FROM read_csv(${quoteLiteral(filePath)}, ${csvTypesOption(sampled)}, ` +
          `ignore_errors=true, store_rejects=true, ` +
          `rejects_scan=${quoteLiteral(rejectsScan)}, rejects_table=${quoteLiteral(rejectsTable)})`,
      );
      const rejects = await session.query(
        `SELECT DISTINCT column_name FROM ${quoteIdentifier(rejectsTable)} WHERE column_name IS NOT NULL`,
      );
      return new Set(
        rejects.rows
          .map((row) => row[0])
          .filter((name): name is string => typeof name === 'string'),
      );
    });
  } catch {
    // If the validation scan cannot run, prefer a readable source over a failed
    // open: the widest type always parses.
    return sampled.map((column) => ({ name: column.name, type: WIDEST_TYPE }));
  }

  if (rejected.size === 0) return sampled;
  return sampled.map((column) =>
    rejected.has(column.name) ? { name: column.name, type: WIDEST_TYPE } : column,
  );
}
