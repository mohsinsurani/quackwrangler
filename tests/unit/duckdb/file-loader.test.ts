import { describe, expect, it, vi } from 'vitest';
import {
  detectFileType,
  getTableRef,
  prepareDataFileReader,
} from '../../../src/duckdb/parquet-loader';

describe('data file readers', () => {
  it('maps local and remote Arrow IPC sources to read_arrow', () => {
    expect(detectFileType('/tmp/events.arrow')).toBe('arrow');
    expect(detectFileType('https://example.com/events.ipc?token=hidden')).toBe('arrow');
    expect(getTableRef('/tmp/events.arrows')).toBe("read_arrow('/tmp/events.arrows')");
  });

  it('prepares signed nanoarrow and httpfs extensions for remote Arrow', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await prepareDataFileReader({ query } as never, 'https://example.com/events.arrow');
    expect(query.mock.calls.map((call) => call[0])).toEqual([
      'INSTALL httpfs',
      'LOAD httpfs',
      'INSTALL nanoarrow FROM community',
      'LOAD nanoarrow',
    ]);
  });

  it('gives an actionable ORC compatibility error', async () => {
    await expect(
      prepareDataFileReader({ query: vi.fn() } as never, '/tmp/events.orc'),
    ).rejects.toThrow('no supported ORC reader');
  });
});
