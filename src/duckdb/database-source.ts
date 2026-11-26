import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import * as path from 'path';

import type { DatabaseInfo, DatabaseTable } from '../types/index.js';

import type { DuckDBConnection } from './connection.js';
import {
  ensureDuckDBExtension,
  LoadingMode,
  promoteRelation,
  registerSecondaryDatabase,
  resolveLoadingMode,
  secondaryDatabaseAlias,
} from './parquet-loader.js';
import { quoteIdentifier, quoteLiteral } from './sql.js';

const SQLITE_MAGIC = 'SQLite format 3\0';
const SQLITE_TEXT_HINT = /sqlite_all_varchar/;

// One attachment per panel connection. A new alias is attached for every load and the previous
// one is detached only after the new relation is ready, so a failed switch keeps the old view.
const attachedAlias = new WeakMap<DuckDBConnection, string>();
let aliasCounter = 0;

/**
 * Identifies a database by its header rather than its extension, because `.db` is used by both
 * DuckDB and SQLite (and by unrelated programs).
 */
export async function detectDatabaseKind(filePath: string): Promise<DatabaseInfo['kind']> {
  const handle = await open(filePath, 'r');
  try {
    const header = Buffer.alloc(16);
    const { bytesRead } = await handle.read(header, 0, 16, 0);
    if (bytesRead === 16 && header.toString('latin1') === SQLITE_MAGIC) return 'sqlite';
    if (bytesRead >= 12 && header.toString('latin1', 8, 12) === 'DUCK') return 'duckdb';
  } finally {
    await handle.close();
  }
  throw new Error(`${path.basename(filePath)} is not a DuckDB or SQLite database file.`);
}

export function describeTable(table: DatabaseTable): string {
  const name = table.schema === 'main' ? table.name : `${table.schema}.${table.name}`;
  return table.view ? `${name} (view)` : name;
}

function tableRef(alias: string, table: DatabaseTable): string {
  return `${quoteIdentifier(alias)}.${quoteIdentifier(table.schema)}.${quoteIdentifier(table.name)}`;
}

async function listTables(
  connection: DuckDBConnection,
  alias: string,
  kind: DatabaseInfo['kind'],
): Promise<DatabaseTable[]> {
  const result = await connection.query(
    `SELECT table_schema, table_name, table_type FROM information_schema.tables
     WHERE table_catalog = ${quoteLiteral(alias)}
       AND table_schema NOT IN ('information_schema', 'pg_catalog')
     ORDER BY table_type = 'VIEW', table_schema <> 'main', table_schema, table_name`,
  );
  return result.rows
    .map((row) => ({
      schema: String(row[0]),
      name: String(row[1]),
      view: String(row[2]).toUpperCase() === 'VIEW',
    }))
    .filter((table) => !(kind === 'sqlite' && table.name.startsWith('sqlite_')));
}

/** Detaches whatever database this connection currently has open, releasing its file lock. */
export async function releaseDatabase(connection: DuckDBConnection): Promise<void> {
  const alias = attachedAlias.get(connection);
  if (!alias) return;
  attachedAlias.delete(connection);
  await connection.query(`DETACH ${quoteIdentifier(alias)}`).catch(() => undefined);
}

/**
 * Opens a DuckDB or SQLite file read-only and exposes one of its tables as the panel relation.
 * Without `requested`, the first table is opened. Small tables are copied into memory and the
 * file is released straight away so other programs can write to it again.
 */
