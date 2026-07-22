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

  it('supports undo, redo, reset, and removal', () => {
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
    session.apply('filter_rows', { condition: 'id > 0' });
    session.reset();
    expect(session.getHistory()).toHaveLength(0);
  });

  it('returns a direct source query for an empty pipeline', () => {
    expect(buildPipelineSQL([])).toBe('SELECT * FROM current_data');
  });

  it('rejects unsupported cast types', () => {
    const session = new WranglingSession({} as any);
    expect(() => session.apply('cast_type', { column: 'x', targetType: 'DROP TABLE' })).toThrow('Unsupported target type');
  });

  it('does not apply numeric aggregates to nested JSON columns', async () => {
    const nestedType = 'STRUCT(distance STRUCT("type" VARCHAR, "value" DOUBLE), metadata MAP(VARCHAR, JSON))[]';
    const query = vi.fn()
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
    const query = vi.fn()
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
    ['in', { value: 'new, active' }, '"status" IN (\'new\', \'active\')'],
    ['not_in', { value: 'closed, deleted' }, '"status" NOT IN (\'closed\', \'deleted\')'],
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
    session.apply('filter_rows', { column: 'customer"name', operator: 'equals', value: "O'Reilly" });
    expect(session.getSql()).toContain('"customer""name" = \'O\'\'Reilly\'');
  });

  it.each([
    ['drop_column', { column: 'secret' }, 'EXCLUDE ("secret")'],
    ['rename_column', { oldName: 'old', newName: 'new' }, 'RENAME ("old" AS "new")'],
    ['add_column', { name: 'total', expression: 'price * quantity' }, '(price * quantity) AS "total"'],
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
    session.apply('aggregate', { function: 'SUM', column: 'amount', groupBy: 'region', alias: 'revenue' });
    expect(session.getSql()).toContain('SELECT "region", SUM("amount") AS "revenue"');
    expect(session.getSql()).toContain('GROUP BY "region"');
  });
});
