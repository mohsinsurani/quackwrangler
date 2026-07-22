import { beforeAll, describe, expect, it } from 'vitest';
import { DuckDBInstance } from '@duckdb/node-api';
import { WranglingSession } from '../../src/transforms/pipeline';
import { normalizeReadOnlyQuery } from '../../src/duckdb/query-engine';
import { generateDuckDBPython, generateDuckDBSQL, generatePolarsPython } from '../../src/transforms/codegen';

let database: DuckDBInstance;

function generateAllCode(session: WranglingSession): void {
  const history = session.getHistory();
  generateDuckDBSQL(history, session.getFilePath());
  generateDuckDBPython(history, session.getFilePath());
  generatePolarsPython(history, session.getFilePath());
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
    expect((await runPipeline('filter_rows', { column, operator, ...values })).length).toBeGreaterThan(0);
  });

  it.each([
    ['greater_than', { value: 10 }],
    ['greater_equals', { value: 20 }],
    ['less_than', { value: 30 }],
    ['less_equals', { value: 20 }],
    ['between', { value: 10, value2: 20 }],
  ])('%s', async (operator, values) => {
    expect((await runPipeline('filter_rows', { column: 'amount', operator, ...values })).length).toBeGreaterThan(0);
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
      expect(() => generateAllCode(session)).not.toThrow();
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
    expect(await runPipeline('aggregate', { function: fn, alias: 'result', ...values })).toHaveLength(1);
  });

  it('groups aggregate results', async () => {
    expect(await runPipeline('aggregate', {
      function: 'SUM', column: 'amount', groupBy: 'region', alias: 'total',
    })).toHaveLength(2);
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
