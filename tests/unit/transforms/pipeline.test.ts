import { describe, expect, it, vi } from 'vitest';
import { buildPipelineSQL, WranglingSession } from '../../../src/transforms/pipeline';

describe('WranglingSession', () => {
  it('chains transforms through immutable CTE steps', () => {
    const session = new WranglingSession({} as any);
    session.load('/tmp/data.csv');
    session.apply('filter_rows', { condition: 'amount > 100' });
    session.apply('sort_rows', { column: 'amount', direction: 'DESC' });

    expect(session.getSql()).toContain('step_1 AS');
    expect(session.getSql()).toContain('FROM step_1 ORDER BY "amount" DESC');
  });

  it('supports undo, redo, and removal', () => {
    const session = new WranglingSession({} as any);
    session.load('/tmp/data.csv');
    session.apply('drop_column', { column: 'secret' });
    const [step] = session.getHistory();
    session.undo();
    expect(session.getHistory()).toHaveLength(0);
    session.redo();
    expect(session.getHistory()).toHaveLength(1);
    session.remove(step.id);
    expect(session.getHistory()).toHaveLength(0);
  });

  it('returns a direct source query for an empty pipeline', () => {
    expect(buildPipelineSQL([])).toBe('SELECT * FROM current_data');
  });

  it('rejects unsupported cast types', () => {
    const session = new WranglingSession({} as any);
    expect(() => session.apply('cast_type', { column: 'x', targetType: 'DROP TABLE' })).toThrow(
      'Unsupported target type',
    );
  });

  it('does not apply numeric aggregates to nested JSON columns', async () => {
    const nestedType =
      'STRUCT(distance STRUCT("type" VARCHAR, "value" DOUBLE), metadata MAP(VARCHAR, JSON))[]';
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [['DistanceRecord', nestedType, 'YES']] })
      .mockResolvedValueOnce({ rows: [[2, 8]] });
    const session = new WranglingSession({ query } as any);
    session.load('/tmp/data.json');

    const [profile] = await session.getStatistics();
    const statsSql = query.mock.calls[1][0] as string;

    expect(statsSql).not.toContain('AVG(');
    expect(statsSql).not.toContain('MIN(');
    expect(statsSql).not.toContain('MAX(');
    expect(profile).toMatchObject({
      name: 'DistanceRecord',
      nullCount: 2,
      distinctCount: 8,
      mean: undefined,
    });
  });

  it('keeps full numeric profiling for scalar decimal columns', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [['amount', 'DECIMAL(12,2)', 'YES']] })
      .mockResolvedValueOnce({ rows: [[1, 5, 2, 12, 7]] });
    const session = new WranglingSession({ query } as any);
    session.load('/tmp/data.json');

    const [profile] = await session.getStatistics();
    const statsSql = query.mock.calls[1][0] as string;

    expect(statsSql).toContain('AVG("amount")');
    expect(profile).toMatchObject({ min: 2, max: 12, mean: 7 });
  });

  it.each([
    ['equals', { value: 'active' }, '"status" = \'active\''],
    ['not_equals', { value: 'inactive' }, '"status" <> \'inactive\''],
    ['contains', { value: 'lab' }, 'CAST("status" AS VARCHAR) ILIKE \'%lab%\''],
    ['not_contains', { value: 'test' }, 'CAST("status" AS VARCHAR) NOT ILIKE \'%test%\''],
    ['starts_with', { value: 'pre' }, 'CAST("status" AS VARCHAR) ILIKE \'pre%\''],
    ['ends_with', { value: 'fix' }, 'CAST("status" AS VARCHAR) ILIKE \'%fix\''],
    ['greater_than', { value: '10' }, '"status" > 10'],
    ['greater_equals', { value: '10' }, '"status" >= 10'],
    ['less_than', { value: '20' }, '"status" < 20'],
    ['less_equals', { value: '20' }, '"status" <= 20'],
    ['between', { value: '10', value2: '20' }, '"status" BETWEEN 10 AND 20'],
    ['in', { value: 'new, active' }, "\"status\" IN ('new', 'active')"],
    ['not_in', { value: 'closed, deleted' }, "\"status\" NOT IN ('closed', 'deleted')"],
    ['is_null', {}, '"status" IS NULL'],
    ['is_not_null', {}, '"status" IS NOT NULL'],
  ])('builds the %s filter operator', (operator, values, expected) => {
    const session = new WranglingSession({} as any);
    session.load('/tmp/data.csv');
    session.apply('filter_rows', { column: 'status', operator, ...values });
    expect(session.getSql()).toContain(expected);
  });

  it('escapes filter values and column identifiers', () => {
    const session = new WranglingSession({} as any);
    session.load('/tmp/data.csv');
    session.apply('filter_rows', {
      column: 'customer"name',
      operator: 'equals',
      value: "O'Reilly",
    });
    expect(session.getSql()).toContain('"customer""name" = \'O\'\'Reilly\'');
  });

  it.each([
    ['drop_column', { column: 'secret' }, 'EXCLUDE ("secret")'],
    ['rename_column', { oldName: 'old', newName: 'new' }, 'RENAME ("old" AS "new")'],
    [
      'add_column',
      { name: 'total', expression: 'price * quantity' },
      '(price * quantity) AS "total"',
    ],
    ['cast_type', { column: 'amount', targetType: 'DOUBLE' }, 'TRY_CAST("amount" AS DOUBLE)'],
    ['fill_nulls', { column: 'name', value: 'unknown' }, 'COALESCE("name", \'unknown\')'],
    ['sort_rows', { column: 'amount', direction: 'DESC' }, 'ORDER BY "amount" DESC'],
    ['deduplicate', { columns: ['id'] }, 'PARTITION BY "id"'],
  ])('executes displayed transform %s', (type, params, expected) => {
    const session = new WranglingSession({} as any);
    session.load('/tmp/data.csv');
    session.apply(type, params);
    expect(session.getSql()).toContain(expected);
  });

  it.each([
    ['COUNT', {}, 'COUNT(*) AS "count_rows"'],
    ['COUNT_DISTINCT', { column: 'user_id' }, 'COUNT(DISTINCT "user_id")'],
    ['SUM', { column: 'amount' }, 'SUM("amount")'],
    ['AVG', { column: 'amount' }, 'AVG("amount")'],
    ['MIN', { column: 'amount' }, 'MIN("amount")'],
    ['MAX', { column: 'amount' }, 'MAX("amount")'],
  ])('executes displayed aggregate %s', (fn, extra, expected) => {
    const session = new WranglingSession({} as any);
    session.load('/tmp/data.csv');
    session.apply('aggregate', { function: fn, groupBy: '', alias: '', ...extra });
    expect(session.getSql()).toContain(expected);
  });

  it('groups aggregate results and applies a custom alias', () => {
    const session = new WranglingSession({} as any);
    session.load('/tmp/data.csv');
    session.apply('aggregate', {
      function: 'SUM',
      column: 'amount',
      groupBy: 'region',
      alias: 'revenue',
    });
    expect(session.getSql()).toContain('SELECT "region", SUM("amount") AS "revenue"');
    expect(session.getSql()).toContain('GROUP BY "region"');
  });

  it.each([
    [
      {
        name: 'segment',
        formula: 'if',
        column: 'amount',
        operator: 'greater_than',
        compareValue: '100',
        trueValue: 'high',
        falseValue: 'standard',
      },
      `CASE WHEN "amount" > 100 THEN 'high' ELSE 'standard' END`,
    ],
    [
      {
        name: 'age_days',
        formula: 'date_diff',
        column: 'created_at',
        secondColumn: 'closed_at',
        unit: 'day',
      },
      `date_diff('day', "created_at", "closed_at")`,
    ],
    [
      { name: 'code', formula: 'regex_extract', column: 'label', pattern: '[A-Z]+' },
      `regexp_extract(CAST("label" AS VARCHAR), '[A-Z]+')`,
    ],
    [
      {
        name: 'full_name',
        formula: 'concat',
        column: 'first_name',
        secondColumn: 'last_name',
        separator: ' ',
      },
      `concat_ws(' ', "first_name", "last_name")`,
    ],
  ])('builds safe visual formulas', (params, expected) => {
    const session = new WranglingSession({} as any);
    session.load('/tmp/data.csv');
    session.apply('formula_column', params);
    expect(session.getSql()).toContain(expected);
  });

  it('rejects unsupported formula operations', () => {
    const session = new WranglingSession({} as any);
    session.load('/tmp/data.csv');
    expect(() =>
      session.apply('formula_column', {
        name: 'bad',
        formula: 'raw_sql',
        column: 'value',
      }),
    ).toThrow('Unsupported formula');
  });

  it('builds validated nested extract, flatten, and explode transforms', () => {
    const extract = new WranglingSession({} as any);
    extract.load('/tmp/nested.json');
    extract.apply('extract_nested', {
      column: 'metadata',
      path: ['source', 'id'],
      name: 'source_id',
    });
    expect(extract.getSql()).toContain(
      `struct_extract(struct_extract("metadata", 'source'), 'id') AS "source_id"`,
    );

    const flatten = new WranglingSession({} as any);
    flatten.load('/tmp/nested.json');
    flatten.apply('flatten_nested', { column: 'metadata', path: [] });
    expect(flatten.getSql()).toContain('unnest("metadata")');

    const explode = new WranglingSession({} as any);
    explode.load('/tmp/nested.json');
    explode.apply('explode_nested', { column: 'records', path: '/0/values', name: 'value' });
    expect(explode.getSql()).toContain(
      `unnest(struct_extract(list_extract("records", 1), 'values')) AS "value"`,
    );

    const map = new WranglingSession({} as any);
    map.load('/tmp/nested.json');
    map.apply('extract_nested', {
      column: 'labels',
      path: ['source'],
      accessors: ['map'],
      name: 'source',
    });
    expect(map.getSql()).toContain(`map_extract_value("labels", 'source') AS "source"`);
  });

  it('rejects invalid nested paths', () => {
    const session = new WranglingSession({} as any);
    session.load('/tmp/nested.json');
    expect(() =>
      session.apply('extract_nested', { column: 'metadata', path: [], name: 'copy' }),
    ).toThrow('nested path is required');
    expect(() => session.apply('flatten_nested', { column: 'metadata', path: [null] })).toThrow(
      'invalid segment',
    );
  });

  it('joins another supported file with a selected join type and keys', () => {
    const session = new WranglingSession({} as any);
    session.load('/tmp/orders.csv');
    session.apply('join_file', {
      filePath: "/tmp/customer's.csv",
      joinType: 'LEFT',
      leftColumn: 'customer_id',
      rightColumn: 'id',
    });
    expect(session.getSql()).toContain("LEFT JOIN read_csv_auto('/tmp/customer''s.csv')");
    expect(session.getSql()).toContain('left_data."customer_id" = right_data."id"');
  });

  it('unions another supported file by matching column names', () => {
    const session = new WranglingSession({} as any);
    session.load('/tmp/january.parquet');
    session.apply('union_file', { filePath: '/tmp/february.parquet' });
    expect(session.getSql()).toContain(
      "UNION ALL BY NAME SELECT * FROM read_parquet('/tmp/february.parquet')",
    );
  });

  it('restores a saved workspace by validating and rebuilding its transforms', () => {
    const session = new WranglingSession({} as any);
    session.load('/tmp/data.csv');
    session.restore([
      { type: 'filter_rows', params: { column: 'active', operator: 'equals', value: true } },
      { type: 'sort_rows', params: { column: 'name', direction: 'ASC' } },
    ]);
    expect(session.getHistory().map((step) => step.type)).toEqual(['filter_rows', 'sort_rows']);
    expect(session.getSql()).toContain('"active" = true');
    expect(session.getSql()).toContain('ORDER BY "name" ASC');
  });
});

