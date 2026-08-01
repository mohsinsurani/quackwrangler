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
  rows: unknown[][];
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
  p50?: number;
  p90?: number;
  p99?: number;
}

export type ChartType = 'histogram' | 'bar' | 'scatter' | 'line' | 'box' | 'correlation';

export interface ChartRequest {
  type: ChartType;
  xColumn: string;
  yColumn?: string;
  aggregation?: 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX';
  columns?: string[];
}

export interface DataQualitySummary {
  duplicateRows: number;
  issues: Array<{
    severity: 'warning' | 'info';
    kind: 'nulls' | 'duplicates' | 'outliers';
    message: string;
    column?: string;
    count: number;
  }>;
}

export interface PageInfo {
  offset: number;
  limit: number;
  totalRows: number;
}

export interface TransformOperation {
  id: string;
  type: string;
  params: Record<string, unknown>;
  sql: string;
  description: string;
}

export interface DataWranglerConfig {
  memoryLimit: string;
  tempDirectory: string;
  maxTempDirectorySize: string;
  autoLoadExtensions: boolean | string[];
  pageSize: number;
  maxRowsPreview: number;
}

export type WebviewMessage =
  | { type: 'executeCustomQuery'; sql: string }
  | { type: 'clearCustomQuery' }
  | { type: 'applyTransform'; transform: TransformOperation }
  | { type: 'exportData'; format: 'parquet' | 'csv' | 'json'; outputPath?: string }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'pageChange'; offset: number; limit: number }
  | { type: 'openFilePicker' }
  | { type: 'openFolderPicker' }
  | { type: 'selectSecondaryFile' }
  | { type: 'refresh' }
  | { type: 'removeTransform'; id: string }
  | { type: 'reorderTransforms'; sourceId: string; targetId: string }
  | { type: 'searchRows'; query: string }
  | { type: 'requestChart'; chart: ChartRequest }
  | { type: 'getStats' }
  | { type: 'ready' };

export type ExtensionMessage =
  | { type: 'loadingProgress'; percent: number; message: string; source: string }
  | { type: 'customQueryResult'; schema: TableSchema; result: QueryResult; page: PageInfo }
  | {
      type: 'searchResult';
      schema: TableSchema;
      result: QueryResult;
      page: PageInfo;
      query: string;
    }
  | { type: 'error'; message: string }
  | { type: 'exportComplete'; outputPath: string }
  | {
      type: 'sessionUpdated';
      protocolVersion: number;
      schema: TableSchema;
      result: QueryResult;
      history: TransformOperation[];
      page: PageInfo;
    }
  | { type: 'stats'; stats: ColumnStatistics[]; quality: DataQualitySummary }
  | { type: 'chartResult'; chart: ChartRequest; result: QueryResult }
  | { type: 'secondaryFileSelected'; filePath: string; columns: ColumnInfo[] };
