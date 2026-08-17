import { extname } from 'node:path';

export const DATA_EDITOR_VIEW_TYPE = 'quackwrangler.dataEditor';
const DEFAULT_DATA_EDITOR_EXTENSIONS = new Set(['.parquet', '.csv', '.xlsx']);

export function shouldOpenWithDataEditor(filePath: string): boolean {
  return DEFAULT_DATA_EDITOR_EXTENSIONS.has(extname(filePath).toLowerCase());
}
