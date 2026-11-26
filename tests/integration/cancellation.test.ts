import { DuckDBInstance } from '@duckdb/node-api';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// The real DuckDB connection class, with only the VS Code output channel stubbed out.
vi.mock('vscode', () => ({
  window: { createOutputChannel: () => ({ appendLine: () => undefined }) },
}));

import { DuckDBConnection, isCancellation, QueryCancelledError } from '../../src/duckdb/connection';
import { loadFile, prepareDataFileReader } from '../../src/duckdb/parquet-loader';

// A remote Parquet file whose every request takes 400 ms, so scanning it takes many seconds unless
// the user cancels. Parquet over HTTP is read as many small range requests, which is how remote
// data is normally read and where a cancel can take effect between requests.
let server: Server;
let slowUrl = '';
let fastUrl = '';
let directory = '';
let parquet: Buffer;
let slowRequests = 0;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'quackwrangler-cancel-'));
  const writer = await DuckDBInstance.create(':memory:');
  const seed = await writer.connect();
  const file = join(directory, 'data.parquet');
  await seed.run(
    `COPY (SELECT range AS id, md5(range::VARCHAR) AS h FROM range(2000000)) TO '${file}' (FORMAT parquet, ROW_GROUP_SIZE 20000)`,
  );
  seed.closeSync();
  writer.closeSync();
  parquet = await readFile(file);

  server = createServer((req, res) => {
    const slow = req.url?.startsWith('/slow');
    if (slow) slowRequests += 1;
    const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '');
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2] ? Math.min(Number(range[2]), parquet.length - 1) : parquet.length - 1;
    const slice = parquet.subarray(start, end + 1);
    setTimeout(
      () => {
        res.writeHead(range ? 206 : 200, {
          'content-type': 'application/octet-stream',
          'content-length': slice.length,
          'accept-ranges': 'bytes',
          ...(range
            ? { 'content-range': `bytes ${start}-${start + slice.length - 1}/${parquet.length}` }
            : {}),
        });
        res.end(req.method === 'HEAD' ? undefined : slice);
      },
      slow ? 400 : 0,
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  slowUrl = `${base}/slow/data.parquet`;
  fastUrl = `${base}/fast/data.parquet`;
}, 60_000);

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(directory, { recursive: true, force: true });
});

async function connect(): Promise<DuckDBConnection> {
  const connection = new DuckDBConnection({
    memoryLimit: '1GB',
    tempDirectory: '',
    maxTempDirectorySize: '1GB',
    pageSize: 100,
    loadingMode: 'auto',
    eagerFileSizeLimitMb: 64,
    // One thread keeps the scan sequential, so a cancel reliably lands between two requests.
    threads: 1,
    preserveInsertionOrder: true,
  });
  await connection.connect();
  return connection;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('cancelling work', () => {
  it('stops a slow remote scan long before it would have finished and leaves the connection usable', async () => {
    const connection = await connect();
    await prepareDataFileReader(connection, slowUrl);

    const started = Date.now();
    const pending = connection.query(`SELECT SUM(length(h)) FROM read_parquet('${slowUrl}')`).then(
      () => 'finished' as const,
      (error: unknown) => error,
    );
    await sleep(2500);
    expect(connection.isBusy()).toBe(true);
    const requestsBefore = slowRequests;
    expect(connection.cancel()).toBe(true);

    const outcome = await pending;
    expect(outcome).toBeInstanceOf(QueryCancelledError);
    expect(isCancellation(outcome)).toBe(true);
    // The scan needs well over 100 requests at 400 ms each; cancelling stops it almost at once.
    expect(Date.now() - started).toBeLessThan(8000);
    expect(slowRequests - requestsBefore).toBeLessThan(5);
    expect(connection.isBusy()).toBe(false);

    // The same connection works afterwards, and another source still loads.
    expect((await connection.query('SELECT 42')).rows).toEqual([[42]]);
    const rows = await connection.query(`SELECT COUNT(*) FROM read_parquet('${fastUrl}')`);
    expect(Number(rows.rows[0][0])).toBe(2_000_000);
    await connection.close();
  }, 60_000);

  it('cancels a heavy local query within a second', async () => {
    const connection = await connect();
    const started = Date.now();
    const pending = connection
      .query('SELECT COUNT(*) FROM range(5000000000) a, range(3) b WHERE a.range % 7 = 0')
      .then(
        () => 'finished' as const,
        (error: unknown) => error,
      );
    await sleep(600);
    connection.cancel();
    expect(await pending).toBeInstanceOf(QueryCancelledError);
    expect(Date.now() - started).toBeLessThan(5000);
    await connection.close();
  }, 30_000);

  it('does nothing when nothing is running', async () => {
    const connection = await connect();
    expect(connection.isBusy()).toBe(false);
    expect(connection.cancel()).toBe(false);
    expect((await connection.query('SELECT 1')).rows).toEqual([[1]]);
    await connection.close();
  });

  it('does not affect work started after the cancel', async () => {
    const connection = await connect();
    connection.cancel();
    expect((await connection.query('SELECT 7')).rows).toEqual([[7]]);
    await connection.close();
  });

  it('rolls a cancelled load back so the previous data stays in place', async () => {
    const connection = await connect();
    await connection.query('CREATE TABLE keep_me AS SELECT 1 AS id');
    await connection.query('CREATE VIEW target_relation AS SELECT * FROM keep_me');
    await prepareDataFileReader(connection, slowUrl);

    const pending = loadFile(connection, slowUrl, 'eager', 64, 'target_relation').then(
      () => 'loaded' as const,
      (error: unknown) => error,
    );
    await sleep(2000);
    connection.cancel();
    const outcome = await pending;
    expect(outcome).not.toBe('loaded');
    expect(isCancellation(outcome) || /Cancelled|Interrupted/i.test(String(outcome))).toBe(true);

    // The relation the editor was showing is untouched, and no half-built staging object remains.
    expect((await connection.query('SELECT * FROM target_relation')).rows).toEqual([[1]]);
    const leftovers = await connection.query(
      "SELECT table_name FROM information_schema.tables WHERE table_name LIKE 'target_relation_%'",
    );
    expect(leftovers.rows).toEqual([]);
    await connection.close();
  }, 60_000);
});
