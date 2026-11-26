import { DuckDBInstance } from '@duckdb/node-api';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { describeRemoteError } from '../../src/duckdb/remote-errors';
import { loadFile, prepareDataFileReader, getFileMetadata } from '../../src/duckdb/parquet-loader';
import { WranglingSession } from '../../src/transforms/pipeline';

// These tests run QuackWrangler's real loader against a real HTTP server on this machine, with
// DuckDB's httpfs extension, so remote loading is covered on every CI run without the internet.
// The first run downloads the signed httpfs extension.

const CSV = 'id,name,score\n1,Ada,91.5\n2,Bob,78\n3,Cy,\n';
const JSON_DOC = JSON.stringify([
  { id: 1, tag: 'x' },
  { id: 2, tag: 'y' },
]);
const HTML = '<html><body>Please sign in</body></html>';

let server: Server;
let base = '';
let directory = '';
let parquet: Buffer;
const requests: Array<{ method: string; url: string; range?: string }> = [];

function send(
  res: ServerResponse,
  req: IncomingMessage,
  type: string,
  body: Buffer | string,
  extra: Record<string, string> = {},
): void {
  const data = typeof body === 'string' ? Buffer.from(body) : body;
  const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '');
  if (range) {
    const start = Number(range[1]);
    const end = range[2] ? Number(range[2]) : data.length - 1;
    const slice = data.subarray(start, end + 1);
    res.writeHead(206, {
      'content-type': type,
      'content-length': slice.length,
      'content-range': `bytes ${start}-${start + slice.length - 1}/${data.length}`,
      'accept-ranges': 'bytes',
      ...extra,
    });
    res.end(req.method === 'HEAD' ? undefined : slice);
    return;
  }
  res.writeHead(200, {
    'content-type': type,
    'content-length': data.length,
    'accept-ranges': 'bytes',
    ...extra,
  });
  res.end(req.method === 'HEAD' ? undefined : data);
}

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'quackwrangler-remote-'));
  // A real Parquet file, written by DuckDB, so range requests read genuine row groups.
  const writer = await DuckDBInstance.create(':memory:');
  const connection = await writer.connect();
  const file = join(directory, 'orders.parquet');
  await connection.run(
    `COPY (SELECT range AS id, 'region-' || (range % 4) AS region, range * 1.5 AS total FROM range(1000)) TO '${file}' (FORMAT parquet)`,
  );
  connection.closeSync();
  writer.closeSync();
  parquet = await readFile(file);

  server = createServer((req, res) => {
    const url = req.url ?? '';
    requests.push({ method: req.method ?? '', url, range: req.headers.range });
    const path = url.split('?')[0];
    switch (path) {
      case '/people.csv':
        return send(res, req, 'text/csv', CSV);
      case '/orders.parquet':
        return send(res, req, 'application/octet-stream', parquet);
      case '/events.json':
        return send(res, req, 'application/json', JSON_DOC);
      case '/redirect.csv':
        res.writeHead(302, { location: '/people.csv' });
        return void res.end();
      case '/forbidden.csv':
        res.writeHead(403);
        return void res.end('denied');
      case '/private.csv':
        res.writeHead(401, { 'www-authenticate': 'Basic realm="data"' });
        return void res.end();
      case '/broken.csv':
        res.writeHead(500);
        return void res.end('boom');
      case '/login.csv':
        return send(res, req, 'text/html', HTML);
      case '/login.parquet':
        return send(res, req, 'text/html', HTML);
      case '/hang.csv':
        return; // never answers, so the request times out
      default:
        res.writeHead(404);
        return void res.end('missing');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(directory, { recursive: true, force: true });
});

async function adapter(): Promise<{
  connection: never;
  query: (sql: string) => Promise<{ columns: string[]; rows: unknown[][] }>;
}> {
  const database = await DuckDBInstance.create(':memory:');
  const conn = await database.connect();
  const run = async (sql: string): Promise<{ columns: string[]; rows: unknown[][] }> => {
    const result = await conn.run(sql);
    return { columns: result.columnNames(), rows: await result.getRowsJson() };
  };
  const wrapper = {
    query: run,
    transaction: async <T>(callback: (tx: { query: typeof run }) => Promise<T>): Promise<T> => {
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
  return { connection: wrapper as never, query: run };
}

async function open(
  source: string,
  mode: 'eager' | 'lazy' = 'auto' as never,
): Promise<{
  session: WranglingSession;
  query: (sql: string) => Promise<{ columns: string[]; rows: unknown[][] }>;
  connection: never;
}> {
  const { connection, query } = await adapter();
  await prepareDataFileReader(connection, source);
  await loadFile(connection, source, mode, 64, 'remote_data');
  const session = new WranglingSession(connection, 'remote_data');
  session.load(source);
  return { session, query, connection };
}

describe('remote HTTP sources', () => {
  it('loads a CSV with detected types and shows the first page', async () => {
    const { session } = await open(`${base}/people.csv`);
    const page = await session.getPage(0, 10);
    expect(page.schema.columns.map((column) => [column.name, column.type])).toEqual([
      ['id', 'BIGINT'],
      ['name', 'VARCHAR'],
      ['score', 'DOUBLE'],
    ]);
    // DuckDB returns 64-bit integers as strings in JSON rows.
    expect(page.result.rows).toEqual([
      ['1', 'Ada', 91.5],
      ['2', 'Bob', 78],
      ['3', 'Cy', null],
    ]);
  });

  it('loads remote files lazily so large files are not copied up front', async () => {
    const { connection } = await adapter();
    await prepareDataFileReader(connection, `${base}/people.csv`);
    const mode = await loadFile(connection, `${base}/people.csv`, 'auto', 64, 'lazy_check');
    expect(mode).toBe('lazy');
  });

  it('reads Parquet with HTTP range requests instead of downloading the whole file', async () => {
    requests.length = 0;
    const { session } = await open(`${base}/orders.parquet`);
    const page = await session.getPage(0, 5);
    expect(page.schema.rowCount).toBe(1000);
    expect(page.result.rows).toHaveLength(5);
    const ranged = requests.filter((request) => request.range);
    expect(ranged.length).toBeGreaterThan(0);
  });

  it('applies transforms and profiles to remote data', async () => {
    const { session } = await open(`${base}/orders.parquet`);
    session.apply('filter_rows', { column: 'region', operator: 'equals', value: 'region-1' });
    const page = await session.getPage(0, 5);
    expect(page.schema.rowCount).toBe(250);
    const stats = await session.getStatistics();
    expect(stats.find((column) => column.name === 'id')).toMatchObject({ nullCount: 0 });
  });

  it('loads JSON documents', async () => {
    const { session } = await open(`${base}/events.json`);
    const page = await session.getPage(0, 10);
    expect(page.schema.rowCount).toBe(2);
    expect(page.schema.columns.map((column) => column.name)).toEqual(['id', 'tag']);
  });

  it('follows redirects', async () => {
    const { session } = await open(`${base}/redirect.csv`);
    expect((await session.getPage(0, 10)).schema.rowCount).toBe(3);
  });

  it('keeps a query string in the URL and still detects the format', async () => {
    const { session } = await open(`${base}/people.csv?token=abc`);
    expect((await session.getPage(0, 10)).schema.rowCount).toBe(3);
    expect(requests.some((request) => request.url.includes('token=abc'))).toBe(true);
  });

  it('describes the schema of a remote file without loading it', async () => {
    const { connection } = await adapter();
    const metadata = await getFileMetadata(connection, `${base}/people.csv`);
    expect(metadata.rowCount).toBe(3);
    expect(metadata.columns.map((column) => column.name)).toEqual(['id', 'name', 'score']);
  });

  it('can export a remote result to a local Parquet file', async () => {
    const { session, query } = await open(`${base}/people.csv`);
    const target = join(directory, 'exported.parquet');
    await query(`COPY (${session.getSql()}) TO '${target}' (FORMAT parquet)`);
    const rows = await query(`SELECT COUNT(*) FROM read_parquet('${target}')`);
    expect(Number(rows.rows[0][0])).toBe(3);
  });
});

describe('remote failures', () => {
  async function failure(path: string): Promise<string> {
    try {
      await open(`${base}${path}`);
    } catch (error) {
      return describeRemoteError(error, `${base}${path}`);
    }
    throw new Error(`${path} unexpectedly loaded`);
  }

  it('explains a missing file', async () => {
    const message = await failure('/missing.csv');
    expect(message).toMatch(/not found \(404\)/i);
    expect(message).toMatch(/check the address/i);
  });

  it('explains a forbidden file', async () => {
    expect(await failure('/forbidden.csv')).toMatch(/access (was )?denied \(403\)/i);
  });

  it('explains a file that needs a sign-in', async () => {
    expect(await failure('/private.csv')).toMatch(
      /sign[- ]in|authenticat|unauthori[sz]ed \(401\)/i,
    );
  });

  it('explains a server error', async () => {
    expect(await failure('/broken.csv')).toMatch(/server (returned an error|error)/i);
  });

  it('explains a Parquet URL that returns a web page', async () => {
    const message = await failure('/login.parquet');
    expect(message).toMatch(/not a valid parquet file|web page|sign-in page/i);
  });

  it('never leaks the full URL or query string into the explanation', async () => {
    const source = `${base}/missing.csv?token=secret-value`;
    let raw = '';
    try {
      await open(source);
    } catch (error) {
      raw = error instanceof Error ? error.message : String(error);
    }
    // DuckDB's own text does contain the token, so this proves the translation removes it.
    expect(raw).toContain('secret-value');
    expect(describeRemoteError(new Error(raw), source)).not.toContain('secret-value');
  });
});

describe('remote failure wording', () => {
  const url = 'https://example.com/data.parquet?X-Amz-Signature=hidden';

  it.each([
    ["HTTP HEAD error on 'x' (HTTP 404 Not Found)", /not found \(404\)/i],
    ["HTTP GET error on 'x' (HTTP 403 Forbidden)", /access (was )?denied \(403\)/i],
    ["HTTP GET error on 'x' (HTTP 401 Unauthorized)", /sign[- ]in|unauthori[sz]ed/i],
    ["Request returned HTTP 500 for HTTP HEAD to 'x'", /server/i],
    ["Request returned HTTP 503 for HTTP GET to 'x'", /server/i],
    ["IO Error: Timeout was reached error for HTTP HEAD to 'x'", /timed out/i],
    ["IO Error: Could not resolve hostname error for HTTP GET to 'x'", /could not reach|resolve/i],
    ["Invalid Input Error: No magic bytes found at end of file 'x'", /not a valid parquet/i],
    ["Malformed JSON in file 'x', at byte 1", /not valid json/i],
  ])('translates %s', (raw, expected) => {
    const message = describeRemoteError(new Error(`Failed to load file x: Error: ${raw}`), url);
    expect(message).toMatch(expected);
    expect(message).not.toContain('hidden');
  });

  it('suggests credentials for a private S3 object', () => {
    const message = describeRemoteError(
      new Error(
        "HTTP Error: HTTP GET error reading 's3://bucket/key.parquet' (HTTP 403 Forbidden)",
      ),
      's3://bucket/key.parquet',
    );
    expect(message).toMatch(/aws credentials|credential/i);
  });

  it('passes unrelated errors through unchanged', () => {
    const error = new Error('Catalog Error: Table does not exist');
    expect(describeRemoteError(error, 'https://example.com/a.csv')).toBe(error.message);
  });

  it('leaves local file errors alone', () => {
    const error = new Error('IO Error: No such file');
    expect(describeRemoteError(error, '/tmp/a.csv')).toBe(error.message);
  });
});
