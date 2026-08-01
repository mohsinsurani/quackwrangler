import { describe, expect, it, vi } from 'vitest';

import {
  createRemoteProgressReporter,
  isRemoteDataSource,
  REMOTE_LOAD_STAGES,
} from '../../../src/utils/remoteProgress.js';

describe('remote loading progress', () => {
  it('recognizes supported remote source schemes', () => {
    expect(isRemoteDataSource('https://example.com/data.parquet')).toBe(true);
    expect(isRemoteDataSource('http://example.com/data.csv')).toBe(true);
    expect(isRemoteDataSource('s3://bucket/data.json')).toBe(true);
    expect(isRemoteDataSource('/tmp/data.parquet')).toBe(false);
  });

  it('reports monotonic stages with the remote source', () => {
    const emit = vi.fn();
    const report = createRemoteProgressReporter('https://example.com/data.parquet', emit);

    Object.values(REMOTE_LOAD_STAGES).forEach(report);

    const updates = emit.mock.calls.map(([update]) => update);
    expect(updates.map((update) => update.percent)).toEqual([5, 15, 35, 85, 100]);
    expect(updates.every((update) => update.source === 'https://example.com/data.parquet')).toBe(
      true,
    );
  });

  it('does not display remote progress for local files', () => {
    const emit = vi.fn();
    const report = createRemoteProgressReporter('/tmp/data.parquet', emit);
    report(REMOTE_LOAD_STAGES.connecting);
    expect(emit).not.toHaveBeenCalled();
  });
});
