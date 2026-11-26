import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createRemoteProgressReporter,
  isRemoteDataSource,
  redactRemoteSource,
  redactRemoteText,
  remoteSourceHasSecrets,
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

  describe('credential redaction', () => {
    it.each([
      [
        'https://b.s3.amazonaws.com/a.parquet?X-Amz-Signature=abc&X-Amz-Credential=AKIA%2Fx&X-Amz-Expires=300',
        ['abc', 'AKIA'],
      ],
      ['https://acct.blob.core.windows.net/c/a.csv?sv=2023&sig=zzz&se=2030', ['zzz', '2023']],
      ['https://user:hunter2@example.com/a.csv', ['hunter2', 'user@']],
      ['https://example.com/a.csv?api_key=SECRET&id=7', ['SECRET']],
      ['https://example.com/a.csv?access_token=tok-value&page=2', ['tok-value']],
    ])('removes the secret parts of %s', (address, secrets) => {
      expect(remoteSourceHasSecrets(address)).toBe(true);
      const safe = redactRemoteSource(address);
      for (const secret of secrets) expect(safe).not.toContain(secret);
      expect(safe).toMatch(/^https:\/\/(?:b\.s3|acct\.blob|example)/);
    });

    it('leaves ordinary query parameters and local paths alone', () => {
      for (const address of [
        'https://example.com/a.csv?download=1&page=2',
        'https://example.com/a.csv',
        's3://bucket/key.parquet',
        '/tmp/local.csv?token=x',
        'C:\\data\\a.csv',
      ]) {
        expect(remoteSourceHasSecrets(address)).toBe(false);
        expect(redactRemoteSource(address)).toBe(address);
      }
    });

    it('redacts every address inside an error message', () => {
      const text =
        "HTTP GET error on 'https://x.com/a.csv?token=abc' (HTTP 403) and 'https://y.com/b.csv?sig=def'";
      const safe = redactRemoteText(text);
      expect(safe).not.toContain('abc');
      expect(safe).not.toContain('def');
      expect(safe).toContain('(HTTP 403)');
    });

    it('never puts a signed token in the progress shown to the user', () => {
      const emit = vi.fn();
      const report = createRemoteProgressReporter(
        'https://b.s3.amazonaws.com/a.parquet?X-Amz-Signature=topsecret',
        emit,
      );
      Object.values(REMOTE_LOAD_STAGES).forEach(report);
      for (const [update] of emit.mock.calls) expect(update.source).not.toContain('topsecret');
    });
  });
});
