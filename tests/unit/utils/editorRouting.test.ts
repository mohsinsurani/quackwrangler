import { describe, expect, it } from 'vitest';

import { DATA_EDITOR_VIEW_TYPE, shouldOpenWithDataEditor } from '../../../src/utils/editorRouting';

describe('data editor routing', () => {
  it('routes every supported local format to the default visual editor', () => {
    expect(DATA_EDITOR_VIEW_TYPE).toBe('quackwrangler.dataEditor');
    expect(shouldOpenWithDataEditor('/data/orders.parquet')).toBe(true);
    expect(shouldOpenWithDataEditor('/data/ORDERS.PARQUET')).toBe(true);
    expect(shouldOpenWithDataEditor('/data/orders.csv')).toBe(true);
    expect(shouldOpenWithDataEditor('/data/ORDERS.CSV')).toBe(true);
    expect(shouldOpenWithDataEditor('/data/orders.xlsx')).toBe(true);
    expect(shouldOpenWithDataEditor('/data/ORDERS.XLSX')).toBe(true);
    expect(shouldOpenWithDataEditor('/data/orders.xls')).toBe(true);
    expect(shouldOpenWithDataEditor('/data/orders.tsv')).toBe(true);
    expect(shouldOpenWithDataEditor('/data/orders.json')).toBe(true);
    expect(shouldOpenWithDataEditor('/data/orders.jsonl')).toBe(true);
    expect(shouldOpenWithDataEditor('/data/orders.ndjson')).toBe(true);
    expect(shouldOpenWithDataEditor('/data/orders.ods')).toBe(true);
    expect(shouldOpenWithDataEditor('/data/orders.arrow')).toBe(true);
    expect(shouldOpenWithDataEditor('/data/orders.arrows')).toBe(true);
    expect(shouldOpenWithDataEditor('/data/orders.ipc')).toBe(true);
    expect(shouldOpenWithDataEditor('/data/orders.orc')).toBe(true);
    expect(shouldOpenWithDataEditor('/data/parquet-notes.txt')).toBe(false);
  });
});