export async function loadDatabaseTable(
  connection: DuckDBConnection,
  filePath: string,
  requested: Pick<DatabaseTable, 'schema' | 'name'> | undefined,
  mode: LoadingMode,
  eagerFileSizeLimitMb: number,
  relationName: string,
): Promise<DatabaseInfo> {
  if (/^(https?|s3):\/\//i.test(filePath))
    throw new Error('Database files must be on this computer. Download the file to open it.');
  const kind = await detectDatabaseKind(filePath);
  if (kind === 'sqlite') {
    await ensureDuckDBExtension(connection, 'sqlite', 'SQLite databases');
    // Earlier tables may have switched this to text; start each load from typed columns.
    await connection.query('SET GLOBAL sqlite_all_varchar = false');
  }

  const previousAlias = attachedAlias.get(connection);
  const alias = `qw_db_${++aliasCounter}`;
  try {
    await connection.query(
      `ATTACH ${quoteLiteral(filePath)} AS ${quoteIdentifier(alias)} (${kind === 'sqlite' ? 'TYPE sqlite, ' : ''}READ_ONLY)`,
    );
  } catch (error) {
    throw new Error(`Could not open ${path.basename(filePath)}: ${error}`);
  }

  try {
    const tables = await listTables(connection, alias, kind);
    if (tables.length === 0)
      throw new Error(`${path.basename(filePath)} contains no tables or views.`);
    const selected = requested
      ? tables.find((table) => table.schema === requested.schema && table.name === requested.name)
      : tables[0];
    if (!selected)
      throw new Error(
        `Table "${requested?.name}" is no longer in ${path.basename(filePath)}. Available: ${tables.map(describeTable).join(', ')}.`,
      );

    const ref = tableRef(alias, selected);
    const resolvedMode = await resolveLoadingMode(filePath, mode, eagerFileSizeLimitMb);
    const promote = (): Promise<void> =>
      promoteRelation(
        connection,
        ref,
        resolvedMode,
        relationName,
        `table ${describeTable(selected)}`,
      );

    let textColumns = false;
    try {
      await promote();
      // A lazy view only reads rows when asked, so scan once now to surface mixed-type columns.
      if (kind === 'sqlite' && resolvedMode === 'lazy')
        await connection.query(`SELECT max(hash(t)) FROM ${ref} AS t`);
    } catch (error) {
      if (kind !== 'sqlite' || !SQLITE_TEXT_HINT.test(String(error))) throw error;
      // SQLite lets one column hold text and numbers; DuckDB cannot type that, so read it as text.
      await connection.query('SET GLOBAL sqlite_all_varchar = true');
      textColumns = true;
      await promote();
    }

    if (previousAlias) await connection.query(`DETACH ${quoteIdentifier(previousAlias)}`);
    if (resolvedMode === 'eager') {
      // The table is already in memory, so drop the file lock.
      await connection.query(`DETACH ${quoteIdentifier(alias)}`);
      attachedAlias.delete(connection);
    } else {
      attachedAlias.set(connection, alias);
    }
    return { kind, tables, selected, textColumns };
  } catch (error) {
    await connection.query(`DETACH ${quoteIdentifier(alias)}`).catch(() => undefined);
    throw error;
  }
}

/** The alias of a secondary database never changes for a path, so saved steps can be rebuilt. */
function secondaryAliasFor(filePath: string): string {
  return `qw_sec_${createHash('sha1').update(path.resolve(filePath)).digest('hex').slice(0, 12)}`;
}

/**
 * Attaches a database file read-only as the second source of a join or union and lists its tables.
 * It is safe to call again for the same file. The attachment stays until the editor closes, which
 * keeps a DuckDB file locked against writers for that time, like a lazily loaded table.
 */
export async function attachSecondaryDatabase(
  connection: DuckDBConnection,
  filePath: string,
): Promise<{ kind: DatabaseInfo['kind']; tables: DatabaseTable[] }> {
  if (/^(https?|s3):\/\//i.test(filePath))
    throw new Error('Database files must be on this computer. Download the file to open it.');
  const kind = await detectDatabaseKind(filePath);
  if (kind === 'sqlite') await ensureDuckDBExtension(connection, 'sqlite', 'SQLite databases');
  const alias = secondaryAliasFor(filePath);
  if (secondaryDatabaseAlias(connection, filePath) !== alias) {
    try {
      await connection.query(
        `ATTACH IF NOT EXISTS ${quoteLiteral(filePath)} AS ${quoteIdentifier(alias)} (${kind === 'sqlite' ? 'TYPE sqlite, ' : ''}READ_ONLY)`,
      );
    } catch (error) {
      throw new Error(`Could not open ${path.basename(filePath)}: ${error}`);
    }
    registerSecondaryDatabase(connection, filePath, alias);
  }
  const tables = await listTables(connection, alias, kind);
  if (tables.length === 0)
    throw new Error(`${path.basename(filePath)} contains no tables or views.`);
  return { kind, tables };
}

/** Column names and types of one table of an attached secondary database. */
export async function describeSecondaryTable(
  connection: DuckDBConnection,
  filePath: string,
  table: Pick<DatabaseTable, 'schema' | 'name'>,
): Promise<Array<{ name: string; type: string }>> {
  const alias = secondaryDatabaseAlias(connection, filePath);
  if (!alias) throw new Error('The database file has not been opened yet.');
  const result = await connection.query(
    `DESCRIBE SELECT * FROM ${tableRef(alias, { ...table, view: false })}`,
  );
  return result.rows.map((row) => ({ name: String(row[0]), type: String(row[1]) }));
}
