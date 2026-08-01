import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DuckDBInstance } from '@duckdb/node-api';

import { elapsedMs, median, quote, rounded, sourceSql } from './lib.mjs';

const benchmarkDir = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(benchmarkDir, '.data', 'formats');
const resultsDir = path.join(benchmarkDir, 'results');
const rows = Number(process.env.QW_FORMAT_ROWS ?? 100_000);
const runs = Number(process.env.QW_FORMAT_RUNS ?? 7);
mkdirSync(dataDir, { recursive: true });
mkdirSync(resultsDir, { recursive: true });

const formats = [
  { name: 'Parquet', path: path.join(dataDir, 'data.parquet'), copy: 'FORMAT PARQUET, COMPRESSION ZSTD', reader: 'read_parquet' },
  { name: 'CSV', path: path.join(dataDir, 'data.csv'), copy: 'FORMAT CSV, HEADER', reader: 'read_csv_auto' },
  { name: 'NDJSON', path: path.join(dataDir, 'data.ndjson'), copy: 'FORMAT JSON, ARRAY false', reader: 'read_json_auto' },
];

const generator = await DuckDBInstance.create(':memory:');
const generatorConnection = await generator.connect();
for (const format of formats) {
  await generatorConnection.run(`COPY (${sourceSql(rows)}) TO ${quote(format.path)} (${format.copy})`);
}
generatorConnection.closeSync();

const results = [];
for (const format of formats) {
  const samples = [];
  for (let index = 0; index < runs; index += 1) {
    const instance = await DuckDBInstance.create(':memory:');
    const connection = await instance.connect();
    const start = process.hrtime.bigint();
    await connection.run(`CREATE TABLE current_data AS SELECT * FROM ${format.reader}(${quote(format.path)})`);
    samples.push(elapsedMs(start));
    connection.closeSync();
  }
  results.push({ format: format.name, rows, file_mb: rounded(statSync(format.path).size / 1024 / 1024), load_ms: rounded(median(samples)) });
}

const report = { generated_at: new Date().toISOString(), methodology: { rows, runs, statistic: 'median' }, results };
writeFileSync(path.join(resultsDir, 'formats.json'), `${JSON.stringify(report, null, 2)}\n`);
const markdown = `# Multi-format loading\n\n| Format | Rows | File size (MB) | Load (ms) |\n|---|---:|---:|---:|\n${results.map((result) => `| ${result.format} | ${result.rows.toLocaleString('en-US')} | ${result.file_mb.toFixed(2)} | ${result.load_ms.toFixed(2)} |`).join('\n')}\n\nMedians of ${runs} loads into a fresh in-memory DuckDB instance. XLSX and ODS are excluded because their optional DuckDB extensions and writer setup would make the default benchmark network-dependent.\n`;
writeFileSync(path.join(resultsDir, 'formats.md'), markdown);
process.stdout.write(markdown);
