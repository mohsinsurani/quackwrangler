import { beforeAll, describe, expect, it } from 'vitest';
import { DuckDBInstance } from '@duckdb/node-api';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WranglingSession } from '../../src/transforms/pipeline';
import { normalizeReadOnlyQuery } from '../../src/duckdb/query-engine';
import {
  loadFile,
  prepareDataFileReader,
  prepareSourceSchema,
} from '../../src/duckdb/parquet-loader';
import * as XLSX from '@e965/xlsx';

let database: DuckDBInstance;

function createAdapter() {
  return {
    query: async (sql: string) => {
      const connection = await database.connect();
      try {
        const result = await connection.run(sql);
        const rows = await result.getRowsJson();
        return {
          columns: result.columnNames(),
          rows,
          rowCount: rows.length,
          duration: 0,
        };
      } finally {
        connection.closeSync();
      }
    },
    transaction: async <T>(
      callback: (transaction: { query: (sql: string) => Promise<unknown> }) => Promise<T>,
    ) => {
      const connection = await database.connect();
      await connection.run('BEGIN TRANSACTION');
      try {
        const value = await callback({
          query: async (sql: string) => {
            const result = await connection.run(sql);
            const rows = await result.getRowsJson();
            return {
              columns: result.columnNames(),
              rows,
              rowCount: rows.length,
              duration: 0,
            };
          },
        });
        await connection.run('COMMIT');
        return value;
      } catch (error) {
        await connection.run('ROLLBACK');
        throw error;
      } finally {
        connection.closeSync();
      }
    },
  };
}

async function runPipeline(type: string, params: Record<string, unknown>): Promise<unknown[][]> {
  const session = new WranglingSession({} as never);
  session.load('/tmp/data.csv');
  session.apply(type, params);
  const connection = await database.connect();
  try {
    const result = await connection.run(session.getSql());
    return await result.getRowsJson();
  } finally {
    connection.closeSync();
  }
}

beforeAll(async () => {
  database = await DuckDBInstance.create(':memory:');
  const connection = await database.connect();
  await connection.run(`
    CREATE TABLE current_data (
      id INTEGER,
      name VARCHAR,
      amount DOUBLE,
      region VARCHAR,
      nullable VARCHAR
    );
    INSERT INTO current_data VALUES
      (1, 'Alpha', 10, 'east', NULL),
      (2, 'Beta', 20, 'west', 'x'),
      (2, 'alphabet', 30, 'east', NULL)
  `);
  connection.closeSync();
});

describe('transactional file promotion', () => {
  it('keeps the previous relation when promotion fails after dropping it', async () => {
    const source = join(tmpdir(), `quackwrangler-loader-${randomUUID()}.parquet`);
    const writer = await database.connect();
    await writer.run(`COPY (SELECT 42 AS value) TO '${source}' (FORMAT PARQUET)`);
    writer.closeSync();

    const adapter = createAdapter();
    await loadFile(adapter as never, source, 'eager', 64, 'loader_test_data');
    const before = await adapter.query('SELECT * FROM loader_test_data');
    expect(before.rows).toEqual([[42]]);

    const failingAdapter = {
      ...adapter,
      transaction: async <T>(
        callback: (transaction: { query: (sql: string) => Promise<unknown> }) => Promise<T>,
      ) =>
        adapter.transaction((transaction) =>
          callback({
            query: async (sql: string) => {
              if (sql.startsWith('ALTER TABLE')) throw new Error('injected promotion failure');
              return transaction.query(sql);
            },
          }),
        ),
    };

    await expect(
      loadFile(failingAdapter as never, source, 'eager', 64, 'loader_test_data'),
    ).rejects.toThrow('injected promotion failure');
    const after = await adapter.query('SELECT * FROM loader_test_data');
    expect(after.rows).toEqual([[42]]);
  });
});

