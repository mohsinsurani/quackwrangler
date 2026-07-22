import * as vscode from 'vscode';

import { DuckDBConnection } from '../duckdb/connection.js';
import {
  EngineType,
  QueryResult,
  TableSchema,
  DataWranglerConfig
} from '../types/index.js';

import { PolarsProcess } from './polars-process.js';

export interface DataEngine {
  type: EngineType;
  connect(): Promise<void>;
  query(sql: string): Promise<QueryResult>;
  loadFile(filePath: string): Promise<TableSchema>;
  export(filePath: string, format: string): Promise<void>;
  close(): Promise<void>;
  isConnected(): boolean;
}

class DuckDBEngine implements DataEngine {
  type: EngineType = 'duckdb';
  private connection: DuckDBConnection;

  constructor(config: DataWranglerConfig, outputChannel: vscode.OutputChannel) {
    this.connection = new DuckDBConnection(config, outputChannel);
  }

  async connect(): Promise<void> {
    await this.connection.connect();
  }

  async query(sql: string): Promise<QueryResult> {
    return this.connection.query(sql);
  }

  async loadFile(filePath: string): Promise<TableSchema> {
    const { columns, types } = await this.connection.getSchema(filePath);
    const result = await this.connection.query(
      `SELECT COUNT(*) as count FROM (${this.getTableRef(filePath)})`
    );
    const rowCount = result.rows[0][0] as number;

    return {
      columns: columns.map((name: string, i: number) => ({
        name,
        type: types[i],
        nullable: true
      })),
      rowCount,
      filePath
    };
  }

  async export(filePath: string, format: string): Promise<void> {
    const exportFormat = format as 'parquet' | 'csv' | 'json';
    await this.connection.query(
      `SELECT * FROM current_data INTO '${filePath}' FORMAT ${exportFormat.toUpperCase()}`
    );
  }

  async close(): Promise<void> {
    await this.connection.close();
  }

  isConnected(): boolean {
    return this.connection.isConnected();
  }

  private getTableRef(filePath: string): string {
    const ext = filePath.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'parquet':
        return `read_parquet('${filePath.replace(/'/g, "''")}')`;
      case 'csv':
      case 'tsv':
        return `read_csv_auto('${filePath.replace(/'/g, "''")}')`;
      case 'json':
      case 'jsonl':
        return `read_json_auto('${filePath.replace(/'/g, "''")}')`;
      default:
        throw new Error(`Unsupported file type: ${ext}`);
    }
  }
}

class PolarsEngine implements DataEngine {
  type: EngineType = 'polars';
  private polars: PolarsProcess;

  constructor(config: DataWranglerConfig, outputChannel: vscode.OutputChannel) {
    const timeout = parseInt(config.memoryLimit) * 1000 || 30000;
    this.polars = new PolarsProcess(outputChannel, timeout);
  }

  async connect(): Promise<void> {
    await this.polars.connect();
  }

  async query(sql: string): Promise<QueryResult> {
    return this.polars.query(sql);
  }

  async loadFile(filePath: string): Promise<TableSchema> {
    const result = await this.polars.loadFile(filePath);
    return {
      columns: Object.entries(result.schema).map(([name, type]) => ({
        name,
        type,
        nullable: true
      })),
      rowCount: result.rowCount,
      filePath
    };
  }

  async export(filePath: string, format: string): Promise<void> {
    const exportFormat = format as 'parquet' | 'csv' | 'json' | 'feather';
    await this.polars.export(filePath, exportFormat);
  }

  async close(): Promise<void> {
    await this.polars.close();
  }

  isConnected(): boolean {
    return this.polars.isConnected();
  }
}

export class EngineManager {
  private engines: Map<EngineType, DataEngine> = new Map();
  private activeEngine: DataEngine | null = null;
  private config: DataWranglerConfig;
  private outputChannel: vscode.OutputChannel;

  constructor(config: DataWranglerConfig, outputChannel: vscode.OutputChannel) {
    this.config = config;
    this.outputChannel = outputChannel;
  }

  /**
   * Check if a specific engine is available.
   */
  async isEngineAvailable(type: EngineType): Promise<boolean> {
    if (type === 'duckdb') {
      try {
        const { DuckDBInstance } = await import('@duckdb/node-api');
        await DuckDBInstance.create(':memory:');
        return true;
      } catch {
        return false;
      }
    }

    if (type === 'polars') {
      try {
        const testEngine = new PolarsEngine(this.config, this.outputChannel);
        await testEngine.connect();
        await testEngine.close();
        return true;
      } catch {
        return false;
      }
    }

    return false;
  }

  /**
   * Get all available engines.
   */
  async getAvailableEngines(): Promise<EngineType[]> {
    const available: EngineType[] = [];
    if (await this.isEngineAvailable('duckdb')) {
      available.push('duckdb');
    }
    if (await this.isEngineAvailable('polars')) {
      available.push('polars');
    }
    return available;
  }

  /**
   * Create or get an engine instance.
   */
  async createEngine(type: EngineType): Promise<DataEngine> {
    if (this.engines.has(type)) {
      return this.engines.get(type)!;
    }

    let engine: DataEngine;
    switch (type) {
      case 'duckdb':
        engine = new DuckDBEngine(this.config, this.outputChannel);
        break;
      case 'polars':
        engine = new PolarsEngine(this.config, this.outputChannel);
        break;
      default:
        throw new Error(`Unknown engine type: ${type}`);
    }

    await engine.connect();
    this.engines.set(type, engine);
    this.outputChannel.appendLine(`[EngineManager] Created ${type} engine`);
    return engine;
  }

  /**
   * Set the active engine.
   */
  async setActiveEngine(type: EngineType): Promise<DataEngine> {
    const engine = await this.createEngine(type);
    this.activeEngine = engine;
    this.outputChannel.appendLine(`[EngineManager] Active engine set to ${type}`);
    return engine;
  }

  /**
   * Get the current active engine.
   */
  getActiveEngine(): DataEngine | null {
    return this.activeEngine;
  }

  /**
   * Switch to a different engine.
   */
  async switchEngine(type: EngineType): Promise<DataEngine> {
    if (this.activeEngine && this.activeEngine.type === type) {
      return this.activeEngine;
    }
    return this.setActiveEngine(type);
  }

  /**
   * Close all engines and cleanup.
   */
  async closeAll(): Promise<void> {
    for (const [type, engine] of this.engines) {
      try {
        await engine.close();
        this.outputChannel.appendLine(`[EngineManager] Closed ${type} engine`);
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        this.outputChannel.appendLine(`[EngineManager] Error closing ${type}: ${errMsg}`);
      }
    }
    this.engines.clear();
    this.activeEngine = null;
  }

  /**
   * Close a specific engine.
   */
  async closeEngine(type: EngineType): Promise<void> {
    const engine = this.engines.get(type);
    if (engine) {
      await engine.close();
      this.engines.delete(type);
      if (this.activeEngine?.type === type) {
        this.activeEngine = null;
      }
    }
  }
}
