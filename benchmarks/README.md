# Performance benchmark

This benchmark compares QuackWrangler's production engine (`@duckdb/node-api`) with Polars and Pandas using the same deterministic Parquet input and equivalent eager operations.

## Run it

Requirements: Node.js, the repository's npm dependencies, and [uv](https://docs.astral.sh/uv/). Python packages are installed into uv's isolated script environment; they are benchmark tooling and are not QuackWrangler runtime dependencies.

```bash
npm ci
npm run benchmark
```

Optional environment variables:

```bash
QW_BENCHMARK_ROWS=1000000 QW_BENCHMARK_RUNS=7 QW_BENCHMARK_WARMUPS=2 npm run benchmark
```

Additional suites:

```bash
npm run benchmark:scalability # 10K, 100K, 1M, and 10M rows with peak RSS
npm run benchmark:formats     # Parquet, CSV, and NDJSON loading
npm run benchmark:all         # run every default suite
```

Large scalability runs are deliberately opt-in:

```bash
QW_SCALABILITY_ROWS=1000000,10000000,50000000,100000000 \
QW_SCALABILITY_OUTPUT=scalability-large npm run benchmark:scalability
```

Only request sizes appropriate for the available disk and memory. The runner reports a failure as OOM only when the worker process actually fails for that reason; it never assumes Pandas or another engine will fail.

If a worker fails, the suite stops additional samples for that engine and size but continues with the remaining engines. The JSON result records `status: "failed"`, the exit code or signal, and a shortened error message; timing and peak RSS remain `null`. A kill signal alone is not treated as proof of OOM.

Use `QW_SCALABILITY_OUTPUT` for exploratory runs so the default verified result is preserved. For example, the repository's 50M-row artifact was produced with:

```bash
QW_SCALABILITY_ROWS=50000000 QW_SCALABILITY_RUNS=1 \
QW_SCALABILITY_OUTPUT=scalability-50m npm run benchmark:scalability
```

The runners write machine-readable JSON and Markdown summaries under `benchmarks/results/`.

Committed result set:

| Artifact | Meaning |
| --- | --- |
| `latest.json` / `latest.md` | Seven-run, one-million-row engine comparison |
| `scalability.json` / `scalability.md` | Three-run 10K–10M scaling and peak RSS |
| `scalability-50m.json` / `scalability-50m.md` | Exploratory one-sample 50M result |
| `formats.json` / `formats.md` | Seven-run Parquet/CSV/NDJSON loading comparison |

Older timing values remain valid measurements when the renderer or failure schema evolves. Their Markdown summaries are regenerated into the current Status-column presentation without changing recorded timings.

## Methodology

1. Generate a deterministic, one-million-row, Zstandard-compressed Parquet file. Data generation is excluded from timings.
2. Materialize the Parquet data into each engine's in-memory representation.
3. Filter numeric and Boolean columns, group by two categorical columns, calculate count/sum/mean, sort, and return 20 rows.
4. Run two warmups and seven measured iterations, reporting the median.
5. Compare exact keys/counts and floating-point aggregates within `0.001`; reject semantic mismatches.

The primary benchmark intentionally measures the eager workflow used by QuackWrangler today. The scalability suite launches a fresh process for every sample and reports peak process RSS, including the language runtime and imported libraries. It is not a universal engine ranking. Results vary by hardware, operating system, library version, file shape, cache state, and query.

The format suite covers Parquet, CSV, and newline-delimited JSON without network access. XLSX and ODS are excluded from the default suite because generating them and loading DuckDB's optional extensions would introduce external writers and network-dependent setup.

End-to-end “click to first paint” latency is not reported yet. A valid UX measurement requires instrumentation inside the VS Code extension host and webview; engine timing is not presented as a substitute.
