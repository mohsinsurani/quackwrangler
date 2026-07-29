import fs from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

describe('QuackWrangler custom editor contribution', () => {
  it('registers supported data files with default editor priority', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8'),
    ) as {
      contributes: {
        customEditors: Array<{
          viewType: string;
          priority: string;
          selector: Array<{ filenamePattern: string }>;
        }>;
      };
    };
    const editor = manifest.contributes.customEditors[0];

    expect(editor.viewType).toBe('quackwrangler.dataEditor');
    expect(editor.priority).toBe('default');
    expect(editor.selector.map((item) => item.filenamePattern)).toEqual(
      expect.arrayContaining(['*.csv', '*.tsv', '*.parquet', '*.jsonl', '*.xlsx', '*.ods']),
    );
    expect(editor.selector.map((item) => item.filenamePattern)).not.toContain('*.json');
  });
});
