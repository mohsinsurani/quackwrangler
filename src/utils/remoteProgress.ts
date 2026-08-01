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

export function createRemoteProgressReporter(
  source: string,
  emit: (progress: RemoteLoadProgress) => void,
): (stage: { percent: number; message: string }) => void {
  const remote = isRemoteDataSource(source);
  return (stage): void => {
    if (remote) emit({ ...stage, source });
  };
}
