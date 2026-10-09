import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const posted: unknown[] = [];
  const panel = {
    filePath: undefined as string | undefined,
    postMessage: vi.fn((message: unknown) => posted.push(message)),
    setMessageHandler: vi.fn(),
  };
  return {
    posted,
    panel,
    executeCommand: vi.fn().mockResolvedValue(undefined),
    showOpenDialog: vi.fn(),
    showQuickPick: vi.fn(),
    showWarningMessage: vi.fn(),
    showErrorMessage: vi.fn(),
    readDirectory: vi.fn(),
    loadFile: vi.fn().mockResolvedValue(undefined),
    prepareDataFileReader: vi.fn().mockResolvedValue(undefined),
    exportResults: vi.fn().mockResolvedValue(undefined),
    attach: vi.fn(() => panel),
    appendLine: vi.fn(),
  };
});

vi.mock('vscode', () => ({
  commands: { executeCommand: mocks.executeCommand },
  Uri: {
    file: (fsPath: string) => ({ fsPath }),
    joinPath: (base: { fsPath: string }, name: string) => ({
      fsPath: `${base.fsPath}/${name}`,
    }),
  },
  window: {
    createOutputChannel: vi.fn(() => ({ appendLine: vi.fn() })),
    showOpenDialog: mocks.showOpenDialog,
    showQuickPick: mocks.showQuickPick,
    showWarningMessage: mocks.showWarningMessage,
    showErrorMessage: mocks.showErrorMessage,
  },
  workspace: {
    fs: { readDirectory: mocks.readDirectory },
    getConfiguration: vi.fn(() => ({
      get: vi.fn((key: string, fallback: unknown) =>
        key === 'duckdb.tempDirectory'
          ? `${process.env.RUNNER_TEMP ?? process.env.TMPDIR ?? process.env.TEMP ?? '/tmp'}/quackwrangler-panel-flow`
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
    async query(sql: string): Promise<unknown> {
      if (sql.startsWith('DESCRIBE')) {
        return { columns: [], rows: [['value', 'BIGINT', 'NO']], rowCount: 1, duration: 0 };
      }
      if (sql.includes('COUNT(*)')) {
        return { columns: ['count'], rows: [[1]], rowCount: 1, duration: 0 };
      }
      return { columns: ['value'], rows: [[1]], rowCount: 1, duration: 0 };
    }
  },
}));

vi.mock('../../../src/duckdb/query-engine.js', () => ({
  normalizeReadOnlyQuery: (sql: string) => sql.trim(),
  exportResults: mocks.exportResults,
}));

vi.mock('../../../src/duckdb/parquet-loader.js', () => ({
  loadFile: mocks.loadFile,
  prepareDataFileReader: mocks.prepareDataFileReader,
  getFileMetadata: vi.fn(),
}));

vi.mock('../../../src/dbt/context.js', () => ({ findDbtProject: vi.fn() }));

vi.mock('../../../src/transforms/pipeline.js', () => ({
  WranglingSession: class {
    private filePath = '';
    load(filePath: string): void {
      this.filePath = filePath;
    }
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
      return 1;
    }
    getSql(): string {
      return 'SELECT * FROM "panel_relation"';
    }
    getFilePath(): string {
      return this.filePath;
    }
    async getPage(offset: number, limit: number): Promise<unknown> {
      return {
        schema: {
          columns: [{ name: 'value', type: 'BIGINT', nullable: false }],
          rowCount: 1,
          filePath: this.filePath,
        },
        result: { columns: ['value'], rows: [[1]], rowCount: 1 },
        page: { offset, limit, totalRows: 1 },
      };
    }
  },
}));

vi.mock('../../../src/webview/provider.js', () => ({
  DataWranglerPanel: {
    attach: mocks.attach,
    currentPanel: undefined,
  },
}));

import { configureCommands, openDataWranglerCustomEditor } from '../../../src/commands';

function latestMessageHandler(): (message: Record<string, unknown> & { type: string }) => Promise<void> {
  const callback = mocks.panel.setMessageHandler.mock.calls.at(-1)?.[0];
  if (!callback) throw new Error('Expected the panel message handler to be registered');
  return callback;
}

describe('custom-editor file opening flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.posted.length = 0;
    configureCommands(
      { fsPath: '/extension' } as never,
      { appendLine: mocks.appendLine } as never,
      {
        globalStorageUri: { fsPath: '/writable/global-storage' },
        globalState: { get: vi.fn(() => []), update: vi.fn() },
      } as never,
    );
  });

  it('loads a directly clicked Parquet document and posts its first grid page', async () => {
    await openDataWranglerCustomEditor(
      { fsPath: '/data/direct.parquet' } as never,
      {} as never,
    );

    expect(mocks.loadFile).toHaveBeenCalledWith(
      expect.anything(),
      '/data/direct.parquet',
      'auto',
      64,
      expect.stringMatching(/^qw_[0-9a-f]{16}$/),
    );
    expect(mocks.posted).toContainEqual(
      expect.objectContaining({
        type: 'sessionUpdated',
        schema: expect.objectContaining({ filePath: '/data/direct.parquet' }),
      }),
    );

    mocks.posted.length = 0;
    await latestMessageHandler()({ type: 'ready' });
    expect(mocks.posted).toContainEqual(
      expect.objectContaining({ type: 'sessionUpdated' }),
    );
  });

  it('records the failed load stage and directs the user to the output channel', async () => {
    mocks.loadFile.mockRejectedValueOnce(new Error('invalid CSV header'));

    await openDataWranglerCustomEditor({ fsPath: '/data/broken.csv' } as never, {} as never);

    expect(mocks.prepareDataFileReader).toHaveBeenCalledWith(
      expect.anything(),
      '/data/broken.csv',
    );
    expect(mocks.appendLine).toHaveBeenCalledWith(
      expect.stringContaining(
        '[Load ERROR] Failed while loading the source data: /data/broken.csv\nError: invalid CSV header',
      ),
    );
    expect(mocks.showErrorMessage).toHaveBeenCalledWith(
      'Failed to load file: invalid CSV header. See View > Output > QuackWrangler for details.',
    );
  });

  it('can open CSV after XLSX reader preparation fails', async () => {
    mocks.prepareDataFileReader.mockRejectedValueOnce(new Error('excel extension unavailable'));

    await openDataWranglerCustomEditor({ fsPath: '/data/broken.xlsx' } as never, {} as never);
    await openDataWranglerCustomEditor({ fsPath: '/data/recovery.csv' } as never, {} as never);

    expect(mocks.loadFile).toHaveBeenCalledTimes(1);
    expect(mocks.loadFile).toHaveBeenCalledWith(
      expect.anything(),
      '/data/recovery.csv',
      'auto',
      64,
      expect.stringMatching(/^qw_[0-9a-f]{16}$/),
    );
    expect(mocks.posted).toContainEqual(
      expect.objectContaining({
        type: 'sessionUpdated',
        schema: expect.objectContaining({ filePath: '/data/recovery.csv' }),
      }),
    );
  });

  it('loads a file selected from the empty state into the current panel', async () => {
    await openDataWranglerCustomEditor({ fsPath: '/data/initial.parquet' } as never, {} as never);
    mocks.showOpenDialog.mockResolvedValueOnce([{ fsPath: '/data/chosen.parquet' }]);

    await latestMessageHandler()({ type: 'openFilePicker' });

    expect(mocks.loadFile).toHaveBeenLastCalledWith(
      expect.anything(),
      '/data/chosen.parquet',
      'auto',
      64,
      expect.stringMatching(/^qw_[0-9a-f]{16}$/),
    );
    expect(mocks.posted.at(-1)).toEqual(
      expect.objectContaining({
        type: 'sessionUpdated',
        schema: expect.objectContaining({ filePath: '/data/chosen.parquet' }),
      }),
    );
  });

  it('leaves the current panel unchanged when the file picker is cancelled', async () => {
    await openDataWranglerCustomEditor({ fsPath: '/data/initial.parquet' } as never, {} as never);
    mocks.showOpenDialog.mockResolvedValueOnce(undefined);
    const loadCount = mocks.loadFile.mock.calls.length;

    await latestMessageHandler()({ type: 'openFilePicker' });

    expect(mocks.loadFile).toHaveBeenCalledTimes(loadCount);
  });

  it('surfaces an in-panel error when a selected file cannot be loaded', async () => {
    await openDataWranglerCustomEditor({ fsPath: '/data/initial.parquet' } as never, {} as never);
    mocks.showOpenDialog.mockResolvedValueOnce([{ fsPath: '/data/broken.parquet' }]);
    mocks.loadFile.mockRejectedValueOnce(new Error('invalid Parquet footer'));

    await latestMessageHandler()({ type: 'openFilePicker' });

    expect(mocks.posted.at(-1)).toEqual({
      type: 'error',
      message: 'invalid Parquet footer',
    });
  });

  it('lets the user choose a supported file from a selected folder and loads it in place', async () => {
    await openDataWranglerCustomEditor({ fsPath: '/data/initial.parquet' } as never, {} as never);
    mocks.showOpenDialog.mockResolvedValueOnce([{ fsPath: '/datasets' }]);
    mocks.readDirectory.mockImplementation(async (uri: { fsPath: string }) =>
      uri.fsPath === '/datasets'
        ? [
            ['nested', 2],
            ['notes.txt', 1],
          ]
        : [['chosen.parquet', 1]],
    );
    mocks.showQuickPick.mockImplementationOnce(async (items: unknown[]) => items[0]);

    await latestMessageHandler()({ type: 'openFolderPicker' });

    expect(mocks.showQuickPick).toHaveBeenCalledOnce();
    expect(mocks.loadFile).toHaveBeenLastCalledWith(
      expect.anything(),
      '/datasets/nested/chosen.parquet',
      'auto',
      64,
      expect.stringMatching(/^qw_[0-9a-f]{16}$/),
    );
    expect(mocks.posted.at(-1)).toEqual(
      expect.objectContaining({
        type: 'sessionUpdated',
        schema: expect.objectContaining({ filePath: '/datasets/nested/chosen.parquet' }),
      }),
    );
  });

  it('explains when a selected folder contains no supported files', async () => {
    await openDataWranglerCustomEditor({ fsPath: '/data/initial.parquet' } as never, {} as never);
    mocks.showOpenDialog.mockResolvedValueOnce([{ fsPath: '/empty' }]);
    mocks.readDirectory.mockResolvedValueOnce([['notes.txt', 1]]);

    await latestMessageHandler()({ type: 'openFolderPicker' });

    expect(mocks.showQuickPick).not.toHaveBeenCalled();
    expect(mocks.showWarningMessage).toHaveBeenCalledWith(
      'No supported data files were found in this folder.',
    );
  });

  it('exports the active custom query scoped to the panel pipeline', async () => {
    await openDataWranglerCustomEditor({ fsPath: '/data/initial.parquet' } as never, {} as never);
    const handler = latestMessageHandler();

    await handler({ type: 'executeCustomQuery', sql: 'SELECT value FROM current_data WHERE value > 0' });
    await handler({
      type: 'exportData',
      format: 'csv',
      outputPath: '/tmp/custom-query.csv',
      requestId: 'export-1',
    });

    expect(mocks.exportResults).toHaveBeenCalledWith(
      expect.anything(),
      'WITH current_data AS (SELECT * FROM "panel_relation") SELECT * FROM (SELECT value FROM current_data WHERE value > 0) AS custom_query',
      '/tmp/custom-query.csv',
      'csv',
    );
    expect(mocks.posted).toContainEqual({
      type: 'exportComplete',
      outputPath: '/tmp/custom-query.csv',
      status: 'completed',
      requestId: 'export-1',
    });
  });
});
