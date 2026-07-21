import * as fs from 'fs';
import * as path from 'path';

const DATA_FILE_EXTENSIONS = new Set([
  '.parquet',
  '.csv',
  '.tsv',
  '.json',
  '.jsonl',
]);

export function isDataFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return DATA_FILE_EXTENSIONS.has(ext);
}

export function getDataFilePatterns(): string[] {
  return [
    '**/*.parquet',
    '**/*.csv',
    '**/*.tsv',
    '**/*.json',
    '**/*.jsonl',
  ];
}

export async function getFileSize(filePath: string): Promise<number> {
  try {
    const stats = await fs.promises.stat(filePath);
    return stats.size;
  } catch {
    return 0;
  }
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
}
