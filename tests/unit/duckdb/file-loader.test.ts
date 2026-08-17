import { describe, expect, it, vi } from 'vitest';
import {
  detectFileType,
  getTableRef,
  loadFile,
  prepareDataFileReader,
  resolveLoadingMode,
} from '../../../src/duckdb/parquet-loader';

describe('data file readers', () => {
  it('maps local and remote Arrow IPC sources to read_arrow', () => {
    expect(detectFileType('/tmp/events.arrow')).toBe('arrow');
    expect(detectFileType('https://example.com/events.ipc?token=hidden')).toBe('arrow');
    expect(getTableRef('/tmp/events.arrows')).toBe("read_arrow('/tmp/events.arrows')");
  });

  it('prepares signed nanoarrow and httpfs extensions for remote Arrow', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await prepareDataFileReader({ query } as never, 'https://example.com/events.arrow');
    expect(query.mock.calls.map((call) => call[0])).toEqual([
      'INSTALL httpfs',
      'LOAD httpfs',
      'INSTALL nanoarrow FROM community',
      'LOAD nanoarrow',
    ]);
  });

  it('gives an actionable ORC compatibility error', async () => {
    await expect(
      prepareDataFileReader({ query: vi.fn() } as never, '/tmp/events.orc'),
    ).rejects.toThrow('no supported ORC reader');
  });

  it('uses lazy loading for remote sources in automatic mode', async () => {
    await expect(resolveLoadingMode('https://example.com/data.parquet', 'auto', 64)).resolves.toBe(
      'lazy',
    );
  });

  it('creates a view for lazy loading and a table for eager loading', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const transaction = vi.fn(async (callback) => callback({ query }));
    await loadFile({ query, transaction } as never, '/tmp/data.parquet', 'lazy');
    expect(query).toHaveBeenCalledWith(
      expect.stringMatching(
        /^CREATE VIEW "current_data_staging_[a-z0-9_]+" AS SELECT \* FROM read_parquet\('\/tmp\/data\.parquet'\)$/,
      ),
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringMatching(
        /^ALTER VIEW "current_data_staging_[a-z0-9_]+" RENAME TO "current_data"$/,
      ),
    );
    expect(transaction).toHaveBeenCalledOnce();
    query.mockClear();
    await loadFile({ query, transaction } as never, '/tmp/data.parquet', 'eager');
    expect(query).toHaveBeenCalledWith(
      expect.stringMatching(
        /^CREATE TABLE "current_data_materialized_[a-z0-9_]+" AS SELECT \* FROM read_parquet\('\/tmp\/data\.parquet'\)$/,
      ),
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringMatching(
        /^ALTER TABLE "current_data_materialized_[a-z0-9_]+" RENAME TO "current_data_materialized"$/,
      ),
    );
    expect(query).toHaveBeenCalledWith(
      'CREATE VIEW "current_data" AS SELECT * FROM "current_data_materialized"',
    );
  });

  it.each([
    ['eager', 'lazy'],
    ['lazy', 'eager'],
  ] as const)(
    'reloads safely when switching from %s to %s loading',
    async (firstMode, secondMode) => {
      const query = vi.fn().mockResolvedValue({ rows: [] });
      const transaction = vi.fn(async (callback) => callback({ query }));
      const connection = { query, transaction } as never;

      await loadFile(connection, '/tmp/first.parquet', firstMode);
      query.mockClear();
      await loadFile(connection, '/tmp/second.parquet', secondMode);

      const calls = query.mock.calls.map(([sql]) => sql as string);
      expect(calls).toContain('DROP VIEW IF EXISTS "current_data"');
      expect(calls).toContain('DROP TABLE IF EXISTS "current_data_materialized"');
      if (secondMode === 'eager') {
        expect(calls).toContain(
          'CREATE VIEW "current_data" AS SELECT * FROM "current_data_materialized"',
        );
      } else {
        expect(calls.some((sql) => /^ALTER VIEW .* RENAME TO "current_data"$/.test(sql))).toBe(true);
      }
      expect(transaction).toHaveBeenCalledTimes(2);
    },
  );
});
