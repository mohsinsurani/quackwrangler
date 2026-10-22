import { DuckDBInstance } from '@duckdb/node-api';
import * as vscode from 'vscode';

import { QueryResult, DataWranglerConfig } from '../types/index.js';

export interface DuckDBTransaction {
  query(sql: string): Promise<QueryResult>;
}

function quoteSetting(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export class DuckDBConnection {
  private instance: DuckDBInstance | null = null;
  private config: DataWranglerConfig;
  private channel: vscode.OutputChannel | undefined;

  constructor(config: DataWranglerConfig, channel?: vscode.OutputChannel) {
    this.config = config;
    this.channel = channel;
  }

  private log(message: string): void {
    this.channel?.appendLine(`[DuckDB] ${message}`);
  }

  private logError(message: string, error?: unknown): void {
    const details = error instanceof Error ? (error.stack ?? error.message) : String(error);
    this.channel?.appendLine(`[DuckDB ERROR] ${message}: ${details}`);
  }

  async connect(): Promise<void> {
    try {
      this.log('Creating in-memory DuckDB instance...');
      this.instance = await DuckDBInstance.create(':memory:');

      if (this.config.memoryLimit) {
        const conn = await this.instance.connect();
        await conn.run(`SET memory_limit=${quoteSetting(this.config.memoryLimit)}`);
        conn.closeSync();
        this.log(`Memory limit set to ${this.config.memoryLimit}`);
      }

      if (this.config.tempDirectory) {
        const conn = await this.instance.connect();
        await conn.run(`SET temp_directory=${quoteSetting(this.config.tempDirectory)}`);
        conn.closeSync();
        this.log(`Temp directory set to ${this.config.tempDirectory}`);
      }

      if (this.config.maxTempDirectorySize) {
        const conn = await this.instance.connect();
        await conn.run(
          `SET max_temp_directory_size=${quoteSetting(this.config.maxTempDirectorySize)}`,
        );
        conn.closeSync();
        this.log(`Maximum temp directory size set to ${this.config.maxTempDirectorySize}`);
      }

      if (this.config.threads > 0) {
        const conn = await this.instance.connect();
        await conn.run(`SET threads=${Math.floor(this.config.threads)}`);
        conn.closeSync();
        this.log(`Worker threads set to ${Math.floor(this.config.threads)}`);
      }

      {
        const conn = await this.instance.connect();
        await conn.run(
          `SET preserve_insertion_order=${this.config.preserveInsertionOrder ? 'true' : 'false'}`,
        );
        conn.closeSync();
        this.log(`Preserve insertion order set to ${this.config.preserveInsertionOrder}`);
      }

      const configuredExtensions = Array.isArray(this.config.autoLoadExtensions)
        ? this.config.autoLoadExtensions
        : this.config.autoLoadExtensions
          ? ['httpfs']
          : [];
      if (configuredExtensions.includes('httpfs')) {
        const conn = await this.instance.connect();
        try {
          await conn.run('LOAD httpfs');
          this.log('Loaded httpfs extension');
        } catch {
          this.log('httpfs extension is not installed; local files remain available');
        }
        conn.closeSync();
      }

      await this.verifySpillConfiguration();

      this.log('DuckDB instance created successfully');
    } catch (error) {
      this.logError('Failed to create DuckDB instance', error);
      throw error;
    }
  }

  /**
   * Out-of-memory failures on large sources are caused by DuckDB being unable to
   * offload data, not by thread count. Record the effective spill settings so a
   * misconfigured temp directory or a zero spill budget is visible in the log
   * rather than surfacing later as an opaque allocation failure.
   */
  private async verifySpillConfiguration(): Promise<void> {
    if (!this.instance) return;
    const conn = await this.instance.connect();
    try {
      const result = await conn.run(
        `SELECT current_setting('temp_directory'), current_setting('max_temp_directory_size'), current_setting('memory_limit')`,
      );
      const [row] = await result.getRowsJson();
      const [tempDirectory, maxTempSize, memoryLimit] = (row ?? []) as string[];
      this.log(
        `Spill configuration: memory_limit=${memoryLimit}, temp_directory=${tempDirectory || '(unset)'}, max_temp_directory_size=${maxTempSize}`,
      );
      if (!tempDirectory) {
        this.log(
          'WARNING: no temp directory is configured, so queries larger than the memory limit cannot spill and may fail with an out-of-memory error.',
        );
      }
      if (/^0(\.0+)?\s*(b|bytes|kib|mib|gib)?$/i.test(String(maxTempSize ?? '').trim())) {
        this.log(
          'WARNING: max_temp_directory_size is zero, which disables spilling to disk. Increase quackwrangler.duckdb.maxTempDirectorySize to process data larger than memory.',
        );
      }
    } catch (error) {
      // Diagnostics must never prevent a usable connection.
      this.logError('Could not read DuckDB spill configuration', error);
    } finally {
      conn.closeSync();
    }
  }

  async query(sql: string): Promise<QueryResult> {
    if (!this.instance) {
      throw new Error('DuckDB not connected. Call connect() first.');
    }

    const startTime = Date.now();
    try {
      const conn = await this.instance.connect();
      try {
        return await this.runQuery(conn, sql, startTime);
      } finally {
        conn.closeSync();
      }
    } catch (error) {
      this.logError('Query execution failed', error);
      throw error;
    }
  }

  async transaction<T>(callback: (transaction: DuckDBTransaction) => Promise<T>): Promise<T> {
    if (!this.instance) {
      throw new Error('DuckDB not connected. Call connect() first.');
    }
    const conn = await this.instance.connect();
    try {
      await conn.run('BEGIN TRANSACTION');
      const value = await callback({
        query: (sql) => this.runQuery(conn, sql, Date.now()),
      });
      await conn.run('COMMIT');
      return value;
    } catch (error) {
      try {
        await conn.run('ROLLBACK');
      } catch (rollbackError) {
        this.logError('Transaction rollback failed', rollbackError);
      }
      throw error;
    } finally {
      conn.closeSync();
    }
  }

  private async runQuery(
    conn: Awaited<ReturnType<DuckDBInstance['connect']>>,
    sql: string,
    startTime: number,
  ): Promise<QueryResult> {
    this.log(`Executing query: ${sql.substring(0, 200)}...`);
    const result = await conn.run(sql);
    const rows = await result.getRowsJson();
    const columns = result.columnNames();
    const duration = Date.now() - startTime;
    this.log(`Query completed in ${duration}ms, returned ${rows.length} rows`);
    return { columns, rows, rowCount: rows.length, duration };
  }

  async close(): Promise<void> {
    if (this.instance) {
      try {
        this.instance.closeSync();
        this.instance = null;
        this.log('DuckDB instance closed');
      } catch (error) {
        this.logError('Error closing DuckDB instance', error);
        this.instance = null;
      }
    }
  }

  isConnected(): boolean {
    return this.instance !== null;
  }
}
