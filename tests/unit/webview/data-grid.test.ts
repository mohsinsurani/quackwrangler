import { describe, expect, it } from 'vitest';
import { formatCellDetails, formatCellValue } from '../../../webview-ui/src/components/DataGrid';

describe('nested data grid values', () => {
  it('renders structs as JSON instead of object coercion', () => {
    const value = { distance: { type: 'METERS', value: 2961.677978515625 } };

    expect(formatCellValue(value)).toBe(
      '{"distance":{"type":"METERS","value":2961.677978515625}}',
    );
    expect(formatCellValue(value)).not.toContain('[object Object]');
    expect(formatCellDetails(value)).toContain('"type": "METERS"');
  });

  it('labels arrays and safely serializes maps and big integers', () => {
    const value = [{ metadata: new Map([['version', 2n]]) }];

    expect(formatCellValue(value)).toBe('1 item · [{"metadata":{"version":"2"}}]');
  });
});
