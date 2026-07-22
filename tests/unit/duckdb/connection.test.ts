import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockAppendLine = vi.fn();

vi.mock('vscode', () => ({
  window: {
    createOutputChannel: vi.fn().mockReturnValue({
      appendLine: mockAppendLine,
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
        run: vi.fn().mockResolvedValue({
          getRowsJson: vi.fn().mockResolvedValue([[1]]),
          columnNames: vi.fn().mockReturnValue(['id']),
        }),
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
      { memoryLimit: '1GB', tempDirectory: '', autoLoadExtensions: false },
      {
        appendLine: mockAppendLine,
        show: vi.fn(),
        dispose: vi.fn(),
      } as any,
    );
  });

  describe('connect', () => {
    it('should create a DuckDB instance', async () => {
      await connection.connect();
      expect(connection.isConnected()).toBe(true);
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
