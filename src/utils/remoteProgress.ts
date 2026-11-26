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

// Query parameters that carry credentials: AWS and Google signed URLs, Azure SAS tokens, and the
// usual token, key, and password names.
const SECRET_PARAMETER =
  /sig|token|secret|passw|pwd|auth|credential|api[-_]?key|^key$|^x-amz-|^x-goog-|^(sv|sp|se|sr|st|spr|skoid|sktid)$/i;

export const REDACTED_VALUE = 'REDACTED';

/**
 * Replaces credentials in a remote address (a user name and password, and the values of signing or
 * token query parameters) so it can be shown, logged, or stored. Local paths are returned as given.
 */
export function redactRemoteSource(source: string): string {
  if (!isRemoteDataSource(source)) return source;
  try {
    const url = new URL(source);
    let changed = false;
    if (url.username || url.password) {
      url.username = '';
      url.password = '';
      changed = true;
    }
    for (const name of [...url.searchParams.keys()]) {
      if (SECRET_PARAMETER.test(name)) {
        url.searchParams.set(name, REDACTED_VALUE);
        changed = true;
      }
    }
    return changed ? url.toString().replace(/\/\/\/(?=\w)/, '//') : source;
  } catch {
    return source.replace(/\?.*$/, '?REDACTED');
  }
}

/** True when the address holds credentials, so it must not be saved or shared as is. */
export function remoteSourceHasSecrets(source: string): boolean {
  return redactRemoteSource(source) !== source;
}

/** Redacts every remote address found inside free text such as an error message. */
export function redactRemoteText(text: string): string {
  return text.replace(/(?:https?|s3):\/\/[^\s'"`)]+/gi, (match) => redactRemoteSource(match));
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
  // The progress bar shows the address, so it must never carry a signed token.
  const shown = redactRemoteSource(source);
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
      emit({ ...last, message: `${last.message} · ${SLOW_LOAD_HINT}`, source: shown });
      arm();
    }, slowAfterMs);
  };

  const report = ((stage): void => {
    if (!remote) return;
    last = stage;
    emit({ ...stage, source: shown });
    if (stage.percent >= 100) stop();
    else arm();
  }) as RemoteProgressReporter;
  report.stop = stop;
  return report;
}
