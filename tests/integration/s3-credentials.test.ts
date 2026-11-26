import { DuckDBInstance } from '@duckdb/node-api';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadFile, prepareDataFileReader } from '../../src/duckdb/parquet-loader';
import { WranglingSession } from '../../src/transforms/pipeline';

// A tiny S3-compatible server on this machine. Buckets behave like real ones:
//   open     - public: serves anyone, and (like AWS) refuses a request signed with an unknown key
//   private  - serves only requests signed with the key below
// Each request records which access key signed it, so these tests prove what DuckDB really sent.
const GOOD_KEY = 'AKIAQUACKGOODKEY0001';
const GOOD_SECRET = 'goodSecretKey/abcdefghijklmnopqrstuvwxyz0123456';
const BAD_KEY = 'AKIAQUACKBADKEY00002';
const CSV = 'id,name\n1,Ada\n2,Bob\n3,Cy\n';

let server: Server;
let endpoint = '';
let directory = '';
let configFiles: { credentials: string; config: string; missing: string };

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'quackwrangler-s3-'));
  const credentials = join(directory, 'credentials');
  const config = join(directory, 'config');
  await writeFile(
    credentials,
    `[default]\naws_access_key_id = ${BAD_KEY}\naws_secret_access_key = badbadbadbadbadbadbadbadbadbadbadbadbad00\n\n[work]\naws_access_key_id = ${GOOD_KEY}\naws_secret_access_key = ${GOOD_SECRET}\n`,
  );
  await writeFile(config, '[default]\nregion = us-east-1\n\n[profile work]\nregion = us-east-1\n');
  configFiles = { credentials, config, missing: join(directory, 'does-not-exist') };

  server = createServer((req, res) => {
    // An AWS Signature V4 header looks like `... Credential=<key>/<date>/<region>/s3/aws4_request, ...`.
    const authorization = req.headers.authorization ?? '';
    const start = authorization.indexOf('Credential=');
    const signer = start < 0 ? 'anonymous' : authorization.slice(start + 11).split('/', 1)[0];
    const bucket = (req.url ?? '').split('/')[1];
    const allowed =
      (bucket === 'open' && (signer === 'anonymous' || signer === GOOD_KEY)) ||
      (bucket === 'private' && signer === GOOD_KEY);
    if (!allowed) {
      res.writeHead(403, { 'content-type': 'application/xml' });
      return void res.end(
        '<Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>',
      );
    }
    res.writeHead(200, {
      'content-type': 'text/csv',
      'content-length': Buffer.byteLength(CSV),
      'accept-ranges': 'bytes',
    });
    res.end(req.method === 'HEAD' ? undefined : CSV);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  endpoint = `127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(directory, { recursive: true, force: true });
});

// DuckDB reads AWS settings from the process environment, so each scenario runs in its own
// process with exactly the variables a user's VS Code would have. The process is started
// asynchronously: this test process also hosts the fake S3 server, and a blocking call would stop
// that server from answering the very process it is waiting for.
function runScenario(
  environment: Record<string, string>,
  buckets: string[],
): Promise<Array<{ bucket: string; ok: boolean; error?: string }>> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', join(import.meta.dirname, 'fixtures/s3-scenario.cjs')],
      {
        cwd: join(import.meta.dirname, '../..'),
        env: {
          PATH: process.env.PATH ?? '',
          HOME: process.env.HOME ?? process.env.USERPROFILE ?? '',
          USERPROFILE: process.env.USERPROFILE ?? '',
          SystemRoot: process.env.SystemRoot ?? '',
          LOADER: pathToFileURL(join(import.meta.dirname, '../../src/duckdb/parquet-loader.ts'))
            .href,
          ENDPOINT: endpoint,
          BUCKETS: JSON.stringify(buckets),
          ...environment,
        },
      },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`scenario timed out: ${stderr || stdout}`));
    }, 90_000);
    child.on('close', () => {
      clearTimeout(timer);
      const line = stdout.split('\n').find((text) => text.startsWith('RESULT '));
      if (!line) reject(new Error(`scenario produced no result: ${stderr || stdout}`));
      else resolve(JSON.parse(line.slice(7)));
    });
  });
}

describe('private S3 buckets', () => {
  it('reads a private bucket with AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY', async () => {
    const [result] = await runScenario(
      { AWS_ACCESS_KEY_ID: GOOD_KEY, AWS_SECRET_ACCESS_KEY: GOOD_SECRET },
      ['private'],
    );
    expect(result).toMatchObject({ bucket: 'private', ok: true });
  });

  it('reads a private bucket with a named profile from the shared credentials file', async () => {
    const [result] = await runScenario(
      {
        AWS_PROFILE: 'work',
        AWS_SHARED_CREDENTIALS_FILE: configFiles.credentials,
        AWS_CONFIG_FILE: configFiles.config,
      },
      ['private'],
    );
    expect(result).toMatchObject({ bucket: 'private', ok: true });
  });

  it('reads a private bucket with the default profile', async () => {
    const credentials = join(directory, 'default-credentials');
    await writeFile(
      credentials,
      `[default]\naws_access_key_id = ${GOOD_KEY}\naws_secret_access_key = ${GOOD_SECRET}\n`,
    );
    const [result] = await runScenario(
      { AWS_SHARED_CREDENTIALS_FILE: credentials, AWS_CONFIG_FILE: configFiles.config },
      ['private'],
    );
    expect(result).toMatchObject({ bucket: 'private', ok: true });
  });

  it('is refused cleanly when no credentials exist', async () => {
    const [result] = await runScenario(
      { AWS_SHARED_CREDENTIALS_FILE: configFiles.missing, AWS_CONFIG_FILE: configFiles.missing },
      ['private'],
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/403/);
  });

  it('is refused when the credentials are not allowed to read the bucket', async () => {
    const [result] = await runScenario(
      { AWS_SHARED_CREDENTIALS_FILE: configFiles.credentials, AWS_CONFIG_FILE: configFiles.config },
      ['private'],
    );
    expect(result.ok).toBe(false);
  });
});

describe('public S3 buckets', () => {
  it('stay readable with no credentials at all', async () => {
    const [result] = await runScenario(
      { AWS_SHARED_CREDENTIALS_FILE: configFiles.missing, AWS_CONFIG_FILE: configFiles.missing },
      ['open'],
    );
    expect(result).toMatchObject({ bucket: 'open', ok: true });
  });

  it('stay readable when the default profile holds a key that AWS would reject', async () => {
    const [result] = await runScenario(
      { AWS_SHARED_CREDENTIALS_FILE: configFiles.credentials, AWS_CONFIG_FILE: configFiles.config },
      ['open'],
    );
    expect(result).toMatchObject({ bucket: 'open', ok: true });
  });

  it('stay readable after a private bucket needed credentials in the same session', async () => {
    const results = await runScenario(
      {
        AWS_PROFILE: 'work',
        AWS_SHARED_CREDENTIALS_FILE: configFiles.credentials,
        AWS_CONFIG_FILE: configFiles.config,
      },
      ['open', 'private', 'open'],
    );
    expect(results.map((result) => [result.bucket, result.ok])).toEqual([
      ['open', true],
      ['private', true],
      ['open', true],
    ]);
  });

  it('stay readable in a session that also holds invalid credentials and a private bucket', async () => {
    const results = await runScenario(
      { AWS_SHARED_CREDENTIALS_FILE: configFiles.credentials, AWS_CONFIG_FILE: configFiles.config },
      ['open', 'private', 'open'],
    );
    expect(results.map((result) => [result.bucket, result.ok])).toEqual([
      ['open', true],
      ['private', false],
      ['open', true],
    ]);
  });
});

describe('local use is unaffected', () => {
  it('does not touch credentials for a local CSV', async () => {
    const file = join(directory, 'local.csv');
    await writeFile(file, CSV);
    const database = await DuckDBInstance.create(':memory:');
    const conn = await database.connect();
    const run = async (sql: string): Promise<{ columns: string[]; rows: unknown[][] }> => {
      const result = await conn.run(sql);
      return { columns: result.columnNames(), rows: await result.getRowsJson() };
    };
    const adapter = {
      query: run,
      transaction: async <T>(cb: (tx: { query: typeof run }) => Promise<T>): Promise<T> => {
        await run('BEGIN');
        try {
          const value = await cb({ query: run });
          await run('COMMIT');
          return value;
        } catch (error) {
          await run('ROLLBACK');
          throw error;
        }
      },
    };
    await prepareDataFileReader(adapter as never, file);
    await loadFile(adapter as never, file, 'auto', 64, 'local_data');
    const session = new WranglingSession(adapter as never, 'local_data');
    session.load(file);
    expect((await session.getPage(0, 10)).schema.rowCount).toBe(3);
    const secrets = await run('SELECT COUNT(*) FROM duckdb_secrets()');
    expect(Number(secrets.rows[0][0])).toBe(0);
  });
});
