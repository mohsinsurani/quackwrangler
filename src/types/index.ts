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
  autoLoadExtensions: boolean;
  maxRowsPreview: number;
  exportFormat: 'parquet' | 'csv' | 'json';
}

export type WebviewMessage =
  | { type: 'loadFile'; filePath: string }
  | { type: 'executeQuery'; sql: string }
  | { type: 'applyTransform'; transform: TransformOperation }
  | { type: 'exportData'; format: string; outputPath: string }
  | { type: 'getSchema'; filePath: string }
  | { type: 'summarize'; filePath: string }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'reset' }
  | { type: 'pageChange'; offset: number; limit: number }
  | { type: 'saveConfig'; config: Partial<DataWranglerConfig> };

export type ExtensionMessage =
  | { type: 'fileLoaded'; schema: TableSchema; preview: QueryResult }
  | { type: 'queryResult'; result: QueryResult }
  | { type: 'transformApplied'; result: QueryResult; history: TransformOperation[] }
  | { type: 'error'; message: string }
  | { type: 'schema'; schema: TableSchema }
  | { type: 'summary'; summary: string }
  | { type: 'exportComplete'; outputPath: string }
  | { type: 'configLoaded'; config: DataWranglerConfig };
