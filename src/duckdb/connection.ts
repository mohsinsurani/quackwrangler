import { DuckDBInstance } from '@duckdb/node-api';
import * as vscode from 'vscode';

import { QueryResult, DataWranglerConfig } from '../types/index.js';

let outputChannel: vscode.OutputChannel;

function log(message: string): void {
  outputChannel.appendLine(`[DuckDB] ${message}`);
}

function logError(message: string, error?: unknown): void {
  const errMsg = error instanceof Error ? error.message : String(error);
  outputChannel.appendLine(`[DuckDB ERROR] ${message}: ${errMsg}`);
}

export class DuckDBConnection {
  private instance: DuckDBInstance | null = null;
  private config: DataWranglerConfig;

  constructor(config: DataWranglerConfig, channel?: vscode.OutputChannel) {
    this.config = config;
    if (channel) {
      outputChannel = channel;
    }
  }

  async connect(): Promise<void> {
    try {
      log('Creating in-memory DuckDB instance...');
      this.instance = await DuckDBInstance.create(':memory:');

      if (this.config.memoryLimit) {
        const conn = await this.instance.connect();
        await conn.run(`SET memory_limit='${this.config.memoryLimit}'`);
        conn.closeSync();
        log(`Memory limit set to ${this.config.memoryLimit}`);
      }

      if (this.config.tempDirectory) {
        const conn = await this.instance.connect();
        await conn.run(`SET temp_directory='${this.config.tempDirectory}'`);
        conn.closeSync();
        log(`Temp directory set to ${this.config.tempDirectory}`);
      }

      const configuredExtensions = Array.isArray(this.config.autoLoadExtensions)
        ? this.config.autoLoadExtensions
        : this.config.autoLoadExtensions ? ['httpfs'] : [];
      if (configuredExtensions.includes('httpfs')) {
        const conn = await this.instance.connect();
        try {
          await conn.run('LOAD httpfs');
          log('Loaded httpfs extension');
        } catch {
          log('httpfs extension is not installed; local files remain available');
        }
        conn.closeSync();
      }

      log('DuckDB instance created successfully');
    } catch (error) {
      logError('Failed to create DuckDB instance', error);
      throw error;
    }
  }

  async query(sql: string): Promise<QueryResult> {
    if (!this.instance) {
      throw new Error('DuckDB not connected. Call connect() first.');
    }

    const startTime = Date.now();
    try {
      log(`Executing query: ${sql.substring(0, 200)}...`);
      const conn = await this.instance.connect();
      try {
        const result = await conn.run(sql);
        const rows = await result.getRowsJson();
        const columns = result.columnNames();
        const duration = Date.now() - startTime;

        log(`Query completed in ${duration}ms, returned ${rows.length} rows`);

        return {
          columns,
          rows,
          rowCount: rows.length,
          duration,
        };
      } finally {
        conn.closeSync();
      }
    } catch (error) {
      logError('Query execution failed', error);
      throw error;
    }
  }

  async getSchema(filePath: string): Promise<{ columns: string[]; types: string[] }> {
    if (!this.instance) {
      throw new Error('DuckDB not connected. Call connect() first.');
    }

    const ext = filePath.split('.').pop()?.toLowerCase();
    let tableName: string;

    if (ext === 'parquet') {
      tableName = `read_parquet('${filePath}')`;
    } else if (ext === 'csv' || ext === 'tsv') {
      tableName = `read_csv_auto('${filePath}')`;
    } else if (ext === 'json' || ext === 'jsonl' || ext === 'ndjson') {
      tableName = `read_json_auto('${filePath}')`;
    } else if (ext === 'xlsx') {
      tableName = `read_xlsx('${filePath}')`;
    } else if (ext === 'ods') {
      tableName = `ST_Read('${filePath}')`;
    } else {
      throw new Error(`Unsupported file type: ${ext}`);
    }

    const result = await this.query(`DESCRIBE SELECT * FROM ${tableName}`);
    const columns = result.rows.map((row: unknown[]) => row[0] as string);
    const types = result.rows.map((row: unknown[]) => row[1] as string);

    return { columns, types };
  }

  async close(): Promise<void> {
    if (this.instance) {
      try {
        this.instance = null;
        log('DuckDB instance closed');
      } catch (error) {
        logError('Error closing DuckDB instance', error);
      }
    }
  }

  isConnected(): boolean {
    return this.instance !== null;
  }
}
