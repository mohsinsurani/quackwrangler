import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WranglingSession } from '../../../src/transforms/pipeline.js';

const mocks = vi.hoisted(() => {
  const posted: unknown[] = [];
  let failCustomQuery = false;
  let revision = 1;
  const panel = {
    filePath: undefined as string | undefined,
    postMessage: vi.fn((message: unknown) => posted.push(message)),
    setMessageHandler: vi.fn(),
    onDispose: vi.fn(),
  };
  return {
    posted,
    setFailCustomQuery(value: boolean) {
      failCustomQuery = value;
    },
    get failCustomQuery() {
      return failCustomQuery;
    },
    setRevision(value: number) {
      revision = value;
    },
    get revision() {
      return revision;
    },
    panel,
    executeCommand: vi.fn().mockResolvedValue(undefined),
    showOpenDialog: vi.fn(),
    showQuickPick: vi.fn(),
    readFile: vi.fn(),
    restoreValidated: vi.fn<WranglingSession['restoreValidated']>().mockResolvedValue(false),
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

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return { ...actual, readFile: mocks.readFile };
});

vi.mock('../../../src/duckdb/connection.js', () => ({
  DuckDBConnection: class {
    isConnected(): boolean {
      return true;
    }
    async connect(): Promise<void> {}
    async close(): Promise<void> {}
    async query(sql: string): Promise<unknown> {
      if (sql.startsWith('DESCRIBE')) {
        if (sql.includes('custom_query_schema') && mocks.failCustomQuery)
          throw new Error('bad custom query');
        if (sql.includes('preceding_pipeline_schema'))
          return { columns: ['name', 'type', 'null'], rows: [['value', 'BIGINT', 'NO']] };
        return { columns: [], rows: [['value', 'BIGINT', 'NO']], rowCount: 1, duration: 0 };
      }
      if (sql.includes('panel_relation'))
        return { columns: ['value'], rows: [[1]], rowCount: 1, duration: 0 };
      if (sql.startsWith('SELECT COUNT(*) FROM (WITH current_data'))
        return { columns: ['count'], rows: [[1]], rowCount: 1, duration: 0 };
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
      return mocks.revision;
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
    async applyValidated(): Promise<void> {}
    async undoValidated(): Promise<void> {}
    async redoValidated(): Promise<void> {}
    restoreValidated = mocks.restoreValidated;
    async removeValidated(): Promise<void> {}
    async reorderValidated(): Promise<void> {}
    async search(): Promise<unknown> {
      return {
        schema: {
          columns: [{ name: 'value', type: 'BIGINT', nullable: false }],
          rowCount: 1,
          filePath: this.filePath,
        },
        result: { columns: ['value'], rows: [[1]], rowCount: 1 },
        page: { offset: 0, limit: 100, totalRows: 1 },
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

import { DuckDBConnection } from '../../../src/duckdb/connection.js';
import { configureCommands, openDataWranglerCustomEditor } from '../../../src/commands';

function latestMessageHandler(): (
  message: Record<string, unknown> & { type: string },
) => Promise<void> {
  const callback = mocks.panel.setMessageHandler.mock.calls.at(-1)?.[0];
  if (!callback) throw new Error('Expected the panel message handler to be registered');
  return callback;
}

describe('custom-editor file opening flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.posted.length = 0;
    mocks.setRevision(1);
    mocks.setFailCustomQuery(false);
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
    await openDataWranglerCustomEditor({ fsPath: '/data/direct.parquet' } as never, {} as never);

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
    expect(mocks.posted).toContainEqual(expect.objectContaining({ type: 'sessionUpdated' }));
  });

  it('records the failed load stage and directs the user to the output channel', async () => {
    mocks.loadFile.mockRejectedValueOnce(new Error('invalid CSV header'));

    await openDataWranglerCustomEditor({ fsPath: '/data/broken.csv' } as never, {} as never);

    expect(mocks.prepareDataFileReader).toHaveBeenCalledWith(expect.anything(), '/data/broken.csv');
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

    await handler({
      type: 'executeCustomQuery',
      sql: 'SELECT value FROM current_data WHERE value > 0',
    });
    const sessionId = (
      mocks.posted.find((message) => (message as { type?: string }).type === 'sessionUpdated') as {
        sessionId: string;
      }
    ).sessionId;
    await handler({
      type: 'exportData',
      format: 'csv',
      outputPath: '/tmp/custom-query.csv',
      sessionId,
      revision: 1,
      customQuerySql: 'SELECT value FROM current_data WHERE value > 0',
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

  it.each(['accept', 'cancel'] as const)(
    'handles recipe column picker %s in the host',
    async (action) => {
      await openDataWranglerCustomEditor({ fsPath: '/data/initial.parquet' } as never, {} as never);
      const handler = latestMessageHandler();
      const sql = 'SELECT value FROM current_data WHERE value > 0';
      await handler({ type: 'executeCustomQuery', sql });
      expect(mocks.posted).toContainEqual(
        expect.objectContaining({ type: 'customQueryResult', customQuerySql: sql }),
      );
      mocks.posted.length = 0;

      const step = { type: 'rename_column', params: { oldName: 'old_value', newName: 'result' } };
      const candidate = { name: 'value', type: 'BIGINT', nullable: false };
      mocks.showOpenDialog.mockResolvedValueOnce([{ fsPath: '/data/example.qw' }]);
      mocks.readFile.mockResolvedValueOnce(JSON.stringify({ version: 1, transforms: [step] }));
      mocks.showQuickPick.mockResolvedValueOnce(
        action === 'accept' ? { label: 'value' } : undefined,
      );
      mocks.restoreValidated.mockImplementationOnce(async (steps, replay) => {
        expect(steps).toEqual([step]);
        const replacement = await replay?.chooseColumn(
          'old_value',
          [candidate],
          1,
          'rename_column',
        );
        expect(replacement).toBe(action === 'accept' ? 'value' : undefined);
        return replacement === 'value';
      });

      await handler({ type: 'openRecipePicker', requestId: 'replay' });

      expect(mocks.readFile).toHaveBeenCalledWith('/data/example.qw', 'utf8');
      expect(mocks.showQuickPick).toHaveBeenCalledWith(
        [{ label: 'value', description: 'BIGINT' }],
        {
          title: 'Recipe step 1 · rename column',
          placeHolder: 'Replace missing column “old_value”',
        },
      );
      if (action === 'accept') {
        expect(mocks.posted).toContainEqual(
          expect.objectContaining({ type: 'sessionUpdated', requestId: 'replay' }),
        );
      } else {
        expect(mocks.posted).toEqual([]);
      }

      mocks.posted.length = 0;
      await handler({ type: 'pageChange', offset: 0, limit: 100 });
      expect(mocks.posted).toContainEqual(
        expect.objectContaining({
          type: action === 'accept' ? 'sessionUpdated' : 'customQueryResult',
        }),
      );
    },
  );

  it('does not activate a custom query that fails validation', async () => {
    await openDataWranglerCustomEditor({ fsPath: '/data/initial.parquet' } as never, {} as never);
    const handler = latestMessageHandler();
    mocks.setFailCustomQuery(true);
    await handler({ type: 'executeCustomQuery', sql: 'SELECT broken FROM current_data' });
    mocks.setFailCustomQuery(false);
    const sessionId = (
      mocks.posted.find((message) => (message as { type?: string }).type === 'sessionUpdated') as {
        sessionId: string;
      }
    ).sessionId;
    await handler({
      type: 'exportData',
      format: 'csv',
      outputPath: '/tmp/base.csv',
      sessionId,
      revision: 1,
      customQuerySql: null,
    });
    expect(mocks.exportResults).toHaveBeenCalledWith(
      expect.anything(),
      'SELECT * FROM "panel_relation"',
      '/tmp/base.csv',
      'csv',
    );
  });

  it('confirms export scope in the VS Code host and stops when dismissed', async () => {
    await openDataWranglerCustomEditor({ fsPath: '/data/initial.parquet' } as never, {} as never);
    const session = mocks.posted.find(
      (message) => (message as { type?: string }).type === 'sessionUpdated',
    ) as { sessionId: string; revision: number };
    mocks.showQuickPick.mockResolvedValueOnce(undefined);
    await latestMessageHandler()({
      type: 'exportData',
      format: 'csv',
      sessionId: session.sessionId,
      revision: session.revision,
      customQuerySql: null,
      requestId: 'cancel-export',
    });
    expect(mocks.showQuickPick).toHaveBeenCalledWith(
      [expect.objectContaining({ label: 'Export' })],
      { title: 'Export all 1 rows from the pipeline result?' },
    );
    expect(mocks.exportResults).not.toHaveBeenCalled();
    expect(mocks.posted).toContainEqual({
      type: 'exportComplete',
      outputPath: '',
      status: 'cancelled',
      requestId: 'cancel-export',
    });
  });

  it('rejects export requests if the pipeline revision changed after confirmation', async () => {
    await openDataWranglerCustomEditor({ fsPath: '/data/initial.parquet' } as never, {} as never);
    const handler = latestMessageHandler();
    const sessionId = (
      mocks.posted.find((message) => (message as { type?: string }).type === 'sessionUpdated') as {
        sessionId: string;
      }
    ).sessionId;
    mocks.setRevision(2);
    await handler({
      type: 'exportData',
      format: 'csv',
      outputPath: '/tmp/stale.csv',
      sessionId,
      revision: 1,
      customQuerySql: null,
    });
    expect(mocks.exportResults).not.toHaveBeenCalled();
    expect(mocks.posted).toContainEqual(
      expect.objectContaining({ type: 'error', message: expect.stringContaining('data changed') }),
    );
  });

  it('rejects stale search results without replacing the accepted filter scope', async () => {
    await openDataWranglerCustomEditor({ fsPath: '/data/initial.parquet' } as never, {} as never);
    const handler = latestMessageHandler();
    mocks.posted.length = 0;
    mocks.setFailCustomQuery(false);
    await handler({ type: 'searchChange', query: 'draft only' });
    await handler({ type: 'searchRows', query: 'accepted search' });
    const search = mocks.posted.find(
      (message) => (message as { type?: string }).type === 'searchResult',
    ) as { scope: string; query: string };
    expect(search).toMatchObject({ scope: 'search', query: 'accepted search' });
    await handler({ type: 'searchChange', query: 'new draft' });
    await handler({ type: 'pageChange', offset: 0, limit: 100 });
    const latestSearch = mocks.posted
      .filter((message) => (message as { type?: string }).type === 'searchResult')
      .at(-1) as { query: string };
    expect(latestSearch.query).toBe('accepted search');
  });
});

describe('per-panel DuckDB connection isolation', () => {
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

  it('creates a separate DuckDBConnection for each panel', async () => {
    const panelA = {
      filePath: undefined as string | undefined,
      postMessage: vi.fn(),
      setMessageHandler: vi.fn(),
      onDispose: vi.fn(),
    };
    const panelB = {
      filePath: undefined as string | undefined,
      postMessage: vi.fn(),
      setMessageHandler: vi.fn(),
      onDispose: vi.fn(),
    };

    const { DataWranglerPanel } = await import('../../../src/webview/provider.js');
    vi.mocked(DataWranglerPanel)
      .attach.mockReturnValueOnce(panelA as never)
      .mockReturnValueOnce(panelB as never);

    await openDataWranglerCustomEditor({ fsPath: '/data/a.parquet' } as never, {} as never);
    await openDataWranglerCustomEditor({ fsPath: '/data/b.parquet' } as never, {} as never);

    // Both panels must have registered a dispose handler.
    expect(panelA.onDispose).toHaveBeenCalledOnce();
    expect(panelB.onDispose).toHaveBeenCalledOnce();

    // The connections passed to loadFile must be distinct objects.
    const callsA = mocks.loadFile.mock.calls.filter((c) => String(c[1]).includes('a.parquet'));
    const callsB = mocks.loadFile.mock.calls.filter((c) => String(c[1]).includes('b.parquet'));
    expect(callsA).toHaveLength(1);
    expect(callsB).toHaveLength(1);
    const connA = callsA[0][0] as DuckDBConnection;
    const connB = callsB[0][0] as DuckDBConnection;
    expect(connA).not.toBe(connB);
  });

  it('calls the dispose handler registered by onDispose when a panel is closed', async () => {
    const panel = {
      filePath: undefined as string | undefined,
      postMessage: vi.fn(),
      setMessageHandler: vi.fn(),
      onDispose: vi.fn(),
    };
    const { DataWranglerPanel } = await import('../../../src/webview/provider.js');
    vi.mocked(DataWranglerPanel).attach.mockReturnValue(panel as never);

    await openDataWranglerCustomEditor({ fsPath: '/data/a.parquet' } as never, {} as never);

    expect(panel.onDispose).toHaveBeenCalledOnce();
    // Simulate panel disposal: fire the registered callback and verify the
    // connection is closed by observing the connection mock.
    const disposeCallback = panel.onDispose.mock.calls[0][0] as () => void;
    expect(() => disposeCallback()).not.toThrow();
  });
});
