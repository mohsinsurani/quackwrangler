import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createManagedTempDirectory } from '../../../src/utils/tempStorage';

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe('managed DuckDB temporary storage', () => {
  it('creates a unique session directory below the supplied writable storage root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'quackwrangler-storage-test-'));
    try {
      const directory = await createManagedTempDirectory(root);

      expect(directory.path.startsWith(join(root, 'duckdb-temp', 'session-'))).toBe(true);
      expect(await exists(directory.path)).toBe(true);

      await directory.cleanup();
      await directory.cleanup();
      expect(await exists(directory.path)).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
