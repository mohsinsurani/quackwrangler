import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createRemoteProgressReporter,
  isRemoteDataSource,
  REMOTE_LOAD_STAGES,
  SLOW_LOAD_HINT,
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

  describe('slow remote reads', () => {
    afterEach(() => vi.useRealTimers());

    it('repeats the current stage with a reminder while a stage takes long', () => {
      vi.useFakeTimers();
      const emit = vi.fn();
      const report = createRemoteProgressReporter('s3://bucket/big.parquet', emit, 5000);
      report(REMOTE_LOAD_STAGES.reading);
      expect(emit).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(5000);
      expect(emit).toHaveBeenCalledTimes(2);
      expect(emit.mock.calls[1][0]).toMatchObject({
        percent: 35,
        message: `Reading remote file · ${SLOW_LOAD_HINT}`,
        source: 's3://bucket/big.parquet',
      });

      vi.advanceTimersByTime(5000);
      expect(emit).toHaveBeenCalledTimes(3);
      report.stop();
    });

    it('does not add a reminder when the stage finishes quickly', () => {
      vi.useFakeTimers();
      const emit = vi.fn();
      const report = createRemoteProgressReporter('https://example.com/a.csv', emit, 5000);
      report(REMOTE_LOAD_STAGES.reading);
      vi.advanceTimersByTime(4000);
      report(REMOTE_LOAD_STAGES.previewing);
      vi.advanceTimersByTime(4000);
      expect(emit.mock.calls.map(([update]) => update.percent)).toEqual([35, 85]);
      report.stop();
    });

    it('stops reminding once loading is complete', () => {
      vi.useFakeTimers();
      const emit = vi.fn();
      const report = createRemoteProgressReporter('https://example.com/a.csv', emit, 5000);
      report(REMOTE_LOAD_STAGES.reading);
      report(REMOTE_LOAD_STAGES.ready);
      vi.advanceTimersByTime(60000);
      expect(emit.mock.calls.map(([update]) => update.percent)).toEqual([35, 100]);
    });

    it('stops reminding when loading fails and stop() is called', () => {
      vi.useFakeTimers();
      const emit = vi.fn();
      const report = createRemoteProgressReporter('https://example.com/a.csv', emit, 5000);
      report(REMOTE_LOAD_STAGES.reading);
      report.stop();
      vi.advanceTimersByTime(60000);
      expect(emit).toHaveBeenCalledTimes(1);
    });

    it('never schedules a reminder for local files', () => {
      vi.useFakeTimers();
      const emit = vi.fn();
      const report = createRemoteProgressReporter('/tmp/data.parquet', emit, 5000);
      report(REMOTE_LOAD_STAGES.reading);
      vi.advanceTimersByTime(60000);
      expect(emit).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});
