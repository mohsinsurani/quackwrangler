import { DuckDBInstance } from '@duckdb/node-api';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  detectDatabaseKind,
  loadDatabaseTable,
  releaseDatabase,
} from '../../src/duckdb/database-source';
import { prepareDataFileReader } from '../../src/duckdb/parquet-loader';
import { WranglingSession } from '../../src/transforms/pipeline';

// These tests build real DuckDB and SQLite files and open them through the same loader the editor
// uses. SQLite needs DuckDB's signed `sqlite` extension, which the first run downloads.
const skipSqlite = process.env.QW_SKIP_OPTIONAL_EXTENSION_TESTS === 'true';

// Node's built-in SQLite writes raw files, including columns that mix numbers and text.
const nodeSqlite = await import('node:sqlite').catch(() => undefined);

let directory: string;
let instance: DuckDBInstance;

type Query = (sql: string) => Promise<{ columns: string[]; rows: unknown[][] }>;

function adapter(): {
  query: Query;
  transaction: <T>(callback: (tx: { query: Query }) => Promise<T>) => Promise<T>;
} {
  const connectionPromise = instance.connect();
  const run: Query = async (sql) => {
    const connection = await connectionPromise;
    const result = await connection.run(sql);
    return { columns: result.columnNames(), rows: await result.getRowsJson() };
  };
  return {
    query: run,
    transaction: async (callback) => {
      await run('BEGIN TRANSACTION');
      try {
        const value = await callback({ query: run });
        await run('COMMIT');
        return value;
      } catch (error) {
        await run('ROLLBACK');
        throw error;
      }
    },
  };
}

async function exec(connection: Awaited<ReturnType<DuckDBInstance['connect']>>, sql: string) {
  await connection.run(sql);
}

async function createDuckDbFile(file: string): Promise<void> {
  const database = await DuckDBInstance.create(file);
  const connection = await database.connect();
  await exec(connection, 'CREATE TABLE orders(id INTEGER, region VARCHAR, total DOUBLE)');
  await exec(connection, "INSERT INTO orders VALUES (1,'east',10.5),(2,'west',20),(3,'east',30)");
  await exec(connection, 'CREATE TABLE customers(id INTEGER, name VARCHAR)');
  await exec(connection, "INSERT INTO customers VALUES (1,'Ada'),(2,'Bob')");
  await exec(connection, 'CREATE SCHEMA analytics');
  await exec(connection, 'CREATE TABLE analytics.daily(day DATE, hits INTEGER)');
  await exec(connection, "INSERT INTO analytics.daily VALUES ('2025-01-01', 5)");
  await exec(connection, "CREATE VIEW east_orders AS SELECT * FROM orders WHERE region = 'east'");
  await exec(connection, 'CHECKPOINT');
  connection.closeSync();
}

async function createSqliteFile(file: string): Promise<void> {
  const database = await DuckDBInstance.create(':memory:');
  const connection = await database.connect();
  await exec(connection, 'INSTALL sqlite');
  await exec(connection, 'LOAD sqlite');
  await exec(connection, `ATTACH '${file}' AS source (TYPE sqlite)`);
  await exec(connection, 'CREATE TABLE source.items(id INTEGER, label VARCHAR, price DOUBLE)');
  await exec(connection, "INSERT INTO source.items VALUES (1,'pen',1.5),(2,'ink',4.25)");
  await exec(connection, 'CREATE TABLE source.notes(id INTEGER, body VARCHAR)');
  await exec(connection, "INSERT INTO source.notes VALUES (1,'first')");
  await exec(connection, 'DETACH source');
  connection.closeSync();
}

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'quackwrangler-databases-'));
  instance = await DuckDBInstance.create(':memory:');
});

afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('database file detection', () => {
  it('tells DuckDB and SQLite apart from the file header, whatever the extension', async () => {
    const duck = join(directory, 'kind.db');
    await createDuckDbFile(duck);
    expect(await detectDatabaseKind(duck)).toBe('duckdb');

    const sqlite = join(directory, 'kind-sqlite.db');
    await writeFile(sqlite, Buffer.concat([Buffer.from('SQLite format 3\0'), Buffer.alloc(100)]));
    expect(await detectDatabaseKind(sqlite)).toBe('sqlite');
  });

  it('rejects an unrelated file with a .db extension', async () => {
    const other = join(directory, 'Thumbs.db');
    await writeFile(other, 'this is not a database');
    await expect(detectDatabaseKind(other)).rejects.toThrow(/not a DuckDB or SQLite database/);
  });
});

describe('opening a DuckDB file', () => {
  it('lists tables, schemas, and views and opens the first table read-only', async () => {
    const file = join(directory, 'shop.duckdb');
    await createDuckDbFile(file);
    const connection = adapter();
    const info = await loadDatabaseTable(
      connection as never,
      file,
      undefined,
      'eager',
      64,
      'qw_duck_first',
    );

    expect(info.kind).toBe('duckdb');
    expect(
      info.tables.map((table) => `${table.schema}.${table.name}${table.view ? '*' : ''}`),
    ).toEqual(['main.customers', 'main.orders', 'analytics.daily', 'main.east_orders*']);
    expect(info.selected.name).toBe('customers');
    const rows = await connection.query('SELECT * FROM qw_duck_first ORDER BY id');
    expect(rows.rows).toEqual([
      [1, 'Ada'],
      [2, 'Bob'],
    ]);
  });

  it('opens a chosen table in another schema and runs the normal pipeline on it', async () => {
    const file = join(directory, 'pipeline.duckdb');
    await createDuckDbFile(file);
    const connection = adapter();
    await loadDatabaseTable(
      connection as never,
      file,
      { schema: 'main', name: 'orders' },
      'eager',
      64,
      'qw_duck_pipeline',
    );
    const session = new WranglingSession(connection as never, 'qw_duck_pipeline');
    session.load(file);
    session.apply('filter_rows', { column: 'region', operator: 'equals', value: 'east' });
    const page = await session.getPage(0, 10);
    expect(page.result.rows.map((row) => String(row[0]))).toEqual(['1', '3']);
    expect(page.schema.rowCount).toBe(2);
  });

  it('opens a view as a table and reads rows lazily', async () => {
    const file = join(directory, 'lazy.duckdb');
    await createDuckDbFile(file);
    const connection = adapter();
    const info = await loadDatabaseTable(
      connection as never,
      file,
      { schema: 'main', name: 'east_orders' },
      'lazy',
      64,
      'qw_duck_lazy',
    );
    expect(info.selected.view).toBe(true);
    const count = await connection.query('SELECT COUNT(*) FROM qw_duck_lazy');
    expect(Number(count.rows[0][0])).toBe(2);
  });

  it('switches tables on the same connection and keeps the old one when the switch fails', async () => {
    const file = join(directory, 'switch.duckdb');
    await createDuckDbFile(file);
    const connection = adapter();
    await loadDatabaseTable(
      connection as never,
      file,
      { schema: 'main', name: 'orders' },
      'lazy',
      64,
      'qw_switch',
    );
    await loadDatabaseTable(
      connection as never,
      file,
      { schema: 'main', name: 'customers' },
      'lazy',
      64,
      'qw_switch',
    );
    expect((await connection.query('SELECT COUNT(*) FROM qw_switch')).rows[0][0]).toBe('2');

    await expect(
      loadDatabaseTable(
        connection as never,
        file,
        { schema: 'main', name: 'missing' },
        'lazy',
        64,
        'qw_switch',
      ),
    ).rejects.toThrow(/no longer in switch\.duckdb/);
    expect((await connection.query('SELECT COUNT(*) FROM qw_switch')).rows[0][0]).toBe('2');
    await releaseDatabase(connection as never);
  });

  it('releases the file after an eager load so another program can write to it', async () => {
    const file = join(directory, 'release.duckdb');
    await createDuckDbFile(file);
    const connection = adapter();
    await loadDatabaseTable(connection as never, file, undefined, 'eager', 64, 'qw_release');

    const writer = await DuckDBInstance.create(file);
    const writerConnection = await writer.connect();
    await exec(writerConnection, "INSERT INTO customers VALUES (3, 'Cy')");
    writerConnection.closeSync();
    // The eager copy is unchanged; refreshing reloads the new row.
    expect((await connection.query('SELECT COUNT(*) FROM qw_release')).rows[0][0]).toBe('2');
    await loadDatabaseTable(connection as never, file, undefined, 'eager', 64, 'qw_release');
    expect((await connection.query('SELECT COUNT(*) FROM qw_release')).rows[0][0]).toBe('3');
  });

  it('reports an empty database', async () => {
    const file = join(directory, 'empty.duckdb');
    const empty = await DuckDBInstance.create(file);
    const connection = await empty.connect();
    await exec(connection, 'CHECKPOINT');
    connection.closeSync();
    await expect(
      loadDatabaseTable(adapter() as never, file, undefined, 'eager', 64, 'qw_empty'),
    ).rejects.toThrow(/contains no tables or views/);
  });

  it('refuses remote database paths', async () => {
    await expect(
      loadDatabaseTable(
        adapter() as never,
        'https://example.com/a.duckdb',
        undefined,
        'eager',
        64,
        'qw_remote',
      ),
    ).rejects.toThrow(/must be on this computer/);
  });

  it('does not prepare a reader for a database file path', async () => {
    const file = join(directory, 'prep.duckdb');
    await createDuckDbFile(file);
    await expect(prepareDataFileReader(adapter() as never, file)).resolves.toBeUndefined();
  });
});

