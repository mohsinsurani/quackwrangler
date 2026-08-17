import { describe, expect, it } from 'vitest';

import { DATA_EDITOR_VIEW_TYPE, shouldOpenWithDataEditor } from '../../../src/utils/editorRouting';

describe('data editor routing', () => {
  it('routes local Parquet, CSV, and XLSX paths to the default visual editor', () => {
    expect(DATA_EDITOR_VIEW_TYPE).toBe('quackwrangler.dataEditor');
    expect(shouldOpenWithDataEditor('/data/orders.parquet')).toBe(true);
    expect(shouldOpenWithDataEditor('/data/ORDERS.PARQUET')).toBe(true);
    expect(shouldOpenWithDataEditor('/data/orders.csv')).toBe(true);
    expect(shouldOpenWithDataEditor('/data/ORDERS.CSV')).toBe(true);
    expect(shouldOpenWithDataEditor('/data/orders.xlsx')).toBe(true);
    expect(shouldOpenWithDataEditor('/data/ORDERS.XLSX')).toBe(true);
    expect(shouldOpenWithDataEditor('/data/orders.json')).toBe(false);
    expect(shouldOpenWithDataEditor('/data/parquet-notes.txt')).toBe(false);
  });
});
