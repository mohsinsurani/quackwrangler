export type DataType = 'string' | 'number' | 'boolean' | 'date' | 'null' | 'array' | 'object';

export interface ColumnInfo {
  name: string;
  displayName: string;
  dataType: DataType;
  nullable: boolean;
  nullCount: number;
  uniqueCount: number;
  totalRows: number;
  stats?: ColumnStats;
}

export interface ColumnStats {
  min?: number | string;
  max?: number | string;
  mean?: number;
  std?: number;
  median?: number;
  p25?: number;
  p75?: number;
  topValues?: Array<{ value: string; count: number }>;
  histogram?: Array<{ binStart: number; binEnd: number; count: number }>;
}

export interface TableRow {
  _id: number;
  [key: string]: unknown;
}

export interface DataFrameInfo {
  name: string;
  fileName: string;
  filePath: string;
  rowCount: number;
  columnCount: number;
  columns: ColumnInfo[];
  sizeBytes: number;
  preview: TableRow[];
}

export type FilterOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'not_contains'
  | 'greater_than'
  | 'greater_equals'
  | 'less_than'
  | 'less_equals'
  | 'between'
  | 'is_null'
  | 'is_not_null'
  | 'starts_with'
  | 'ends_with';

export interface Filter {
  id: string;
  column: string;
  operator: FilterOperator;
  value: string | number | [number, number];
  enabled: boolean;
}

export interface FilterState {
  filters: Filter[];
  appliedFilters: Filter[];
}

export interface TransformStep {
  id: string;
  name: string;
  description: string;
  params: Record<string, unknown>;
  timestamp: number;
  preview?: TransformPreview;
}

export interface TransformPreview {
  addedColumns: string[];
  removedColumns: string[];
  addedRows: number;
  removedRows: number;
  changedCells: number;
  sampleBefore?: TableRow[];
  sampleAfter?: TableRow[];
}

export type TransformType =
  | 'rename_column'
  | 'drop_column'
  | 'add_column'
  | 'filter_rows'
  | 'sort_rows'
  | 'fill_nulls'
  | 'cast_type'
  | 'deduplicate'
  | 'merge_columns'
  | 'split_column'
  | 'aggregate'
  | 'pivot'
  | 'unpivot';

export interface TransformDefinition {
  type: TransformType;
  name: string;
  description: string;
  parameters: TransformParameter[];
}

export interface TransformParameter {
  name: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'multiselect' | 'column';
  required: boolean;
  options?: Array<{ label: string; value: string }>;
  dependsOn?: string;
  defaultValue?: unknown;
}

export type ExportFormat = 'parquet' | 'csv' | 'json' | 'sql' | 'excel';

export interface ExportConfig {
  format: ExportFormat;
  destination: 'file' | 'notebook';
  includeHeaders: boolean;
  delimiter?: string;
  encoding?: string;
  sqlTableName?: string;
}

export type ViewTab = 'data' | 'transform' | 'export';

export type SortDirection = 'asc' | 'desc';

export interface SortState {
  column: string;
  direction: SortDirection;
}

export interface WebviewMessage {
  type: string;
  payload: unknown;
}

export interface ExtensionMessage {
  type: string;
  payload: unknown;
}

export interface RequestMessage extends WebviewMessage {
  requestId: string;
}

export interface ResponseMessage extends ExtensionMessage {
  requestId: string;
  error?: string;
}

export interface AppState {
  isLoading: boolean;
  error: string | null;
  dataFrame: DataFrameInfo | null;
  rows: TableRow[];
  columns: ColumnInfo[];
  filters: FilterState;
  sort: SortState | null;
  selectedRows: Set<number>;
  expandedCell: { rowId: number; column: string } | null;
  transformSteps: TransformStep[];
  activeTab: ViewTab;
  exportConfig: ExportConfig;
}