describe.skipIf(skipSqlite)('opening a SQLite file', () => {
  it('lists tables and opens one with its SQLite types mapped', async () => {
    const file = join(directory, 'store.sqlite');
    await createSqliteFile(file);
    const connection = adapter();
    const info = await loadDatabaseTable(
      connection as never,
      file,
      { schema: 'main', name: 'items' },
      'eager',
      64,
      'qw_sqlite',
    );
    expect(info.kind).toBe('sqlite');
    expect(info.textColumns).toBe(false);
    expect(info.tables.map((table) => table.name)).toEqual(['items', 'notes']);
    const described = await connection.query('DESCRIBE SELECT * FROM qw_sqlite');
    expect(described.rows.map((row) => [row[0], row[1]])).toEqual([
      ['id', 'BIGINT'],
      ['label', 'VARCHAR'],
      ['price', 'DOUBLE'],
    ]);
  });

  it.skipIf(!nodeSqlite)(
    'falls back to text columns when a SQLite column mixes numbers and text',
    async () => {
      // SQLite accepts any value in any column, so write rows DuckDB cannot type.
      const file = join(directory, 'mixed.sqlite');
      const raw = new nodeSqlite!.DatabaseSync(file);
      raw.exec('CREATE TABLE ledger(id INTEGER, amount INTEGER)');
      raw.exec("INSERT INTO ledger VALUES (1, 10), (2, 'n/a'), (3, 30.5)");
      raw.close();

      for (const mode of ['eager', 'lazy'] as const) {
        const connection = adapter();
        const info = await loadDatabaseTable(
          connection as never,
          file,
          { schema: 'main', name: 'ledger' },
          mode,
          64,
          `qw_mixed_${mode}`,
        );
        expect(info.textColumns).toBe(true);
        const rows = await connection.query(`SELECT * FROM qw_mixed_${mode} ORDER BY id`);
        expect(rows.rows.map((row) => String(row[1]))).toEqual(['10', 'n/a', '30.5']);
        await releaseDatabase(connection as never);
      }
    },
  );

  it('returns to typed columns when the next table opened has clean types', async () => {
    const file = join(directory, 'typed-again.sqlite');
    await createSqliteFile(file);
    const connection = adapter();
    const info = await loadDatabaseTable(
      connection as never,
      file,
      { schema: 'main', name: 'notes' },
      'eager',
      64,
      'qw_typed_again',
    );
    expect(info.textColumns).toBe(false);
    const described = await connection.query('DESCRIBE SELECT * FROM qw_typed_again');
    expect(described.rows[0][1]).toBe('BIGINT');
  });
});
