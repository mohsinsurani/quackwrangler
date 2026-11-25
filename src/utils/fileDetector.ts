import * as path from 'path';

// Databases hold several tables, so they open through a table picker instead of a single reader.
export const DATABASE_FILE_EXTENSIONS = [
  'duckdb',
  'ddb',
  'sqlite',
  'sqlite3',
  'db',
  'db3',
] as const;

export const DATA_FILE_EXTENSIONS = [
  'parquet',
  'csv',
  'tsv',
  'json',
  'jsonl',
  'ndjson',
  'xlsx',
  'xls',
  'ods',
  'arrow',
  'arrows',
  'ipc',
  'orc',
  ...DATABASE_FILE_EXTENSIONS,
] as const;

const DATA_FILE_EXTENSION_SET = new Set(DATA_FILE_EXTENSIONS.map((extension) => `.${extension}`));

const DATABASE_FILE_EXTENSION_SET = new Set<string>(
  DATABASE_FILE_EXTENSIONS.map((extension) => `.${extension}`),
);

export function isDatabaseFile(filePath: string): boolean {
  return DATABASE_FILE_EXTENSION_SET.has(path.extname(filePath).toLowerCase());
}

export function isDataFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return DATA_FILE_EXTENSION_SET.has(ext);
}

export function getDataFilePatterns(): string[] {
  return DATA_FILE_EXTENSIONS.map((extension) => `**/*.${extension}`);
}
