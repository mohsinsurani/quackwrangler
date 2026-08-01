import { describe, expect, it } from 'vitest';
import {
  calculateAutoFitWidth,
  formatCellDetails,
  formatCellValue,
  serializeRow,
  serializeRows,
} from '../../../webview-ui/src/components/DataGrid';
import {
  nestedJsonPointer,
  nestedValueLabel,
} from '../../../webview-ui/src/components/NestedValueTree';

describe('nested data grid values', () => {
  it('auto-fits columns to loaded content within practical limits', () => {
    expect(calculateAutoFitWidth(['Year', 2022])).toBe(110);
    expect(
      calculateAutoFitWidth(['TopScorer', 'Wesley Sneijder, Thomas Müller — 5']),
    ).toBeGreaterThan(250);
    expect(calculateAutoFitWidth(['x'.repeat(200)])).toBe(600);
  });

  it('renders structs as JSON instead of object coercion', () => {
    const value = { distance: { type: 'METERS', value: 2961.677978515625 } };

    expect(formatCellValue(value)).toBe('{"distance":{"type":"METERS","value":2961.677978515625}}');
    expect(formatCellValue(value)).not.toContain('[object Object]');
    expect(formatCellDetails(value)).toContain('"type": "METERS"');
  });

  it('labels arrays and safely serializes maps and big integers', () => {
    const value = [{ metadata: new Map([['version', 2n]]) }];

    expect(formatCellValue(value)).toBe('1 item · [{"metadata":{"version":"2"}}]');
  });

  it('creates copyable RFC 6901-style paths for nested values', () => {
    expect(nestedJsonPointer(['metadata', 'source/name', 0, '~version'])).toBe(
      '/metadata/source~1name/0/~0version',
    );
    expect(nestedValueLabel([1, 2, 3])).toBe('Array(3)');
    expect(nestedValueLabel({ source: 'official' })).toBe('Object(1)');
  });

  it('copies rows as spreadsheet-friendly TSV by default', () => {
    expect(serializeRow(['Brazil', 2022, 'Kylian Mbappé, 8'], 'tsv')).toBe(
      'Brazil\t2022\tKylian Mbappé, 8',
    );
  });

  it('escapes commas, quotes, and newlines in CSV rows', () => {
    expect(serializeRow(['a,b', 'He said "hi"', 'line\nbreak'], 'csv')).toBe(
      '"a,b","He said ""hi""","line\nbreak"',
    );
  });

  it('supports pipe-separated and JSON row copies', () => {
    const row = ['Brazil', 2022, { source: 'official' }];
    expect(serializeRow(row, 'pipe')).toBe('Brazil | 2022 | "{""source"":""official""}"');
    expect(serializeRow(row, 'json')).toBe('["Brazil",2022,{"source":"official"}]');
    expect(serializeRow(['A | B', 1], 'pipe')).toBe('"A | B" | 1');
  });

  it('copies multiple delimited rows with optional headers', () => {
    const columns = [
      { name: 'country', type: 'VARCHAR' },
      { name: 'year', type: 'BIGINT' },
    ];
    const rows = [
      ['Brazil', 2022],
      ['France', 2018],
    ];

    expect(serializeRows(rows, columns, 'csv', true)).toBe(
      'country,year\nBrazil,2022\nFrance,2018',
    );
    expect(serializeRows(rows, columns, 'pipe', false)).toBe('Brazil | 2022\nFrance | 2018');
  });

  it('copies selected rows as named JSON objects when headers are included', () => {
    const columns = [
      { name: 'country', type: 'VARCHAR' },
      { name: 'metadata', type: 'STRUCT' },
    ];
    const rows = [['Brazil', { source: 'official' }]];

    expect(serializeRows(rows, columns, 'json', true)).toBe(
      '[\n  {\n    "country": "Brazil",\n    "metadata": {\n      "source": "official"\n    }\n  }\n]',
    );
    expect(serializeRows(rows, columns, 'json', false)).toBe(
      '[\n  [\n    "Brazil",\n    {\n      "source": "official"\n    }\n  ]\n]',
    );
  });
});
