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

export interface DatabaseTable {
  schema: string;
  name: string;
  view: boolean;
}

export interface DatabaseInfo {
  kind: 'duckdb' | 'sqlite';
  tables: DatabaseTable[];
  selected: DatabaseTable;
  textColumns: boolean;
}

export type ExportFormat = 'parquet' | 'csv' | 'json';

export type WebviewMessage = (
  | { type: 'ready' }
  | { type: 'openFilePicker' }
  | { type: 'openFolderPicker' }
  | { type: 'selectSecondaryFile' }
  | { type: 'refresh' }
  | { type: 'selectTable'; schema: string; name: string }
  | { type: 'getStats' }
  | { type: 'generateAITransforms' }
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
  | {
      type: 'searchRows';
      query: string;
      filter?: { column: string; operator: 'is_null' | 'is_not_null' };
    }
  | { type: 'searchChange'; query: string }
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
  | {
      type: 'exportData';
      format: ExportFormat;
      outputPath?: string;
      sessionId: string;
      revision: number;
      customQuerySql: string | null;
    }
  | { type: 'saveRecipe' }
  | { type: 'openRecipePicker' }
  | { type: 'replayRecipe'; filePath?: string }
  | {
      type: 'polarsHandoff';
      mode: 'result' | 'recipe';
      sessionId: string;
      revision: number;
      customQuerySql: string | null;
    }
) & { requestId?: string };

export interface ExtensionMessage {
  type: string;
  [key: string]: unknown;
}
