import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DuckDBConnection } from '../../../src/duckdb/connection';

vi.mock('@duckdb/node-api', () => ({
  DuckDBInstance: {
    create: vi.fn().mockResolvedValue({
      connect: vi.fn().mockResolvedValue({
        all: vi.fn().mockResolvedValue([]),
        run: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
      }),
    }),
  },
}));

describe('DuckDBConnection', () => {
  let connection: DuckDBConnection;

  beforeEach(() => {
    connection = new DuckDBConnection();
  });

  describe('connect', () => {
    it('should create a DuckDB instance', async () => {
      await connection.connect();
      expect(connection.isConnected()).toBe(true);
    });

    it('should throw error if already connected', async () => {
      await connection.connect();
      await expect(connection.connect()).rejects.toThrow('Already connected');
    });
  });

  describe('query', () => {
    it('should execute SQL query', async () => {
      await connection.connect();
      const result = await connection.query('SELECT 1 as id');
      expect(result).toBeDefined();
      expect(result.columns).toBeDefined();
      expect(result.rows).toBeDefined();
    });

    it('should throw error if not connected', async () => {
      await expect(connection.query('SELECT 1')).rejects.toThrow('Not connected');
    });
  });

  describe('getSchema', () => {
    it('should return schema for parquet file', async () => {
      await connection.connect();
      const schema = await connection.getSchema('/path/to/file.parquet');
      expect(schema).toBeDefined();
      expect(Array.isArray(schema.columns)).toBe(true);
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
