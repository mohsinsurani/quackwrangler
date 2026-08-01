import process from 'node:process';

import { DuckDBInstance } from '@duckdb/node-api';

import { elapsedMs, quote, rounded } from './lib.mjs';

const dataPath = process.argv[2];
const instance = await DuckDBInstance.create(':memory:');
const connection = await instance.connect();
const start = process.hrtime.bigint();
await connection.run(`CREATE TABLE current_data AS SELECT * FROM read_parquet(${quote(dataPath)})`);
const result = await connection.run(`
  SELECT region, category, COUNT(*) AS row_count,
         ROUND(SUM(amount * quantity), 6) AS gross,
         ROUND(AVG(amount), 6) AS avg_amount
  FROM current_data
  WHERE active AND amount >= 25
  GROUP BY region, category
  ORDER BY gross DESC, region, category
  LIMIT 20
`);
const output = (await result.getRowsJson()).map(([region, category, count, gross, average]) => [
  region, category, Number(count), Number(gross), Number(average),
]);
const totalMs = elapsedMs(start);
connection.closeSync();

process.stdout.write(JSON.stringify({
  total_ms: rounded(totalMs),
  peak_rss_mb: rounded(process.resourceUsage().maxRSS / 1024),
  result: output,
}));
