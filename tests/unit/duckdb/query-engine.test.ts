import { describe, expect, it, vi } from 'vitest';
import { exportResults, normalizeReadOnlyQuery } from '../../../src/duckdb/query-engine.js';
import type { DuckDBConnection } from '../../../src/duckdb/connection.js';

describe('exportResults', () => {
  it.each([
    ['parquet', "COPY (SELECT * FROM current_data) TO '/tmp/result.parquet' (FORMAT PARQUET)"],
    ['csv', "COPY (SELECT * FROM current_data) TO '/tmp/result.csv' (FORMAT CSV, HEADER)"],
    ['json', "COPY (SELECT * FROM current_data) TO '/tmp/result.json' (FORMAT JSON)"],
  ] as const)('exports transformed data as %s', async (format, expectedSql) => {
    const query = vi.fn().mockResolvedValue({ columns: [], rows: [], rowCount: 0, duration: 0 });
    const connection = { query } as unknown as DuckDBConnection;

    await exportResults(connection, 'SELECT * FROM current_data;', `/tmp/result.${format}`, format);

    expect(query).toHaveBeenCalledOnce();
    expect(query).toHaveBeenCalledWith(expectedSql);
  });

  it('escapes apostrophes in the destination path', async () => {
    const query = vi.fn().mockResolvedValue({ columns: [], rows: [], rowCount: 0, duration: 0 });
    const connection = { query } as unknown as DuckDBConnection;

    await exportResults(connection, 'SELECT 1', "/tmp/user's result.csv", 'csv');

    expect(query).toHaveBeenCalledWith(
      "COPY (SELECT 1) TO '/tmp/user''s result.csv' (FORMAT CSV, HEADER)",
    );
  });
});

describe('normalizeReadOnlyQuery', () => {
  it.each([
    'SELECT * FROM current_data;',
    'WITH filtered AS (SELECT * FROM current_data) SELECT * FROM filtered',
    'VALUES (1), (2)',
    '-- inspect rows\nSELECT COUNT(*) FROM current_data',
  ])('accepts read-only query: %s', sql => {
    expect(normalizeReadOnlyQuery(sql)).not.toMatch(/;$/);
  });

  it.each([
    'DELETE FROM current_data',
    'DROP TABLE current_data',
    'COPY current_data TO \'/tmp/data.csv\'',
    'SELECT 1; SELECT 2',
    '',
  ])('rejects unsafe or invalid query: %s', sql => {
    expect(() => normalizeReadOnlyQuery(sql)).toThrow();
  });
});
