import { DuckDBInstance } from '@duckdb/node-api';
import { createHash } from 'node:crypto';
import { mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadFile, prepareDataFileReader } from '../../src/duckdb/parquet-loader';
import { WranglingSession } from '../../src/transforms/pipeline';

// The README promises that ordinary local work never touches the network and never changes the
// source file. These tests hold that promise: DuckDB is pointed at a local server that records every
// request it receives, and extension downloads are the only thing that could legitimately reach it.
let directory = '';
let server: Server;
let repository = '';
const requests: string[] = [];
const sources: Record<string, string> = {};

async function fingerprint(path: string): Promise<string> {
  // One open handle for both the size/mtime and the content, so the two cannot describe different
  // versions of the file.
  const handle = await open(path, 'r');
  try {
    const info = await handle.stat();
    const digest = createHash('sha256')
      .update(await handle.readFile())
      .digest('hex');
    return `${digest}:${info.size}:${info.mtimeMs}`;
  } finally {
    await handle.close();
  }
}

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'quackwrangler-offline-'));
  server = createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`);
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  repository = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const seed = await (await DuckDBInstance.create(':memory:')).connect();
  const make = async (name: string, sql: string): Promise<void> => {
    sources[name] = join(directory, name);
    await seed.run(sql.replace('__FILE__', sources[name]));
  };
  const rows = "SELECT range AS id, 'n' || range AS name, range * 1.5 AS value FROM range(500)";
  await make('data.parquet', `COPY (${rows}) TO '__FILE__' (FORMAT parquet)`);
  await make('data.csv', `COPY (${rows}) TO '__FILE__' (FORMAT csv, HEADER)`);
  await make('data.tsv', `COPY (${rows}) TO '__FILE__' (FORMAT csv, HEADER, DELIMITER '\t')`);
  await make('data.json', `COPY (${rows}) TO '__FILE__' (FORMAT json, ARRAY true)`);
  await make('data.ndjson', `COPY (${rows}) TO '__FILE__' (FORMAT json, ARRAY false)`);
  await writeFile(join(directory, 'unused.txt'), 'x');
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(directory, { recursive: true, force: true });
});

async function isolatedConnection(): Promise<{
  adapter: never;
  query: (sql: string) => Promise<{ columns: string[]; rows: unknown[][] }>;
}> {
  const conn = await (await DuckDBInstance.create(':memory:')).connect();
  const query = async (sql: string): Promise<{ columns: string[]; rows: unknown[][] }> => {
    const result = await conn.run(sql);
    return { columns: result.columnNames(), rows: await result.getRowsJson() };
  };
  // An empty private extension folder means nothing is ever found in a cache on this machine, so any
  // extension that would need downloading goes to the recording server instead.
  await query(`SET extension_directory='${await mkdtemp(join(directory, 'extensions-'))}'`);
  await query(`SET custom_extension_repository='${repository}'`);
  await query('SET autoinstall_known_extensions=true');
  await query('SET autoload_known_extensions=true');
  const adapter = {
    query,
    transaction: async <T>(callback: (tx: { query: typeof query }) => Promise<T>): Promise<T> => {
      await query('BEGIN TRANSACTION');
      try {
        const value = await callback({ query });
        await query('COMMIT');
        return value;
      } catch (error) {
        await query('ROLLBACK');
        throw error;
      }
    },
  };
  return { adapter: adapter as never, query };
}

describe('local work is private and read-only', () => {
  it.each(['data.parquet', 'data.csv', 'data.tsv', 'data.json', 'data.ndjson'])(
    'opens, profiles, transforms, queries, and exports %s without any network request or change to the file',
    async (name) => {
      const source = sources[name];
      const before = await fingerprint(source);
      requests.length = 0;
      const { adapter, query } = await isolatedConnection();

      await prepareDataFileReader(adapter, source);
      await loadFile(adapter, source, 'auto', 64, 'private_data');
      const session = new WranglingSession(adapter, 'private_data');
      session.load(source);
      await session.applyValidated('filter_rows', {
        column: 'id',
        operator: 'greater_than',
        value: '100',
      });
      await session.applyValidated('sort_rows', { keys: [{ column: 'id', direction: 'DESC' }] });
      const page = await session.getPage(0, 10);
      expect(page.schema.rowCount).toBe(399);
      expect((await session.getStatistics()).length).toBeGreaterThan(1);
      await session.getQualitySummary(await session.getStatistics(), session.getSql());
      await query(`SELECT COUNT(*) FROM (${session.getSql()}) AS custom_query`);
      const exported = join(directory, `export-${name}.parquet`);
      await query(`COPY (${session.getSql()}) TO '${exported}' (FORMAT parquet)`);

      expect(requests).toEqual([]);
      expect(await fingerprint(source)).toBe(before);
    },
    60_000,
  );

  it('does reach the recording server when an extension really must be downloaded, so the test can fail', async () => {
    requests.length = 0;
    const { query } = await isolatedConnection();
    await query('INSTALL sqlite').catch(() => undefined);
    // The download request names only the DuckDB version, platform, and extension.
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatch(
      /^GET \/v[\d.]+\/[a-z0-9_]+\/sqlite_scanner\.duckdb_extension\.gz$/,
    );
    expect(requests[0]).not.toContain(directory);
  });
});