describe('supported file formats', () => {
  const skipOptionalExtensionTests = process.env.QW_SKIP_OPTIONAL_EXTENSION_TESTS === 'true';

  it('converts legacy XLS files to a temporary XLSX before loading', async () => {
    const source = join(tmpdir(), `quackwrangler-legacy-${randomUUID()}.xls`);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ['id', 'name'],
        [1, 'duck'],
      ]),
      'Sheet1',
    );
    await writeFile(source, XLSX.write(workbook, { bookType: 'xls', type: 'buffer' }));

    const adapter = createAdapter();
    const tempDirectory = join(tmpdir(), `quackwrangler-xls-${randomUUID()}`);
    const connection = { ...adapter, getTempDirectory: () => tempDirectory };
    await prepareDataFileReader(connection as never, source);
    await loadFile(connection as never, source, 'eager', 64, 'format_xls_data');
    const result = await connection.query('SELECT * FROM format_xls_data');
    expect(result.rows).toEqual([['1', 'duck']]);
  });

  it.each([
    ['tsv', 'FORMAT CSV, DELIMITER \'\\t\', HEADER true'],
    ['json', 'FORMAT JSON, ARRAY true'],
    ['jsonl', 'FORMAT JSON, ARRAY false'],
    ['ndjson', 'FORMAT JSON, ARRAY false'],
  ])('loads %s files through the shared loader', async (extension, copyOptions) => {
    const source = join(tmpdir(), `quackwrangler-format-${randomUUID()}.${extension}`);
    const writer = await database.connect();
    await writer.run(
      `COPY (SELECT 1 AS id, 'duck' AS name) TO '${source}' (${copyOptions})`,
    );
    writer.closeSync();

    const adapter = createAdapter();
    await prepareDataFileReader(adapter as never, source);
    await loadFile(adapter as never, source, 'eager', 64, `format_${extension}_data`);
    const result = await adapter.query(`SELECT * FROM format_${extension}_data`);
    expect(result.rows).toEqual([['1', 'duck']]);
  });

  it.skipIf(skipOptionalExtensionTests)('loads ODS through the spatial reader', async () => {
    const source = join(tmpdir(), `quackwrangler-format-${randomUUID()}.ods`);
    const workbook =
      'UEsDBBQAAAAAADyCbF2FbDmKLgAAAC4AAAAIAAAAbWltZXR5cGVhcHBsaWNhdGlvbi92bmQub2FzaXMub3BlbmRvY3VtZW50LnNwcmVhZHNoZWV0UEsDBBQAAAAIADyCbF0h0v8CKgEAAMkDAAALAAAAY29udGVudC54bWytU9tSgzAQ/RUm7zTQJ80AffMH1A9Ik4UyplkmCUr/3oRQCo520PEF9nZ2z56F4jCcVfIOxraoS5LvMpKAFihb3ZTk9eUpfSCHqsC6bgUwiaI/g3apQO38O/FgbVnMlqQ3miG3rWWan8EyJxh2oK8otqxm46gYcfyoNsPH4hUaBrcZ7GuX2MgFEUtycq5jlAZQjO7QNHSfZY80+leM4ErcRppmVqXGXkvuvJATBxg6MG1IcTXC2KpDJDLJsTjBnsyCH1FeZsd2Bri0JwBXFVGG8ZlEO8wsyXNI52RVkBr8WAcEKDVP5qqH1F06j7bO+MMHdODXVa0s6GR640uDv7UMNO82pXeZb16lVsgdWWW8uDce+b9vJnvx9svNlhHvfXdouvoU6A9/YvUJUEsDBBQAAAAIADyCbF21rYD5tgAAAHABAAAVAAAATUVUQS1JTkYvbWFuaWZlc3QueG1sjZDRCsIwDEV/ZeR9q/okZdU3v0A/oLSZFtq0rNnY/t4qOCci+JaQ3Htu0h6n4KsR++wiKdg2G6iQTLSOrgou51O9h+OhDZpch5nlq6iKjPLSKhh6klFnlyXpgFmykTEh2WiGgMTyc18+QUu34u9gReucx7qo+/m92w3e10nzTYFYWQS0Ttc8J1SgU/LOaC6WYiTbPHM16zhNTj1qm2+IDOJ/oonED3m55gebcWLxGBdX8fW2wx1QSwECFAMUAAAAAAA8gmxdhWw5ii4AAAAuAAAACAAAAAAAAAAAAAAAgAEAAAAAbWltZXR5cGVQSwECFAMUAAAACAA8gmxdIdL/AioBAADJAwAACwAAAAAAAAAAAAAAgAFUAAAAY29udGVudC54bWxQSwECFAMUAAAACAA8gmxdta2A+bYAAABwAQAAFQAAAAAAAAAAAAAAgAGnAQAATUVUQS1JTkYvbWFuaWZlc3QueG1sUEsFBgAAAAADAAMAsgAAAJACAAAAAA==';
    await writeFile(source, Buffer.from(workbook, 'base64'));

    const adapter = createAdapter();
    await prepareDataFileReader(adapter as never, source);
    await loadFile(adapter as never, source, 'eager', 64, 'format_ods_data');
    const result = await adapter.query('SELECT id, name FROM format_ods_data');
    expect(result.rows).toEqual([[1, 'duck']]);
  });

  it
    .skipIf(skipOptionalExtensionTests)
    .each(['arrow', 'arrows', 'ipc'])('loads .%s Arrow IPC files', async (extension) => {
    const source = join(tmpdir(), `quackwrangler-format-${randomUUID()}.${extension}`);
    const writer = await database.connect();
    try {
      await writer.run('LOAD nanoarrow');
    } catch {
      await writer.run('INSTALL nanoarrow FROM community');
      await writer.run('LOAD nanoarrow');
    }
    const ipc = await writer.run("SELECT * FROM to_arrow_ipc((SELECT 1 AS id, 'duck' AS name))");
    const chunks = (await ipc.getRows()).map((row) => (row[0] as { bytes: Buffer }).bytes);
    writer.closeSync();
    await writeFile(source, Buffer.concat(chunks));

    const adapter = createAdapter();
    await prepareDataFileReader(adapter as never, source);
    await loadFile(adapter as never, source, 'eager', 64, `format_${extension}_data`);
    const result = await adapter.query(`SELECT * FROM format_${extension}_data`);
    expect(result.rows).toEqual([[1, 'duck']]);
  });

  it.skipIf(skipOptionalExtensionTests)('loads ORC through the signed community extension', async () => {
    const source = join(tmpdir(), `quackwrangler-format-${randomUUID()}.orc`);
    const writer = await database.connect();
    try {
      await writer.run('LOAD orc');
    } catch {
      await writer.run('INSTALL orc FROM community');
      await writer.run('LOAD orc');
    }
    await writer.run(`COPY (SELECT 1 AS id, 'duck' AS name) TO '${source}' (FORMAT ORC)`);
    writer.closeSync();

    const adapter = createAdapter();
    await prepareDataFileReader(adapter as never, source);
    await loadFile(adapter as never, source, 'eager', 64, 'format_orc_data');
    const result = await adapter.query('SELECT * FROM format_orc_data');
    expect(result.rows).toEqual([[1, 'duck']]);
  });
});

