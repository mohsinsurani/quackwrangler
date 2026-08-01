import * as path from 'path';

export const DATA_FILE_EXTENSIONS = [
  'parquet',
  'csv',
  'tsv',
  'json',
  'jsonl',
  'ndjson',
  'xlsx',
  'ods',
  'arrow',
  'arrows',
  'ipc',
  'orc',
] as const;

const DATA_FILE_EXTENSION_SET = new Set(DATA_FILE_EXTENSIONS.map((extension) => `.${extension}`));

export function isDataFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return DATA_FILE_EXTENSION_SET.has(ext);
}

export function getDataFilePatterns(): string[] {
  return DATA_FILE_EXTENSIONS.map((extension) => `**/*.${extension}`);
}
