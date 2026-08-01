import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { DuckDBInstance } from '@duckdb/node-api';

import { elapsedMs, generateParquet, median, quote, rounded } from './lib.mjs';

const benchmarkDir = path.dirname(fileURLToPath(import.meta.url));
const resultsDir = path.join(benchmarkDir, 'results');
const dataDir = path.join(benchmarkDir, '.data');
const rows = Number(process.env.QW_BENCHMARK_ROWS ?? 1_000_000);
const runs = Number(process.env.QW_BENCHMARK_RUNS ?? 7);
const warmups = Number(process.env.QW_BENCHMARK_WARMUPS ?? 2);

mkdirSync(resultsDir, { recursive: true });
mkdirSync(dataDir, { recursive: true });

const dataPath = await generateParquet(dataDir, rows);

const workloadSql = `
  SELECT region, category, COUNT(*) AS row_count,
         ROUND(SUM(amount * quantity), 6) AS gross,
         ROUND(AVG(amount), 6) AS avg_amount
  FROM current_data
  WHERE active AND amount >= 25
  GROUP BY region, category
  ORDER BY gross DESC, region, category
  LIMIT 20
`;

async function runDuckDBIteration() {
  const instance = await DuckDBInstance.create(':memory:');
  const connection = await instance.connect();
  const loadStart = process.hrtime.bigint();
  await connection.run(`CREATE TABLE current_data AS SELECT * FROM read_parquet(${quote(dataPath)})`);
  const loadMs = elapsedMs(loadStart);
  const transformStart = process.hrtime.bigint();
  const result = await connection.run(workloadSql);
  const output = await result.getRowsJson();
  const transformMs = elapsedMs(transformStart);
  connection.closeSync();
  return { loadMs, transformMs, totalMs: loadMs + transformMs, output };
}

async function benchmarkDuckDB() {
  for (let index = 0; index < warmups; index += 1) await runDuckDBIteration();
  const samples = [];
  for (let index = 0; index < runs; index += 1) samples.push(await runDuckDBIteration());
  const representative = samples[0].output.map(([region, category, rowCount, gross, average]) => [
    region,
    category,
    Number(rowCount),
    Number(gross),
    Number(average),
  ]);
  return {
    engine: 'QuackWrangler (DuckDB)',
    version: (await import('@duckdb/node-api/package.json', { with: { type: 'json' } })).default.version,
    load_ms: rounded(median(samples.map((sample) => sample.loadMs))),
    transform_ms: rounded(median(samples.map((sample) => sample.transformMs))),
    total_ms: rounded(median(samples.map((sample) => sample.totalMs))),
    result: representative,
  };
}

const duckdb = await benchmarkDuckDB();
const pythonOutput = execFileSync(
  'uv',
  ['run', '--script', path.join(benchmarkDir, 'python_engines.py'), dataPath, String(runs), String(warmups)],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
);
const pythonResults = JSON.parse(pythonOutput);
const expected = JSON.stringify(duckdb.result);
for (const result of pythonResults.results) {
  if (JSON.stringify(result.result) !== expected) {
    throw new Error(`${result.engine} produced a different result from QuackWrangler\nDuckDB: ${expected}\n${result.engine}: ${JSON.stringify(result.result)}`);
  }
}

const output = {
  generated_at: new Date().toISOString(),
  machine: {
    os: `${os.type()} ${os.release()}`,
    architecture: os.arch(),
    cpu: os.cpus()[0]?.model ?? 'unknown',
    logical_cores: os.cpus().length,
    memory_gb: rounded(os.totalmem() / 1024 ** 3),
    node: process.version,
    python: pythonResults.python,
  },
  methodology: {
    dataset_rows: rows,
    dataset: 'deterministic synthetic Parquet (Zstandard)',
    runs,
    warmups,
    statistic: 'median',
    workload: 'materialize Parquet, then filter + grouped aggregates + sort + limit',
    result_validation: 'all engines must return the same rounded 20-row result',
  },
  results: [duckdb, ...pythonResults.results].map(({ result, ...summary }) => summary),
};

writeFileSync(path.join(resultsDir, 'latest.json'), `${JSON.stringify(output, null, 2)}\n`);
writeFileSync(path.join(resultsDir, 'latest.md'), renderMarkdown(output));
process.stdout.write(readFileSync(path.join(resultsDir, 'latest.md'), 'utf8'));

function renderMarkdown(report) {
  const rows = report.results
    .map((result) => `| ${result.engine} | ${result.version} | ${result.load_ms.toFixed(2)} | ${result.transform_ms.toFixed(2)} | ${result.total_ms.toFixed(2)} |`)
    .join('\n');
  return `# QuackWrangler benchmark\n\nGenerated ${report.generated_at.slice(0, 10)} on ${report.machine.cpu} (${report.machine.architecture}, ${report.machine.memory_gb} GB RAM, ${report.machine.os}).\n\n| Engine | Version | Load (ms) | Transform (ms) | Total (ms) |\n|---|---:|---:|---:|---:|\n${rows}\n\nValues are medians of ${report.methodology.runs} measured runs after ${report.methodology.warmups} warmups on a deterministic ${report.methodology.dataset_rows.toLocaleString('en-US')}-row Parquet file. Lower is better. All engines returned the same validated result.\n`;
}