describe('CSV type resolution', () => {
  it('loads a numeric column that contains a late textual value', async () => {
    // Reproduces the reported failure: a column that looks like BIGINT in the
    // sampled rows but contains "ALL" far beyond the sample window.
    const source = join(tmpdir(), `quackwrangler-late-text-${randomUUID()}.csv`);
    let body = 'GP_PRAC,NUMBER_OF_PATIENTS\n';
    for (let index = 0; index < 50_000; index += 1) body += `A${index},${index}\n`;
    body += 'A99999,ALL\n';
    await writeFile(source, body);

    const adapter = createAdapter();
    await prepareSourceSchema(adapter as never, source);
    await loadFile(adapter as never, source, 'lazy', 64, 'late_text_data');

    // A projecting read is required: COUNT(*) alone can skip the conversion.
    const rows = await adapter.query('SELECT * FROM late_text_data');
    expect(rows.rowCount).toBe(50_001);
    const preserved = await adapter.query(
      `SELECT NUMBER_OF_PATIENTS FROM late_text_data WHERE GP_PRAC = 'A99999'`,
    );
    expect(preserved.rows).toEqual([['ALL']]);
  });

  it('keeps precise types for clean columns instead of widening everything', async () => {
    const source = join(tmpdir(), `quackwrangler-clean-${randomUUID()}.csv`);
    await writeFile(source, 'id,amount\n1,10.5\n2,20.5\n');

    const adapter = createAdapter();
    await prepareSourceSchema(adapter as never, source);
    await loadFile(adapter as never, source, 'lazy', 64, 'clean_typed_data');

    const described = await adapter.query('DESCRIBE SELECT * FROM clean_typed_data');
    expect(described.rows.map((row) => [row[0], row[1]])).toEqual([
      ['id', 'BIGINT'],
      ['amount', 'DOUBLE'],
    ]);
  });

  it('resolves types once and reuses them for later queries', async () => {
    const source = join(tmpdir(), `quackwrangler-cached-${randomUUID()}.csv`);
    await writeFile(source, 'id,label\n1,a\n2,b\n');

    const adapter = createAdapter();
    const executed: string[] = [];
    const tracking = {
      ...adapter,
      query: async (sql: string) => {
        executed.push(sql);
        return adapter.query(sql);
      },
    };

    await prepareSourceSchema(tracking as never, source);
    await loadFile(tracking as never, source, 'lazy', 64, 'cached_typed_data');
    await tracking.query('SELECT * FROM cached_typed_data');
    await tracking.query('SELECT * FROM cached_typed_data LIMIT 1');

    expect(executed.filter((sql) => sql.includes('sniff_csv'))).toHaveLength(1);
    // Steady-state queries must not carry full-file detection.
    expect(executed.some((sql) => sql.includes('sample_size=-1'))).toBe(false);
  });
});

