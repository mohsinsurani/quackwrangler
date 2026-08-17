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

  it('rejects the search when the data file is outside the workspace boundary', async () => {
    const workspace = resolve('workspaces', 'analytics');
    const outsideFile = resolve('other', 'project', 'data.parquet');
    const exists = vi.fn(async () => true);

    await expect(
      findDbtProject(outsideFile, workspace, exists),
    ).resolves.toBeUndefined();
    // exists should not be called because the starting directory is outside the boundary.
    expect(exists).not.toHaveBeenCalled();
  });

  it('requires the marker to pass the exists check (caller must verify it is a file)', async () => {
    const workspace = resolve('test-workspace', 'analytics');
    // exists returns false for dbt_project.yml (simulating a directory or unreadable entry).
    const exists = vi.fn(async () => false);

    await expect(
      findDbtProject(join(workspace, 'data.parquet'), workspace, exists),
    ).resolves.toBeUndefined();
  });
});
