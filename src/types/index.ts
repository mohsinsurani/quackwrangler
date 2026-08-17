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
  loadingMode: 'auto' | 'eager' | 'lazy';
  eagerFileSizeLimitMb: number;
  threads: number;
  preserveInsertionOrder: boolean;
}

interface RequestMessage {
  requestId?: string;
}

export type WebviewMessage =
  | ({ type: 'executeCustomQuery'; sql: string } & RequestMessage)
  | ({ type: 'clearCustomQuery' } & RequestMessage)
  | ({ type: 'applyTransform'; transform: TransformOperation } & RequestMessage)
  | ({
      type: 'exportData';
      format: 'parquet' | 'csv' | 'json';
      outputPath?: string;
    } & RequestMessage)
  | ({ type: 'undo' } & RequestMessage)
  | ({ type: 'redo' } & RequestMessage)
  | ({ type: 'pageChange'; offset: number; limit: number } & RequestMessage)
  | ({ type: 'openFilePicker' } & RequestMessage)
  | ({ type: 'openFolderPicker' } & RequestMessage)
  | ({ type: 'selectSecondaryFile' } & RequestMessage)
  | ({ type: 'refresh' } & RequestMessage)
  | ({ type: 'removeTransform'; id: string } & RequestMessage)
  | ({ type: 'reorderTransforms'; sourceId: string; targetId: string } & RequestMessage)
  | ({ type: 'searchRows'; query: string } & RequestMessage)
  | ({ type: 'requestChart'; chart: ChartRequest } & RequestMessage)
  | ({ type: 'getStats' } & RequestMessage)
  | ({ type: 'generateAITransforms' } & RequestMessage)
  | ({ type: 'ready' } & RequestMessage);

interface ResponseContext {
  requestId?: string;
}

interface SessionContext {
  sessionId: string;
  revision: number;
}

export type ExtensionMessage =
  | ({
      type: 'loadingProgress';
      percent: number;
      message: string;
      source: string;
    } & ResponseContext)
  | ({
      type: 'customQueryResult';
      schema: TableSchema;
      result: QueryResult;
      page: PageInfo;
    } & ResponseContext &
      SessionContext)
  | ({
      type: 'searchResult';
      schema: TableSchema;
      result: QueryResult;
      page: PageInfo;
      query: string;
    } & ResponseContext &
      SessionContext)
  | ({ type: 'error'; message: string } & ResponseContext)
  | ({
      type: 'exportComplete';
      outputPath: string;
      status: 'completed' | 'cancelled';
    } & ResponseContext)
  | ({
      type: 'aiComplete';
      status: 'applied' | 'cancelled' | 'discarded' | 'empty';
    } & ResponseContext)
  | ({
      type: 'sessionUpdated';
      protocolVersion: number;
      schema: TableSchema;
      result: QueryResult;
      history: TransformOperation[];
      page: PageInfo;
      canUndo: boolean;
      canRedo: boolean;
    } & ResponseContext &
      SessionContext)
  | ({ type: 'stats'; stats: ColumnStatistics[]; quality: DataQualitySummary } & ResponseContext &
      SessionContext)
  | ({ type: 'chartResult'; chart: ChartRequest; result: QueryResult } & ResponseContext &
      SessionContext)
  | ({ type: 'secondaryFileSelected'; filePath: string; columns: ColumnInfo[] } & ResponseContext);
