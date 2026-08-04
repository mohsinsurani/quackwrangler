import { extname } from 'node:path';

export const DATA_EDITOR_VIEW_TYPE = 'quackwrangler.dataEditor';

export function shouldOpenWithDataEditor(filePath: string): boolean {
  return extname(filePath).toLowerCase() === '.parquet';
}