describe('pipeline ordering and reshape transforms', () => {
  it('reorders steps and regenerates pipeline order', () => {
    const session = new WranglingSession({} as never);
    session.load('/tmp/data.csv');
    session.apply('filter_rows', { condition: 'amount > 10' });
    session.apply('sort_rows', { column: 'amount', direction: 'DESC' });
    const [filter, sort] = session.getHistory();

    session.reorder(sort.id, filter.id);

    expect(session.getHistory().map((step) => step.type)).toEqual(['sort_rows', 'filter_rows']);
    expect(session.getSql().indexOf('ORDER BY')).toBeLessThan(session.getSql().indexOf('WHERE'));

    session.reorder(sort.id, filter.id);
    expect(session.getHistory().map((step) => step.type)).toEqual(['filter_rows', 'sort_rows']);
  });

  it('generates executable pivot and unpivot SQL', () => {
    const pivot = new WranglingSession({} as never);
    pivot.load('/tmp/data.csv');
    pivot.apply('pivot', { index: 'name', column: 'region', value: 'amount', aggregate: 'SUM' });
    expect(pivot.getSql()).toContain('PIVOT current_data ON "region" USING SUM("amount")');

    const unpivot = new WranglingSession({} as never);
    unpivot.load('/tmp/data.csv');
    unpivot.apply('unpivot', {
      columns: 'id, amount',
      nameColumn: 'metric',
      valueColumn: 'metric_value',
    });
    expect(unpivot.getSql()).toContain('UNPIVOT current_data ON "id", "amount"');
  });
});