describe('XLSX type resolution', () => {
  it('restores native Excel dates, timestamps, times, and booleans', async () => {
    const source = join(tmpdir(), `quackwrangler-temporal-${randomUUID()}.xlsx`);
    const writer = await database.connect();
    await writer.run('LOAD excel');
    await writer.run(
      `COPY (
        SELECT DATE '2024-03-04' AS event_date,
               TIMESTAMP '2024-03-04 12:34:56' AS event_time,
               TIME '12:34:56' AS clock_time,
               true AS enabled
      ) TO '${source}' (FORMAT XLSX, HEADER true)`,
    );
    writer.closeSync();

    const adapter = createAdapter();
    await prepareDataFileReader(adapter as never, source);
    await loadFile(adapter as never, source, 'eager', 64, 'temporal_xlsx_data');

    const described = await adapter.query('DESCRIBE SELECT * FROM temporal_xlsx_data');
    expect(described.rows.map((row) => [row[0], row[1]])).toEqual([
      ['event_date', 'DATE'],
      ['event_time', 'TIMESTAMP'],
      ['clock_time', 'TIME'],
      ['enabled', 'BOOLEAN'],
    ]);
    const values = await adapter.query('SELECT * FROM temporal_xlsx_data');
    expect(values.rows).toEqual([['2024-03-04', '2024-03-04 12:34:56', '12:34:56', true]]);
  });

  it('loads a column containing numeric and textual cells', async () => {
    const source = join(tmpdir(), `quackwrangler-mixed-${randomUUID()}.xlsx`);
    // Minimal XLSX workbook with a numeric H2 and the text "tablet" in H3.
    const workbook =
      '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';
    await writeFile(source, Buffer.from(workbook, 'base64'));

    const adapter = createAdapter();
    await prepareDataFileReader(adapter as never, source);
    await loadFile(adapter as never, source, 'eager', 64, 'mixed_xlsx_data');

    const result = await adapter.query('SELECT form FROM mixed_xlsx_data');
    expect(result.rows).toEqual([['42'], ['tablet']]);
  });
});

