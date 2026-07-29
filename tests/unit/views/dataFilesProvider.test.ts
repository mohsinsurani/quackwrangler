import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  directoryEntries: new Map<string, [string, number][]>([
    [
      '/data',
      [
        ['nested', 2],
        ['empty', 2],
        ['world.csv', 1],
        ['notes.md', 1],
      ],
    ],
    [
      '/data/nested',
      [
        ['health.json', 1],
        ['image.png', 1],
      ],
    ],
    ['/data/empty', [['readme.txt', 1]]],
  ]),
}));

vi.mock('vscode', () => ({
  FileType: { File: 1, Directory: 2 },
  Uri: {
    joinPath: (uri: { fsPath: string }, name: string) => ({ fsPath: `${uri.fsPath}/${name}` }),
  },
  workspace: {
    fs: {
      readDirectory: vi.fn(
        async (uri: { fsPath: string }) => mocks.directoryEntries.get(uri.fsPath) ?? [],
      ),
    },
  },
  window: { showOpenDialog: vi.fn() },
  EventEmitter: class {
    event = vi.fn();
    fire = vi.fn();
  },
  TreeItem: class {},
  TreeItemCollapsibleState: { None: 0, Expanded: 2 },
  ThemeIcon: class {},
}));

import { scanDataFolder } from '../../../src/views/dataFilesProvider';

describe('data folder browser', () => {
  beforeEach(() => vi.clearAllMocks());

  it('keeps supported files in their folders and removes empty folders', async () => {
    const nodes = await scanDataFolder({ fsPath: '/data' } as never);

    expect(nodes.map((node) => [node.type, node.uri.fsPath])).toEqual([
      ['folder', '/data/nested'],
      ['file', '/data/world.csv'],
    ]);
    expect(nodes[0].children?.map((node) => node.uri.fsPath)).toEqual([
      '/data/nested/health.json',
    ]);
  });
});
