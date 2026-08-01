import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { DuckDBInstance } from '@duckdb/node-api';

export const quote = (value) => `'${value.replaceAll("'", "''")}'`;
export const elapsedMs = (start) => Number(process.hrtime.bigint() - start) / 1e6;
export const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
export const rounded = (value) => Math.round(value * 100) / 100;

export const sourceSql = (rows) => `
  SELECT i::BIGINT AS id,
         'category_' || LPAD(((i * 17) % 100)::VARCHAR, 3, '0') AS category,
         ['APAC', 'EMEA', 'LATAM', 'NA'][1 + ((i * 7) % 4)] AS region,
         (((i * 37) % 10000)::DOUBLE / 100.0) AS amount,
         (1 + ((i * 13) % 10))::INTEGER AS quantity,
         (i % 5) != 0 AS active,
         DATE '2020-01-01' + ((i * 11) % 1825)::INTEGER AS event_date
  FROM range(1, ${rows + 1}) AS t(i)
`;

export async function generateParquet(dataDir, rows) {
  mkdirSync(dataDir, { recursive: true });
  const dataPath = path.join(dataDir, `synthetic-${rows}.parquet`);
  const instance = await DuckDBInstance.create(':memory:');
  const connection = await instance.connect();
  await connection.run(`COPY (${sourceSql(rows)}) TO ${quote(dataPath)} (FORMAT PARQUET, COMPRESSION ZSTD)`);
  connection.closeSync();
  return dataPath;
}

export function renderScalability(report) {
  const body = report.results.map((row) => {
    const total = row.total_ms === null ? '—' : row.total_ms.toFixed(2);
    const rss = row.peak_rss_mb === null ? '—' : row.peak_rss_mb.toFixed(2);
    const status = row.status === 'completed' ? 'Completed' : `Failed (${row.signal ?? row.exit_code ?? 'unknown'})`;
    return `| ${row.rows.toLocaleString('en-US')} | ${row.engine} | ${status} | ${total} | ${rss} |`;
  }).join('\n');
  return `# Scalability and peak memory\n\n| Rows | Engine | Status | Total (ms) | Peak process RSS (MB) |\n|---:|---|---|---:|---:|\n${body}\n\nMedians of up to ${report.methodology.runs} fresh-process runs. Peak RSS includes each language runtime and loaded libraries. The current runner stops sampling after the first worker failure for an engine and row count, records the observed exit code or signal, and does not label OOM without supporting evidence.\n`;
}
