import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../../..');

describe('platform-specific Marketplace packaging', () => {
  it('guards local packaging and covers every supported DuckDB desktop target', () => {
    const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    const workflow = readFileSync(
      path.join(root, '.github/workflows/package-platforms.yml'),
      'utf8',
    );

    expect(manifest.scripts.package).toBe('node scripts/vsce-platform.mjs package');
    expect(manifest.scripts['publish:marketplace']).toBe(
      'node scripts/vsce-platform.mjs publish',
    );
    expect(manifest.devDependencies['@vscode/vsce']).toBeTruthy();

    for (const target of [
      'win32-x64',
      'win32-arm64',
      'linux-x64',
      'linux-arm64',
      'alpine-x64',
      'alpine-arm64',
      'darwin-x64',
      'darwin-arm64',
    ]) {
      expect(workflow).toContain(`target: ${target}`);
    }
  });
});
