export interface ColumnInfo {
  name: string;
  displayName: string;
  dataType: 'string' | 'number' | 'boolean' | 'date' | 'null' | 'array' | 'object';
  type: string;
  nullable: boolean;
  nullCount: number;
  uniqueCount: number;
  totalRows: number;
}

export interface TransformStep {
  id: string;
  name: string;
  description: string;
  params: Record<string, unknown>;
  timestamp: number;
}

export type ExportFormat = 'parquet' | 'csv' | 'json';

export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'openFilePicker' }
  | { type: 'openFolderPicker' }
  | { type: 'selectSecondaryFile' }
  | { type: 'refresh' }
  | { type: 'getStats' }
  | {
      type: 'applyTransform';
      transform: {
        id: string;
        type: string;
        params: Record<string, unknown>;
        sql: string;
        description: string;
      };
    }
  | { type: 'undo' | 'redo' | 'clearCustomQuery' }
  | { type: 'removeTransform'; id: string }
  | { type: 'reorderTransforms'; sourceId: string; targetId: string }
  | { type: 'pageChange'; offset: number; limit: number }
  | { type: 'searchRows'; query: string }
  | { type: 'executeCustomQuery'; sql: string }
  | {
      type: 'requestChart';
      chart: {
        type: 'histogram' | 'bar' | 'scatter' | 'line' | 'box' | 'correlation';
        xColumn: string;
        yColumn?: string;
        columns?: string[];
        aggregation?: 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX';
      };
    }
  | { type: 'exportData'; format: ExportFormat; outputPath?: string };

export interface ExtensionMessage {
  type: string;
  [key: string]: unknown;
}