describe('displayed filter operations execute in DuckDB', () => {
  it('continues to execute the legacy raw condition format', async () => {
    expect(await runPipeline('filter_rows', { condition: 'amount > 10' })).toHaveLength(2);
  });

  it.each([
    ['equals', { value: 'east' }],
    ['not_equals', { value: 'west' }],
    ['contains', { value: 'ast' }],
    ['not_contains', { value: 'west' }],
    ['starts_with', { value: 'e' }],
    ['ends_with', { value: 'st' }],
    ['in', { value: 'east,west' }],
    ['not_in', { value: 'north,south' }],
    ['is_null', {}],
    ['is_not_null', {}],
  ])('%s', async (operator, values) => {
    const column = operator.includes('null') ? 'nullable' : 'region';
    expect(
      (await runPipeline('filter_rows', { column, operator, ...values })).length,
    ).toBeGreaterThan(0);
  });

  it.each([
    ['greater_than', { value: 10 }],
    ['greater_equals', { value: 20 }],
    ['less_than', { value: 30 }],
    ['less_equals', { value: 20 }],
    ['between', { value: 10, value2: 20 }],
  ])('%s', async (operator, values) => {
    expect(
      (await runPipeline('filter_rows', { column: 'amount', operator, ...values })).length,
    ).toBeGreaterThan(0);
  });
});

describe('displayed transforms execute in DuckDB', () => {
  it.each([
    ['drop_column', { column: 'nullable' }],
    ['rename_column', { oldName: 'name', newName: 'label' }],
    ['add_column', { name: 'doubled', expression: 'amount * 2' }],
    ['cast_type', { column: 'amount', targetType: 'INTEGER' }],
    ['fill_nulls', { column: 'nullable', value: 'missing' }],
    ['sort_rows', { column: 'amount', direction: 'DESC' }],
    ['deduplicate', { columns: 'id' }],
  ])('%s', async (type, params) => {
    expect((await runPipeline(type, params)).length).toBeGreaterThan(0);
  });

  it('deduplicates a single Year column using the exact UI payload shape', async () => {
    const connection = await database.connect();
    try {
      await connection.run(`
        CREATE OR REPLACE TABLE world_cup AS
        SELECT * FROM (VALUES
          (2022, 'Qatar'),
          (2018, 'Russia'),
          (2022, 'Duplicate')
        ) AS records(Year, Host)
      `);
      const session = new WranglingSession({} as never);
      session.load('/tmp/world_cup.csv');
      session.apply('deduplicate', { columns: 'Year' });
      const sql = session.getSql().replace(/\bcurrent_data\b/g, 'world_cup');
      const result = await connection.run(sql);
      expect(await result.getRowsJson()).toHaveLength(2);
    } finally {
      connection.closeSync();
    }
  });
});

describe('displayed aggregates execute in DuckDB', () => {
  it.each([
    ['COUNT', {}],
    ['COUNT_DISTINCT', { column: 'id' }],
    ['SUM', { column: 'amount' }],
    ['AVG', { column: 'amount' }],
    ['MIN', { column: 'amount' }],
    ['MAX', { column: 'amount' }],
  ])('%s', async (fn, values) => {
    expect(
      await runPipeline('aggregate', { function: fn, alias: 'result', ...values }),
    ).toHaveLength(1);
  });

  it('groups aggregate results', async () => {
    expect(
      await runPipeline('aggregate', {
        function: 'SUM',
        column: 'amount',
        groupBy: 'region',
        alias: 'total',
      }),
    ).toHaveLength(2);
  });
});

describe('reshape transforms execute in DuckDB', () => {
  it('pivots long data into columns', async () => {
    const rows = await runPipeline('pivot', {
      index: 'name',
      column: 'region',
      value: 'amount',
      aggregate: 'SUM',
    });
    expect(rows.length).toBeGreaterThan(0);
  });

  it('unpivots selected columns into name/value rows', async () => {
    const rows = await runPipeline('unpivot', {
      columns: 'id, amount',
      nameColumn: 'metric',
      valueColumn: 'metric_value',
    });
    expect(rows.length).toBeGreaterThan(3);
  });
});

