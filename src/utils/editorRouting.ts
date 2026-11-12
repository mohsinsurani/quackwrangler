import { extname } from 'node:path';

import { DATA_FILE_EXTENSIONS } from './fileDetector.js';

export const DATA_EDITOR_VIEW_TYPE = 'quackwrangler.dataEditor';
const DEFAULT_DATA_EDITOR_EXTENSIONS = new Set(
  DATA_FILE_EXTENSIONS.map((extension) => `.${extension}`),
);

export function shouldOpenWithDataEditor(filePath: string): boolean {
  return DEFAULT_DATA_EDITOR_EXTENSIONS.has(extname(filePath).toLowerCase());
}
