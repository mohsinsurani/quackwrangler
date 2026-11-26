// Loads real public files over the internet through QuackWrangler's own loader. Needs no account,
// API key, or credentials: HTTPS files are open downloads and the S3 buckets allow anonymous reads.
// Run it with `npm run test:remote`. It is not part of `npm test` because public servers can be
// slow or unavailable; the `Remote sources` workflow runs it weekly and on demand.
import { DuckDBInstance } from '@duckdb/node-api';

import { describeRemoteError } from '../../src/duckdb/remote-errors';
import { getFileMetadata, loadFile, prepareDataFileReader } from '../../src/duckdb/parquet-loader';
import { WranglingSession } from '../../src/transforms/pipeline';

interface Case {
  name: string;
  source: string;
  minRows: number;
  columns?: string[];
}

const OK_CASES: Case[] = [
  {
    name: 'HTTPS CSV',
    source: 'https://blobs.duckdb.org/data/Star_Trek-Season_1.csv',
    minRows: 30,
  },
  {
    name: 'HTTPS Parquet (7M rows, range requests)',
    source: 'https://blobs.duckdb.org/data/taxi_2019_04.parquet',
    minRows: 7_000_000,
  },
  {
    name: 'S3 CSV (anonymous, NOAA GHCN)',
    source: 's3://noaa-ghcn-pds/csv/by_year/1763.csv',
    minRows: 700,
  },
  {
    name: 'S3 Parquet (anonymous, Ookla open data)',
    source:
      's3://ookla-open-data/parquet/performance/type=fixed/year=2019/quarter=1/2019-01-01_performance_fixed_tiles.parquet',
    minRows: 4_000_000,
  },
];

const FAILURE_CASES: Array<{ name: string; source: string; expect: RegExp }> = [
  {
    name: 'missing HTTPS file',
    source: 'https://blobs.duckdb.org/data/does-not-exist.parquet',
    expect: /not found \(404\)/i,
  },
  {
    name: 'missing S3 object',
    source: 's3://noaa-ghcn-pds/csv/by_year/no-such-file.csv',
    expect: /not found \(404\)/i,
  },
  {
    name: 'private S3 bucket',
    source: 's3://nyc-tlc/trip data/yellow_tripdata_2019-01.parquet',
    expect: /access was denied \(403\)|not found \(404\)/i,
  },
  {
    name: 'unknown host',
    source: 'https://no-such-host-qw-12345.invalid/a.csv',
    expect: /could not reach/i,
  },
];

async function connect(): Promise<{
  adapter: never;
  query: (sql: string) => Promise<{ columns: string[]; rows: unknown[][] }>;
}> {
  const database = await DuckDBInstance.create(':memory:');
  const conn = await database.connect();
  const query = async (sql: string): Promise<{ columns: string[]; rows: unknown[][] }> => {
    const result = await conn.run(sql);
    return { columns: result.columnNames(), rows: await result.getRowsJson() };
  };
  await query('SET http_timeout = 60');
  const adapter = {
    query,
    transaction: async <T,>(callback: (tx: { query: typeof query }) => Promise<T>): Promise<T> => {
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

let failures = 0;
const fail = (message: string): void => {
  failures += 1;
  console.log(`FAIL  ${message}`);
};

for (const [index, testCase] of OK_CASES.entries()) {
  const started = Date.now();
  try {
    const { adapter } = await connect();
    await prepareDataFileReader(adapter, testCase.source);
    const mode = await loadFile(adapter, testCase.source, 'auto', 64, `public_${index}`);
    const session = new WranglingSession(adapter, `public_${index}`);
    session.load(testCase.source);
    const page = await session.getPage(0, 5);
    const metadata = await getFileMetadata(adapter, testCase.source);
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    if (mode !== 'lazy') fail(`${testCase.name}: expected a lazy load, got ${mode}`);
    else if (page.schema.rowCount < testCase.minRows)
      fail(`${testCase.name}: ${page.schema.rowCount} rows, expected at least ${testCase.minRows}`);
    else if (page.result.rows.length === 0) fail(`${testCase.name}: no rows on the first page`);
    else if (metadata.columns.length === 0) fail(`${testCase.name}: no columns`);
    else
      console.log(
        `PASS  ${testCase.name}: ${page.schema.rowCount.toLocaleString()} rows, ${metadata.columns.length} columns, ${seconds}s`,
      );
  } catch (error) {
    fail(`${testCase.name}: ${describeRemoteError(error, testCase.source)}`);
  }
}

for (const [index, testCase] of FAILURE_CASES.entries()) {
  try {
    const { adapter } = await connect();
    await prepareDataFileReader(adapter, testCase.source);
    await loadFile(adapter, testCase.source, 'auto', 64, `failure_${index}`);
    fail(`${testCase.name}: unexpectedly loaded`);
  } catch (error) {
    const message = describeRemoteError(error, testCase.source);
    if (testCase.expect.test(message))
      console.log(`PASS  ${testCase.name}: "${message.slice(0, 90)}…"`);
    else fail(`${testCase.name}: unexpected message: ${message}`);
  }
}

console.log(
  failures === 0 ? '\nAll remote checks passed.' : `\n${failures} remote check(s) failed.`,
);
process.exit(failures === 0 ? 0 : 1);