describe('nested transforms execute in DuckDB', () => {
  async function runNested(type: string, params: Record<string, unknown>) {
    const connection = await database.connect();
    try {
      await connection.run(`
        CREATE OR REPLACE TABLE nested_data AS
        SELECT
          {'source': {'id': 7, 'name': 'sensor'}, 'version': 2} AS metadata,
          [{'kind': 'walk', 'value': 4}, {'kind': 'run', 'value': 8}] AS events,
          MAP {'source': 'official', 'version': '2'} AS labels
      `);
      const session = new WranglingSession({} as never);
      session.load('/tmp/nested.json');
      session.apply(type, params);
      const result = await connection.run(
        session.getSql().replace(/\bcurrent_data\b/g, 'nested_data'),
      );
      return { columns: result.columnNames(), rows: await result.getRowsJson() };
    } finally {
      connection.closeSync();
    }
  }

  it('extracts a nested scalar while preserving the source column', async () => {
    const result = await runNested('extract_nested', {
      column: 'metadata',
      path: ['source', 'name'],
      name: 'source_name',
    });
    expect(result.columns).toContain('source_name');
    expect(result.rows[0].at(-1)).toBe('sensor');
  });

  it('flattens a struct into fields', async () => {
    const result = await runNested('flatten_nested', { column: 'metadata', path: [] });
    expect(result.columns).toEqual(expect.arrayContaining(['source', 'version']));
  });

  it('explodes a list into one row per item', async () => {
    const result = await runNested('explode_nested', { column: 'events', path: [], name: 'event' });
    expect(result.rows).toHaveLength(2);
    expect(result.columns).toContain('event');
  });

  it('extracts map values and explodes maps into key/value entries', async () => {
    const extracted = await runNested('extract_nested', {
      column: 'labels',
      path: ['source'],
      accessors: ['map'],
      name: 'label_source',
    });
    expect(extracted.rows[0].at(-1)).toBe('official');

    const exploded = await runNested('explode_nested', {
      column: 'labels',
      path: [],
      accessors: [],
      containerKind: 'map',
      name: 'label',
    });
    expect(exploded.rows).toHaveLength(2);
  });
});

describe('custom query results execute in DuckDB', () => {
  it('runs a read-only query against current_data and returns its result', async () => {
    const sql = normalizeReadOnlyQuery(`
      SELECT region, SUM(amount) AS total
      FROM current_data
      GROUP BY region
      ORDER BY region
    `);
    const connection = await database.connect();
    try {
      const result = await connection.run(`SELECT * FROM (${sql}) AS custom_query LIMIT 100`);
      expect(await result.getRowsJson()).toEqual([
        ['east', 40],
        ['west', 20],
      ]);
    } finally {
      connection.closeSync();
    }
  });
});

describe('global cell search', () => {
  it('searches every column and paginates matching rows', async () => {
    const session = new WranglingSession(createAdapter() as never);
    session.load('/tmp/data.csv');

    const searched = await session.search('alpha', 0, 100);

    expect(searched.page.totalRows).toBe(2);
    expect(searched.result.rows).toHaveLength(2);
  });
});

describe('visualization and quality queries', () => {
  it.each([
    [{ type: 'histogram', xColumn: 'amount' }, 3],
    [{ type: 'bar', xColumn: 'region', aggregation: 'COUNT' }, 2],
    [{ type: 'scatter', xColumn: 'id', yColumn: 'amount' }, 3],
    [{ type: 'line', xColumn: 'id', yColumn: 'amount' }, 3],
    [{ type: 'box', xColumn: 'amount' }, 1],
    [{ type: 'correlation', xColumn: 'id', columns: ['id', 'amount'] }, 3],
  ] as const)('builds chart data for %s', async (chart, minimumRows) => {
    const session = new WranglingSession(createAdapter() as never);
    session.load('/tmp/data.csv');

    const result = await session.getChartData(chart);

    expect(result.rows.length).toBeGreaterThanOrEqual(minimumRows);
  });

  it('reports nulls and exposes numeric percentiles', async () => {
    const session = new WranglingSession(createAdapter() as never);
    session.load('/tmp/data.csv');

    const stats = await session.getStatistics();
    const quality = await session.getQualitySummary(stats);
    const amount = stats.find((column) => column.name === 'amount');

    expect(amount?.p50).toBe(20);
    expect(amount?.p90).toBeGreaterThan(20);
    expect(
      quality.issues.some((issue) => issue.kind === 'nulls' && issue.column === 'nullable'),
    ).toBe(true);
  });
});
