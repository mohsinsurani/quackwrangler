import { beforeAll, describe, expect, it } from 'vitest';
import { DuckDBInstance } from '@duckdb/node-api';
import { WranglingSession } from '../../src/transforms/pipeline';
import { normalizeReadOnlyQuery } from '../../src/duckdb/query-engine';

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
