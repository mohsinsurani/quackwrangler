import { describe, expect, it, vi } from 'vitest';
import { buildPipelineSQL, WranglingSession } from '../../../src/transforms/pipeline';
import { DuckDBInstance } from '@duckdb/node-api';

describe('WranglingSession', () => {
  it('calculates ten real histogram bins in DuckDB statistics', async () => {
    const database = await DuckDBInstance.create(':memory:');
    const connection = await database.connect();
    const session = new WranglingSession({
      query: async (sql: string) => {
        const result = await connection.run(sql);
        const rows = await result.getRowsJson();
        return { columns: result.columnNames(), rows, rowCount: rows.length, duration: 0 };
      },
    } as never);
    try {
      await connection.run(
        'CREATE TABLE histogram_fixture AS SELECT i::DOUBLE AS amount FROM range(100) AS t(i)',
      );
      session.load('/tmp/histogram_fixture.parquet');
      // This session relation normally comes from a prepared source view; bind the
      // test fixture under the session's relation name before collecting stats.
      await connection.run('CREATE VIEW current_data AS SELECT * FROM histogram_fixture');
      const [profile] = await session.getStatistics();
      expect(profile.histogram).toHaveLength(10);
      expect(profile.histogram?.reduce((sum, count) => sum + count, 0)).toBe(100);
    } finally {
      connection.closeSync();
    }
  });
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
    expect(session.canUndo()).toBe(true);
    expect(session.canRedo()).toBe(false);
    session.undo();
    expect(session.getHistory()).toHaveLength(0);
    expect(session.canUndo()).toBe(false);
    expect(session.canRedo()).toBe(true);
    session.redo();
    expect(session.getHistory()).toHaveLength(1);
    expect(session.canUndo()).toBe(true);
    expect(session.canRedo()).toBe(false);
    session.remove(step.id);
    expect(session.getHistory()).toHaveLength(0);
  });

  it('returns a direct source query for an empty pipeline', () => {
    expect(buildPipelineSQL([])).toBe('SELECT * FROM current_data');
  });

  it('caches page schema and row count until the pipeline changes', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.startsWith('DESCRIBE')) return { rows: [['id', 'BIGINT', 'NO']] };
      if (sql.startsWith('SELECT COUNT')) return { rows: [[2]] };
      return { columns: ['id'], rows: [[1]], rowCount: 1, duration: 0 };
    });
    const session = new WranglingSession({ query } as never);
    session.load('/tmp/data.csv');
    await session.getPage(0, 100);
    await session.getPage(100, 100);
    expect(query.mock.calls.filter(([sql]) => String(sql).startsWith('DESCRIBE'))).toHaveLength(1);
    expect(query.mock.calls.filter(([sql]) => String(sql).startsWith('SELECT COUNT'))).toHaveLength(
      1,
    );
    session.apply('drop_column', { column: 'unused' });
    await session.getPage(0, 100);
    expect(query.mock.calls.filter(([sql]) => String(sql).startsWith('DESCRIBE'))).toHaveLength(2);
  });

  it('caches statistics and combines search rows with their total count', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [['name', 'VARCHAR', 'YES']] })
      .mockResolvedValueOnce({ rows: [[0, 2, 'alpha', 'omega']] })
      .mockResolvedValueOnce({
        columns: ['name', '__qw_total_rows'],
        rows: [['alpha', 2]],
        rowCount: 1,
      });
    const session = new WranglingSession({ query } as never);
    session.load('/tmp/data.csv');
    const first = await session.getStatistics();
    expect(await session.getStatistics()).toBe(first);
    const searched = await session.search('alpha', 0, 100);
    expect(searched.page.totalRows).toBe(2);
    expect(searched.result).toMatchObject({ columns: ['name'], rows: [['alpha']], rowCount: 1 });
    expect(query).toHaveBeenCalledTimes(3);
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
      .mockResolvedValueOnce({
        rows: [[1, 5, 2, 12, 7, 3, 6, 8, [2, 2, 2, 2, 2, 2, 2, 2, 2, 2]]],
      });
    const session = new WranglingSession({ query } as any);
    session.load('/tmp/data.json');

    const [profile] = await session.getStatistics();
    const statsSql = query.mock.calls[1][0] as string;

    expect(statsSql).toContain('AVG("amount")');
    expect(profile).toMatchObject({
      min: 2,
      max: 12,
      mean: 7,
      p50: 3,
      p90: 6,
      p99: 8,
      histogram: [2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
    });
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
    [
      'sort_rows',
      {
        keys: [
          { column: 'region', direction: 'ASC' },
          { column: 'price', direction: 'DESC' },
        ],
      },
      'ORDER BY "region" ASC, "price" DESC',
    ],
    ['drop_column', { columns: ['a', 'b'] }, 'EXCLUDE ("a", "b")'],
    ['drop_column', { columns: ['a', 'b', 'a'] }, 'EXCLUDE ("a", "b")'],
    ['deduplicate', { columns: ['k1', 'k2', 'k1'] }, 'PARTITION BY "k1", "k2")'],
    ['deduplicate', { columns: [] }, 'SELECT DISTINCT * FROM current_data'],
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

  it('restores a saved workspace by rebuilding its transforms', () => {
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
  it('preserves active history and redo state when candidate restore validation fails', async () => {
    let fail = false;
    const query = vi.fn(async (sql: string) => {
      if (sql.startsWith('DESCRIBE')) return { rows: [['id', 'BIGINT', 'NO']] };
      if (fail) throw new Error('Binder Error: missing column');
      return { columns: ['id'], rows: [[1]], rowCount: 1, duration: 0 };
    });
    const session = new WranglingSession({ query } as never);
    session.load('/tmp/data.csv');
    session.apply('sort_rows', { column: 'id', direction: 'ASC' });
    session.apply('filter_rows', { condition: 'id > 0' });
    session.undo();
    const priorHistory = session.getHistory();
    const priorSql = session.getSql();
    const priorRevision = session.getRevision();
    const priorCanRedo = session.canRedo();
    fail = true;
    await expect(
      session.restoreValidated([
        { type: 'filter_rows', params: { column: 'missing_column', operator: 'is_null' } },
      ]),
    ).rejects.toThrow('missing column');
    expect(session.getHistory()).toEqual(priorHistory);
    expect(session.getSql()).toBe(priorSql);
    expect(session.getRevision()).toBe(priorRevision);
    expect(session.canRedo()).toBe(priorCanRedo);
  });

  it('does not retain failed apply steps after query validation fails', async () => {
    let fail = false;
    const query = vi.fn(async (sql: string) => {
      if (sql.startsWith('DESCRIBE')) return { rows: [['id', 'BIGINT', 'NO']] };
      if (fail) throw new Error('query validation failed');
      return { columns: ['id'], rows: [[1]], rowCount: 1, duration: 0 };
    });
    const session = new WranglingSession({ query } as never);
    session.load('/tmp/data.csv');
    session.apply('sort_rows', { column: 'id', direction: 'ASC' });
    const priorHistory = session.getHistory();
    const priorRevision = session.getRevision();
    fail = true;
    await expect(session.applyValidated('filter_rows', { condition: 'id > 0' })).rejects.toThrow(
      'query validation failed',
    );
    expect(session.getHistory()).toEqual(priorHistory);
    expect(session.getRevision()).toBe(priorRevision);
    expect(session.canRedo()).toBe(false);
  });

  it('does not let an older slow validation overwrite a newer mutation', async () => {
    let releaseSlow!: () => void;
    let slowStarted!: () => void;
    const slowQuery = new Promise<void>((resolve) => {
      releaseSlow = resolve;
    });
    const started = new Promise<void>((resolve) => {
      slowStarted = resolve;
    });
    const query = vi.fn(async (sql: string) => {
      if (sql.startsWith('DESCRIBE')) return { rows: [['id', 'BIGINT', 'NO']] };
      if (sql.includes('older_slow_marker')) {
        slowStarted();
        await slowQuery;
      }
      return { columns: ['id'], rows: [[1]], rowCount: 1, duration: 0 };
    });
    const session = new WranglingSession({ query } as never);
    session.load('/tmp/data.csv');
    const staleMutation = session.applyValidated('add_column', {
      name: 'older_slow_marker',
      expression: '1',
    });
    await started;
    await session.applyValidated('add_column', { name: 'newer_marker', expression: '2' });
    releaseSlow();
    await expect(staleMutation).rejects.toThrow(
      'pipeline changed while a history update was validating',
    );
    expect(session.getHistory().map((step) => step.params.name)).toEqual(['newer_marker']);
    expect(session.canUndo()).toBe(true);
  });

  it('resolves fill types from preceding candidate recipe steps', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.startsWith('DESCRIBE') && sql.includes('RENAME'))
        return { rows: [['new_name', 'VARCHAR', 'YES']] };
      if (sql.startsWith('DESCRIBE')) return { rows: [['old_name', 'VARCHAR', 'YES']] };
      return { columns: ['new_name'], rows: [[1]], rowCount: 1, duration: 0 };
    });
    const session = new WranglingSession({ query } as never);
    session.load('/tmp/data.parquet');
    await session.restoreValidated([
      { type: 'rename_column', params: { oldName: 'old_name', newName: 'new_name' } },
      { type: 'fill_nulls', params: { column: 'new_name', value: 'Unknown' } },
    ]);
    expect(session.getHistory()[1].params.targetType).toBe('VARCHAR');
  });

  it('validates the column type before adding a fill step', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.startsWith('DESCRIBE')) return { rows: [['amount', 'INTEGER', 'YES']] };
      if (sql.includes("'bad'") && sql.includes('INTEGER')) throw new Error('Conversion Error');
      if (sql.startsWith('SELECT COUNT')) return { rows: [[1]] };
      return { columns: ['amount'], rows: [[null]], rowCount: 1, duration: 0 };
    });
    const session = new WranglingSession({ query } as never);
    session.load('/tmp/data.csv');
    await expect(
      session.applyValidated('fill_nulls', { column: 'amount', value: 'bad' }),
    ).rejects.toThrow('Conversion Error');
    expect(session.getHistory()).toHaveLength(0);
  });
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

  it('accepts numeric, boolean, and string values for fill_nulls', () => {
    const session = new WranglingSession({} as never);
    session.load('/tmp/data.csv');
    session.apply('fill_nulls', { column: 'amount', value: 0 });
    expect(session.getSql()).toContain('COALESCE("amount", 0)');
    const session2 = new WranglingSession({} as never);
    session2.load('/tmp/data.csv');
    session2.apply('fill_nulls', { column: 'active', value: false });
    expect(session2.getSql()).toContain('COALESCE("active", false)');
    const session3 = new WranglingSession({} as never);
    session3.load('/tmp/data.csv');
    session3.apply('fill_nulls', { column: 'name', value: 'N/A' });
    expect(session3.getSql()).toContain('COALESCE("name", \'N/A\')');
  });

  it('uses a custom relation name as the pipeline source', () => {
    const session = new WranglingSession({} as never, 'qw_abc123');
    session.load('/tmp/data.csv');
    expect(session.getSql()).toBe('SELECT * FROM qw_abc123');
    session.apply('sort_rows', { column: 'id', direction: 'ASC' });
    expect(session.getSql()).toContain('FROM qw_abc123 ORDER BY "id" ASC');
  });

  it('exposes a monotonically increasing revision after each mutation', () => {
    const session = new WranglingSession({} as never);
    session.load('/tmp/data.csv');
    const r0 = session.getRevision();
    session.apply('sort_rows', { column: 'id', direction: 'ASC' });
    const r1 = session.getRevision();
    expect(r1).toBeGreaterThan(r0);
    session.undo();
    const r2 = session.getRevision();
    expect(r2).toBeGreaterThan(r1);
    session.redo();
    expect(session.getRevision()).toBeGreaterThan(r2);
  });

  it('does not cache stale results when the revision changes during a query', async () => {
    let resolveDescribe!: (value: unknown) => void;
    const describePromise = new Promise((r) => (resolveDescribe = r));
    const query = vi.fn(async (sql: string) => {
      if (sql.startsWith('DESCRIBE')) return describePromise;
      if (sql.startsWith('SELECT COUNT')) return { rows: [[3]] };
      return { columns: [], rows: [], rowCount: 0, duration: 0 };
    });
    const session = new WranglingSession({ query } as never);
    session.load('/tmp/data.csv');

    // Start a page request that will block on DESCRIBE.
    const pagePromise = session.getPage(0, 100);
    // Mutate the pipeline while DESCRIBE is still in-flight.
    session.apply('sort_rows', { column: 'id', direction: 'ASC' });
    // Now resolve the old DESCRIBE result.
    resolveDescribe({ rows: [['id', 'BIGINT', 'NO']] });
    await pagePromise;

    // The stale DESCRIBE result must not have been cached for the new revision.
    query.mockClear();
    query.mockResolvedValue({ rows: [['name', 'VARCHAR', 'YES']] });
    await session.getPage(0, 100);
    const describeCalls = query.mock.calls.filter(([sql]) => String(sql).startsWith('DESCRIBE'));
    expect(describeCalls).toHaveLength(1);
  });

  describe('multi-column sorting', () => {
    const session = (): WranglingSession => {
      const created = new WranglingSession({} as never);
      created.load('/tmp/data.csv');
      return created;
    };

    it('still reads the single-column form saved by earlier versions', () => {
      const target = session();
      target.apply('sort_rows', { column: 'amount', direction: 'DESC' });
      expect(target.getSql()).toContain('ORDER BY "amount" DESC');
      const ascending = session();
      ascending.apply('sort_rows', { column: 'amount', ascending: true });
      expect(ascending.getSql()).toContain('ORDER BY "amount" ASC');
    });

    it('quotes every key', () => {
      const target = session();
      target.apply('sort_rows', { keys: [{ column: 'we"ird', direction: 'DESC' }] });
      expect(target.getSql()).toContain('ORDER BY "we""ird" DESC');
    });

    it.each([
      ['an empty list', { keys: [] }, /column is required/],
      ['a key without a column', { keys: [{ direction: 'ASC' }] }, /needs a column/],
      [
        'the same column twice',
        {
          keys: [
            { column: 'a', direction: 'ASC' },
            { column: 'a', direction: 'DESC' },
          ],
        },
        /used twice/,
      ],
    ])('rejects %s', (_label, params, message) => {
      expect(() => session().apply('sort_rows', params as Record<string, unknown>)).toThrow(
        message,
      );
    });

    it('describes the keys readably instead of printing objects', () => {
      const target = session();
      target.apply('sort_rows', {
        keys: [
          { column: 'region', direction: 'ASC' },
          { column: 'price', direction: 'DESC' },
        ],
      });
      expect(target.getHistory()[0].description).toBe('sort rows: region asc, price desc');
      expect(target.getHistory()[0].description).not.toContain('[object Object]');
    });
  });
});
