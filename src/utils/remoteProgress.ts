export interface RemoteLoadProgress {
  percent: number;
  message: string;
  source: string;
}

export const REMOTE_LOAD_STAGES = {
  connecting: { percent: 5, message: 'Starting remote connection' },
  preparing: { percent: 15, message: 'Preparing secure remote reader' },
  reading: { percent: 35, message: 'Reading remote file' },
  previewing: { percent: 85, message: 'Preparing preview and schema' },
  ready: { percent: 100, message: 'Remote data ready' },
} as const;

export function isRemoteDataSource(source: string): boolean {
  return /^(https?|s3):\/\//i.test(source);
}

export interface RemoteProgressReporter {
  (stage: { percent: number; message: string }): void;
  /** Stops the slow-load reminder. Call when loading ends, whether it succeeded or failed. */
  stop(): void;
}

export const SLOW_LOAD_HINT = 'still working, large remote files can take a while';

/**
 * Reports staged progress for remote sources. Some remote files (for example a Parquet file stored
 * as one large block) give no rows until a lot of data has downloaded, so a stage can sit still for
 * many seconds. While a stage is taking long, the last message is repeated with a reminder so the
 * editor does not look frozen. Local files report nothing.
 */
export function createRemoteProgressReporter(
  source: string,
  emit: (progress: RemoteLoadProgress) => void,
  slowAfterMs = 5000,
): RemoteProgressReporter {
  const remote = isRemoteDataSource(source);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let last: { percent: number; message: string } | undefined;

  const stop = (): void => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  };
  const arm = (): void => {
    stop();
    timer = setTimeout(() => {
      if (!last) return;
      emit({ ...last, message: `${last.message} · ${SLOW_LOAD_HINT}`, source });
      arm();
    }, slowAfterMs);
  };

  const report = ((stage): void => {
    if (!remote) return;
    last = stage;
    emit({ ...stage, source });
    if (stage.percent >= 100) stop();
    else arm();
  }) as RemoteProgressReporter;
  report.stop = stop;
  return report;
}
