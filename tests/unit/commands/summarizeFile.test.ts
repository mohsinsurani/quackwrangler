import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const posted: Array<Record<string, unknown>> = [];
  const panel = {
    filePath: undefined as string | undefined,
    postMessage: vi.fn((message: Record<string, unknown>) => posted.push(message)),
    setMessageHandler: vi.fn(),
  };
  return {
    posted,
    panel,
    showWarningMessage: vi.fn(),
    showInformationMessage: vi.fn(),
    showErrorMessage: vi.fn(),
  };
});

vi.mock('vscode', () => ({
  commands: { executeCommand: vi.fn() },
  Uri: { file: (fsPath: string) => ({ fsPath }) },
  window: {
    createOutputChannel: vi.fn(() => ({ appendLine: vi.fn() })),
    showWarningMessage: mocks.showWarningMessage,
    showInformationMessage: mocks.showInformationMessage,
    showErrorMessage: mocks.showErrorMessage,
  },
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: vi.fn((key: string, fallback: unknown) =>
        key === 'duckdb.tempDirectory'
          ? `${process.env.RUNNER_TEMP ?? process.env.TMPDIR ?? process.env.TEMP ?? '/tmp'}/quackwrangler-summarize-flow`
          : fallback,
      ),
    })),
    getWorkspaceFolder: vi.fn(),
  },
  extensions: { getExtension: vi.fn() },
  ProgressLocation: { Notification: 15 },
  FileType: { File: 1, Directory: 2 },
}));

vi.mock('../../../src/duckdb/connection.js', () => ({
  DuckDBConnection: class {
    isConnected(): boolean {
      return true;
    }
    async connect(): Promise<void> {}
  },
}));

vi.mock('../../../src/duckdb/parquet-loader.js', () => ({
  loadFile: vi.fn().mockResolvedValue(undefined),
  prepareDataFileReader: vi.fn(),
  getFileMetadata: vi.fn(),
}));

vi.mock('../../../src/dbt/context.js', () => ({ findDbtProject: vi.fn() }));

vi.mock('../../../src/transforms/pipeline.js', () => ({
  WranglingSession: class {
    load(): void {}
    getHistory(): unknown[] {
      return [];
    }
    canUndo(): boolean {
      return false;
    }
    canRedo(): boolean {
      return false;
    }
    getRevision(): number {
      return 7;
    }
    getSql(): string {
      return 'SELECT * FROM "panel_relation"';
    }
    getFilePath(): string {
      return '/data/summary.parquet';
    }
    async getStatistics(): Promise<unknown[]> {
      return [{ name: 'value', type: 'BIGINT', nullCount: 0, distinctCount: 3 }];
    }
    async getQualitySummary(): Promise<unknown> {
      return { duplicateRows: 0, issues: [] };
    }
    async getPage(): Promise<unknown> {
      return {
        schema: { columns: [], rowCount: 0, filePath: '/data/summary.parquet' },
        result: { columns: [], rows: [], rowCount: 0 },
        page: { offset: 0, limit: 100, totalRows: 0 },
      };
    }
  },
}));

vi.mock('../../../src/webview/provider.js', () => ({
  DataWranglerPanel: {
    attach: vi.fn(() => mocks.panel),
    currentPanel: mocks.panel,
  },
}));

import {
  configureCommands,
  openDataWranglerCustomEditor,
  summarizeFileCommand,
} from '../../../src/commands';

describe('summarizeFileCommand host push', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.posted.length = 0;
    configureCommands(
      { fsPath: '/extension' } as never,
      { appendLine: vi.fn() } as never,
      {
        globalStorageUri: { fsPath: '/writable/global-storage' },
        globalState: { get: vi.fn(() => []), update: vi.fn() },
      } as never,
    );
  });

  it('posts a stats message that carries session identity but no request ID', async () => {
    await openDataWranglerCustomEditor(
      { fsPath: '/data/summary.parquet' } as never,
      {} as never,
    );

    mocks.posted.length = 0;
    await summarizeFileCommand();

    const stats = mocks.posted.find((message) => message.type === 'stats');
    expect(stats).toBeDefined();
    expect(stats).toEqual(
      expect.objectContaining({
        type: 'stats',
        revision: 7,
        sessionId: expect.stringMatching(/^qw_[0-9a-f]{16}$/),
      }),
    );
    // Host-initiated pushes must not fabricate a requestId; the webview accepts
    // them when absent and rejects only when a stale requestId is present.
    expect((stats as Record<string, unknown>).requestId).toBeUndefined();
  });
});
