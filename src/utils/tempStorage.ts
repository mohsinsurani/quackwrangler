import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';

export interface ManagedTempDirectory {
  path: string;
  cleanup(): Promise<void>;
}

export async function createManagedTempDirectory(
  storageRoot: string,
): Promise<ManagedTempDirectory> {
  const parent = join(storageRoot, 'duckdb-temp');
  await mkdir(parent, { recursive: true });
  const path = await mkdtemp(join(parent, 'session-'));
  let cleaned = false;

  return {
    path,
    async cleanup(): Promise<void> {
      if (cleaned) return;
      cleaned = true;
      await rm(path, { recursive: true, force: true });
    },
  };
}
