export type EngineType = 'duckdb' | 'polars';

export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  description?: string;
}

export interface TableSchema {
  columns: ColumnInfo[];
  rowCount: number;
  filePath: string;
}

export interface QueryResult {
  columns: string[];
  rows: any[][];
  rowCount: number;
  duration: number;
}

export interface ColumnStatistics {
  name: string;
  type: string;
  nullCount: number;
  distinctCount: number;
  min?: unknown;
  max?: unknown;
  mean?: number;
}

export interface PageInfo {
  offset: number;
  limit: number;
  totalRows: number;
}

export interface TransformOperation {
  id: string;
  type: string;
  params: Record<string, any>;
  sql: string;
  description: string;
}

export interface DataWranglerConfig {
  memoryLimit: string;
  tempDirectory: string;
  autoLoadExtensions: boolean | string[];
  maxRowsPreview: number;
  exportFormat: 'parquet' | 'csv' | 'json';
  engine: EngineType;
  defaultExportEngine: EngineType;
}

export type WebviewMessage =
  | { type: 'loadFile'; filePath: string }
  | { type: 'executeQuery'; sql: string }
  | { type: 'executeCustomQuery'; sql: string }
  | { type: 'clearCustomQuery' }
  | { type: 'applyTransform'; transform: TransformOperation }
  | { type: 'exportData'; format: 'parquet' | 'csv' | 'json'; outputPath?: string }
  | { type: 'getSchema'; filePath: string }
  | { type: 'summarize'; filePath: string }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'reset' }
  | { type: 'pageChange'; offset: number; limit: number }
  | { type: 'saveConfig'; config: Partial<DataWranglerConfig> }
  | { type: 'switchEngine'; engine: EngineType }
  | { type: 'openFilePicker' }
  | { type: 'refresh' }
  | { type: 'removeTransform'; id: string }
  | { type: 'getStats' }
  | { type: 'ready' }
  | { type: 'exportCode'; format: 'duckdb-sql' | 'duckdb-python' | 'polars-python' };

export type ExtensionMessage =
  | { type: 'fileLoaded'; schema: TableSchema; preview: QueryResult }
  | { type: 'queryResult'; result: QueryResult }
  | { type: 'customQueryResult'; schema: TableSchema; result: QueryResult; page: PageInfo }
  | { type: 'transformApplied'; result: QueryResult; history: TransformOperation[] }
  | { type: 'error'; message: string }
  | { type: 'schema'; schema: TableSchema }
  | { type: 'summary'; summary: string }
  | { type: 'exportComplete'; outputPath: string }
  | { type: 'configLoaded'; config: DataWranglerConfig }
  | { type: 'sessionUpdated'; protocolVersion: number; schema: TableSchema; result: QueryResult; history: TransformOperation[]; engine: EngineType; page: PageInfo; code: { sql: string; duckdbPython: string; polarsPython: string } }
  | { type: 'stats'; stats: ColumnStatistics[] }
  | { type: 'engineSwitched'; engine: EngineType; available: boolean; message?: string };
