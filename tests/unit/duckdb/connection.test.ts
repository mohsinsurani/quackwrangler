import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  appendLine: vi.fn(),
  run: vi.fn().mockResolvedValue({
    getRowsJson: vi.fn().mockResolvedValue([[1]]),
    columnNames: vi.fn().mockReturnValue(['id']),
  }),
}));

vi.mock('vscode', () => ({
  window: {
    createOutputChannel: vi.fn().mockReturnValue({
      appendLine: mocks.appendLine,
      show: vi.fn(),
      dispose: vi.fn(),
    }),
  },
}));

vi.mock('@duckdb/node-api', () => ({
  DuckDBInstance: {
    create: vi.fn().mockResolvedValue({
      connect: vi.fn().mockResolvedValue({
        all: vi.fn().mockResolvedValue([]),
        run: mocks.run,
        closeSync: vi.fn(),
      }),
    }),
  },
}));

import { DuckDBConnection } from '../../../src/duckdb/connection';

describe('DuckDBConnection', () => {
  let connection: DuckDBConnection;

  beforeEach(() => {
    vi.clearAllMocks();
    connection = new DuckDBConnection(
      {
        memoryLimit: '1GB',
        tempDirectory: '',
        maxTempDirectorySize: '15GB',
        autoLoadExtensions: false,
        pageSize: 100,
      },
      {
        appendLine: mocks.appendLine,
        show: vi.fn(),
        dispose: vi.fn(),
      } as any,
    );
  });

  describe('connect', () => {
    it('should create a DuckDB instance', async () => {
      await connection.connect();
      expect(connection.isConnected()).toBe(true);
      expect(mocks.run).toHaveBeenCalledWith("SET max_temp_directory_size='15GB'");
    });

    it('escapes a configured temporary directory before applying the DuckDB setting', async () => {
      connection = new DuckDBConnection(
        {
          memoryLimit: '1GB',
          tempDirectory: "/tmp/quack's-spill",
          maxTempDirectorySize: '15GB',
          autoLoadExtensions: false,
          pageSize: 100,
          maxRowsPreview: 10000,
        },
        { appendLine: mocks.appendLine } as never,
      );

      await connection.connect();

      expect(mocks.run).toHaveBeenCalledWith("SET temp_directory='/tmp/quack''s-spill'");
    });
  });

  describe('query', () => {
    it('should execute SQL query', async () => {
      await connection.connect();
      const result = await connection.query('SELECT 1 as id');
      expect(result).toBeDefined();
    });

    it('should throw error if not connected', async () => {
      await expect(connection.query('SELECT 1')).rejects.toThrow('DuckDB not connected');
    });
  });

  describe('close', () => {
    it('should close connection', async () => {
      await connection.connect();
      await connection.close();
      expect(connection.isConnected()).toBe(false);
    });

    it('should be safe to call multiple times', async () => {
      await connection.connect();
      await connection.close();
      await connection.close();
      expect(connection.isConnected()).toBe(false);
    });
  });
});
