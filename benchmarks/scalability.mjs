import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateParquet, median, renderScalability, rounded } from './lib.mjs';

const benchmarkDir = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(benchmarkDir, '.data');
const resultsDir = path.join(benchmarkDir, 'results');
const sizes = (process.env.QW_SCALABILITY_ROWS ?? '10000,100000,1000000,10000000')
  .split(',').map(Number).filter((value) => Number.isSafeInteger(value) && value > 0);
const runs = Number(process.env.QW_SCALABILITY_RUNS ?? 3);
const outputName = process.env.QW_SCALABILITY_OUTPUT ?? 'scalability';
if (!/^[a-z0-9][a-z0-9-]*$/i.test(outputName)) {
  throw new Error('QW_SCALABILITY_OUTPUT must contain only letters, numbers, and hyphens');
}
const engines = ['duckdb', 'polars', 'pandas'];
mkdirSync(resultsDir, { recursive: true });

function runWorker(engine, dataPath) {
  try {
    const stdout = engine === 'duckdb'
      ? execFileSync(process.execPath, [path.join(benchmarkDir, 'duckdb_worker.mjs'), dataPath], { encoding: 'utf8' })
      : execFileSync('uv', ['run', '--script', path.join(benchmarkDir, 'python_worker.py'), engine, dataPath], { encoding: 'utf8' });
    return { status: 'completed', ...JSON.parse(stdout) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: 'failed',
      exit_code: typeof error?.status === 'number' ? error.status : null,
      signal: typeof error?.signal === 'string' ? error.signal : null,
      total_ms: null,
      peak_rss_mb: null,
      error: message.replaceAll('\n', ' ').slice(0, 500),
    };
  }
}

function equivalentResults(actual, expected) {
  if (actual.length !== expected.length) return false;
  return actual.every((row, index) => {
    const reference = expected[index];
    return row[0] === reference[0]
      && row[1] === reference[1]
      && row[2] === reference[2]
      && Math.abs(row[3] - reference[3]) <= 0.001
      && Math.abs(row[4] - reference[4]) <= 0.001;
  });
}

const measurements = [];
for (const rowCount of sizes) {
  const dataPath = await generateParquet(dataDir, rowCount);
  let expected;
  for (const engine of engines) {
    const samples = [];
    for (let index = 0; index < runs; index += 1) {
      const sample = runWorker(engine, dataPath);
      samples.push(sample);
      if (sample.status === 'failed') break;
    }
    const failure = samples.find((sample) => sample.status === 'failed');
    const engineName = engine === 'duckdb' ? 'QuackWrangler (DuckDB)' : engine[0].toUpperCase() + engine.slice(1);
    if (failure) {
      measurements.push({
        rows: rowCount,
        engine: engineName,
        status: 'failed',
        total_ms: null,
        peak_rss_mb: null,
        exit_code: failure.exit_code,
        signal: failure.signal,
        error: failure.error,
      });
      continue;
    }
    expected ??= samples[0].result;
    if (samples.some((sample) => !equivalentResults(sample.result, expected))) {
      throw new Error(`${engine} returned a different result at ${rowCount.toLocaleString('en-US')} rows`);
    }
    measurements.push({
      rows: rowCount,
      engine: engineName,
      total_ms: rounded(median(samples.map((sample) => sample.total_ms))),
      peak_rss_mb: rounded(median(samples.map((sample) => sample.peak_rss_mb))),
      status: 'completed',
    });
  }
}

const report = {
  generated_at: new Date().toISOString(),
  machine: { cpu: os.cpus()[0]?.model, architecture: os.arch(), memory_gb: rounded(os.totalmem() / 1024 ** 3), os: `${os.type()} ${os.release()}` },
  methodology: { runs, process_isolation: 'fresh process per measurement', statistic: 'median', sizes, stop_after_first_worker_failure: true, result_validation: 'exact keys/counts and 0.001 absolute tolerance for floating-point aggregates' },
  results: measurements,
};
writeFileSync(path.join(resultsDir, `${outputName}.json`), `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(path.join(resultsDir, `${outputName}.md`), renderScalability(report));
process.stdout.write(renderScalability(report));
