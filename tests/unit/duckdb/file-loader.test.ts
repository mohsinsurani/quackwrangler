import { describe, expect, it, vi } from 'vitest';
import {
  detectFileType,
  getConnectionTableRef,
  getTableRef,
  loadFile,
  prepareDataFileReader,
  prepareSourceSchema,
  resolveLoadingMode,
} from '../../../src/duckdb/parquet-loader';

describe('data file readers', () => {
  it.each([
    ['/tmp/data.parquet', "read_parquet('/tmp/data.parquet')"],
    ['/tmp/data.json', "read_json_auto('/tmp/data.json')"],
    ['/tmp/data.jsonl', "read_json_auto('/tmp/data.jsonl')"],
    ['/tmp/data.ndjson', "read_json_auto('/tmp/data.ndjson')"],
    ['/tmp/data.ods', "(SELECT * EXCLUDE (OGC_FID) FROM ST_Read('/tmp/data.ods'))"],
    ['/tmp/data.arrow', "read_arrow('/tmp/data.arrow')"],
    ['/tmp/data.arrows', "read_arrow('/tmp/data.arrows')"],
    ['/tmp/data.ipc', "read_arrow('/tmp/data.ipc')"],
    ['/tmp/data.orc', "read_orc('/tmp/data.orc')"],
  ])('maps %s to its DuckDB reader', (filePath, expected) => {
    expect(getTableRef(filePath)).toBe(expected);
  });

  it('maps XLSX sources to the DuckDB Excel reader', () => {
    expect(detectFileType('/tmp/orders.xlsx')).toBe('xlsx');
    expect(detectFileType('https://example.com/orders.xlsx?download=1')).toBe('xlsx');
    expect(getTableRef('/tmp/orders.xlsx')).toBe(
      "read_xlsx('/tmp/orders.xlsx', all_varchar=true)",
    );
    expect(
      getTableRef('/tmp/orders.xlsx', 'xlsx', undefined, [
        { name: 'id', type: 'BIGINT' },
        { name: 'amount', type: 'DOUBLE' },
        { name: 'form', type: 'VARCHAR' },
      ]),
    ).toBe(
      '(SELECT TRY_CAST("id" AS BIGINT) AS "id", TRY_CAST("amount" AS DOUBLE) AS "amount", "form" FROM read_xlsx(\'/tmp/orders.xlsx\', all_varchar=true))',
    );
  });

  it('recognizes legacy XLS sources for conversion through the XLSX reader', () => {
    expect(detectFileType('/tmp/orders.xls')).toBe('xls');
    expect(getTableRef('/tmp/orders.xls', 'xls')).toBe(
      "read_xlsx('/tmp/orders.xls', all_varchar=true)",
    );
  });

  it('maps local and remote Arrow IPC sources to read_arrow', () => {
    expect(detectFileType('/tmp/events.arrow')).toBe('arrow');
    expect(detectFileType('https://example.com/events.ipc?token=hidden')).toBe('arrow');
    expect(getTableRef('/tmp/events.arrows')).toBe("read_arrow('/tmp/events.arrows')");
  });

  it('pins resolved CSV column types so queries do not repeat type detection', () => {
    expect(
      getTableRef('/tmp/registrations.csv', 'csv', [
        { name: 'GP_PRAC', type: 'VARCHAR' },
        { name: 'NUMBER_OF_PATIENTS', type: 'VARCHAR' },
      ]),
    ).toBe(
      "read_csv('/tmp/registrations.csv', types={'GP_PRAC': 'VARCHAR', 'NUMBER_OF_PATIENTS': 'VARCHAR'})",
    );
  });

  it('falls back to auto-detection when no schema has been resolved', () => {
    expect(getTableRef('/tmp/registrations.csv')).toBe("read_csv_auto('/tmp/registrations.csv')");
  });

  it('caches a resolved schema per connection and reuses it for later references', async () => {
    const query = vi.fn().mockImplementation(async (sql: string) => {
      if (sql.startsWith('SELECT Columns FROM sniff_csv')) {
        return {
          rows: [
            [
              [
                { name: 'id', type: 'BIGINT' },
                { name: 'amount', type: 'BIGINT' },
              ],
            ],
          ],
        };
      }
      if (sql.startsWith('SELECT DISTINCT column_name')) return { rows: [['amount']] };
      return { rows: [] };
    });
    const transaction = vi.fn(async (callback) => callback({ query }));
    const connection = { query, transaction } as never;

    await prepareSourceSchema(connection, '/tmp/registrations.csv');
    // A second call must not re-run detection.
    await prepareSourceSchema(connection, '/tmp/registrations.csv');

    const sniffs = query.mock.calls.filter(([sql]) => String(sql).includes('sniff_csv'));
    expect(sniffs).toHaveLength(1);
    // Only the rejecting column is widened; the clean column keeps its type.
    expect(getConnectionTableRef(connection, '/tmp/registrations.csv')).toBe(
      "read_csv('/tmp/registrations.csv', types={'id': 'BIGINT', 'amount': 'VARCHAR'})",
    );
  });

  it('prepares signed nanoarrow and httpfs extensions for remote Arrow', async () => {
    const installed = new Set<string>();
    const query = vi.fn().mockImplementation(async (sql: string) => {
      if (sql.startsWith('INSTALL ')) installed.add(sql.split(' ')[1]);
      if (sql === 'LOAD httpfs' && !installed.has('httpfs')) throw new Error('not installed');
      if (sql === 'LOAD nanoarrow' && !installed.has('nanoarrow')) throw new Error('not installed');
      return { rows: [] };
    });
    await prepareDataFileReader({ query } as never, 'https://example.com/events.arrow');
    expect(query.mock.calls.map((call) => call[0])).toEqual([
      'LOAD httpfs',
      'INSTALL httpfs',
      'LOAD httpfs',
      'LOAD nanoarrow',
      'INSTALL nanoarrow FROM community',
      'LOAD nanoarrow',
    ]);
  });

  it('prepares the spatial extension before opening ODS sources', async () => {
    let installed = false;
    const query = vi.fn().mockImplementation(async (sql: string) => {
      if (sql === 'INSTALL spatial') installed = true;
      if (sql === 'LOAD spatial' && !installed) throw new Error('not installed');
      return { rows: [] };
    });
    await prepareDataFileReader({ query } as never, '/tmp/orders.ods');
    expect(query.mock.calls.map((call) => call[0])).toEqual([
      'LOAD spatial',
      'INSTALL spatial',
      'LOAD spatial',
    ]);
  });

  it('prepares the Excel extension before opening XLSX sources', async () => {
    let installed = false;
    const query = vi.fn().mockImplementation(async (sql: string) => {
      if (sql === 'INSTALL excel') installed = true;
      if (sql === 'LOAD excel' && !installed) throw new Error('not installed');
      return { rows: [] };
    });
    await prepareDataFileReader({ query } as never, '/tmp/orders.xlsx');
    expect(query.mock.calls.map((call) => call[0])).toEqual([
      'LOAD excel',
      'INSTALL excel',
      'LOAD excel',
      "DESCRIBE SELECT * FROM read_xlsx('/tmp/orders.xlsx', all_varchar=true)",
    ]);
  });

  it('caches selective XLSX types and keeps mixed columns as text', async () => {
    const query = vi.fn().mockImplementation(async (sql: string) => {
      if (sql.startsWith('DESCRIBE') && sql.includes('all_varchar=true')) {
        return { rows: [['id'], ['amount'], ['form']] };
      }
      if (sql.startsWith('DESCRIBE SELECT * FROM read_xlsx')) {
        return { rows: [['id', 'DOUBLE'], ['amount', 'DOUBLE'], ['form', 'VARCHAR']] };
      }
      return {
        rows: [
          [
            '2', '0', '0', '2', '2', '0', '2',
            '2', '1', '0', '2', '2', '0', '2',
            '2', '1', '1', '2', '2', '0', '2',
          ],
        ],
      };
    });
    const connection = { query } as never;

    await prepareSourceSchema(connection, '/tmp/orders.xlsx');

    expect(getConnectionTableRef(connection, '/tmp/orders.xlsx')).toBe(
      '(SELECT TRY_CAST("id" AS BIGINT) AS "id", TRY_CAST("amount" AS DOUBLE) AS "amount", "form" FROM read_xlsx(\'/tmp/orders.xlsx\', all_varchar=true))',
    );
  });

  it('prepares the signed community ORC extension', async () => {
    let installed = false;
    const query = vi.fn().mockImplementation(async (sql: string) => {
      if (sql === 'INSTALL orc FROM community') installed = true;
      if (sql === 'LOAD orc' && !installed) throw new Error('not installed');
      return { rows: [] };
    });
    await prepareDataFileReader({ query } as never, '/tmp/events.orc');
    expect(query.mock.calls.map((call) => call[0])).toEqual([
      'LOAD orc',
      'INSTALL orc FROM community',
      'LOAD orc',
    ]);
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
        expect(calls.some((sql) => /^ALTER VIEW .* RENAME TO "current_data"$/.test(sql))).toBe(
          true,
        );
      }
      expect(transaction).toHaveBeenCalledTimes(2);
    },
  );
});
