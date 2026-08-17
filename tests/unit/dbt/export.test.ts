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

  it('rejects histories containing join_file or union_file as non-portable', () => {
    const joinHistory: TransformOperation[] = [
      {
        id: '2',
        type: 'join_file',
        params: { filePath: '/local/other.csv', leftColumn: 'id', rightColumn: 'id', joinType: 'INNER' },
        sql: '',
        description: 'Join',
      },
    ];
    const unionHistory: TransformOperation[] = [
      {
        id: '3',
        type: 'union_file',
        params: { filePath: '/local/other.csv' },
        sql: '',
        description: 'Union',
      },
    ];
    expect(() => buildDbtSql(joinHistory, 'stg_orders', 'model')).toThrow(
      "join_file",
    );
    expect(() => buildDbtSql(unionHistory, 'stg_orders', 'cte')).toThrow(
      "union_file",
    );
  });

  it.each(['add_column', 'addColumn'])('rejects raw %s expressions as non-portable', (type) => {
    expect(() =>
      buildDbtSql(
        [
          {
            id: 'raw-expression',
            type,
            params: { name: 'unsafe', expression: 'adapter_specific(value)' },
            sql: 'SELECT *, adapter_specific(value) AS "unsafe" FROM current_data',
            description: 'Raw expression',
          },
        ],
        'stg_orders',
        'model',
      ),
    ).toThrow('Formula Builder');
  });
});
