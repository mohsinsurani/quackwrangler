import { dirname, join, resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { findDbtProject } from '../../../src/dbt/context';

describe('dbt project detection', () => {
  it('finds an ancestor dbt_project.yml within the active workspace', async () => {
    const workspace = resolve('test-workspace', 'analytics');
    const projectFile = join(workspace, 'dbt_project.yml');
    const exists = vi.fn(async (path: string) => path === projectFile);

    await expect(
      findDbtProject(join(workspace, 'target', 'data.parquet'), workspace, exists),
    ).resolves.toBe(workspace);
  });

  it('does not search above the active workspace boundary', async () => {
    const workspace = resolve('test-workspace', 'analytics');
    const exists = vi.fn(
      async (path: string) => path === join(dirname(workspace), 'dbt_project.yml'),
    );

    await expect(
      findDbtProject(join(workspace, 'data', 'data.parquet'), workspace, exists),
    ).resolves.toBeUndefined();
    expect(exists).not.toHaveBeenCalledWith(join(dirname(workspace), 'dbt_project.yml'));
  });
});
