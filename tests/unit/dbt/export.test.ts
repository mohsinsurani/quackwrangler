import { describe, expect, it } from 'vitest';

import { buildDbtSql } from '../../../src/dbt/export';
import { TransformOperation } from '../../../src/types';

const history: TransformOperation[] = [
  {
    id: '1',
    type: 'filter_rows',
    params: {},
    sql: 'SELECT * FROM current_data WHERE "amount" > 10',
    description: 'Filter amount',
  },
];

describe('dbt SQL export', () => {
  it('generates a complete model using ref() and the executed transform pipeline', () => {
    const sql = buildDbtSql(history, 'stg_orders', 'model');

    expect(sql).toContain("{{ ref('stg_orders') }}");
    expect(sql).toContain('FROM source_data WHERE "amount" > 10');
    expect(sql).toMatch(/^WITH source_data AS/);
    expect(sql).toMatch(/SELECT \* FROM quackwrangler_result$/);
  });

  it('generates a CTE snippet and rejects unsafe model names', () => {
    expect(buildDbtSql([], 'stg_orders', 'cte')).toMatch(/^source_data AS/);
    expect(() => buildDbtSql([], "orders') }}; DROP TABLE x; --", 'model')).toThrow(
      'dbt model names',
    );
  });
});
