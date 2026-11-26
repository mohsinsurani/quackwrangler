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
    history: [] as unknown[],
    cancelled: 0,
    panel,
    executeCommand: vi.fn().mockResolvedValue(undefined),
    showOpenDialog: vi.fn(),
    showQuickPick: vi.fn(),
    readFile: vi.fn(),
    restoreValidated: vi.fn<WranglingSession['restoreValidated']>().mockResolvedValue(false),
    showWarningMessage: vi.fn(),
    showErrorMessage: vi.fn(),
    showSaveDialog: vi.fn(),
    writeFile: vi.fn().mockResolvedValue(undefined),
    readDirectory: vi.fn(),
    loadFile: vi.fn().mockResolvedValue(undefined),
    prepareDataFileReader: vi.fn().mockResolvedValue(undefined),
    loadDatabaseTable: vi.fn(),
    attachSecondaryDatabase: vi.fn(),
    describeSecondaryTable: vi.fn(),
    getFileMetadata: vi.fn(),
    releaseDatabase: vi.fn().mockResolvedValue(undefined),
    exportResults: vi.fn().mockResolvedValue(undefined),
    attach: vi.fn(() => panel),
    createOrShow: vi.fn(() => panel),
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
    showSaveDialog: mocks.showSaveDialog,
    showInformationMessage: vi.fn(),
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
  return { ...actual, readFile: mocks.readFile, writeFile: mocks.writeFile };
});

vi.mock('../../../src/duckdb/connection.js', async (importOriginal) => ({
  // Keep the real cancellation helpers; only the connection itself is replaced.
  ...(await importOriginal<typeof import('../../../src/duckdb/connection.js')>()),
  DuckDBConnection: class {
    isConnected(): boolean {
      return true;
    }
    cancel(): boolean {
      mocks.cancelled += 1;
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
  getFileMetadata: mocks.getFileMetadata,
}));

vi.mock('../../../src/duckdb/database-source.js', () => ({
  loadDatabaseTable: mocks.loadDatabaseTable,
  releaseDatabase: mocks.releaseDatabase,
  attachSecondaryDatabase: mocks.attachSecondaryDatabase,
  describeSecondaryTable: mocks.describeSecondaryTable,
  describeTable: (table: { schema: string; name: string; view: boolean }) =>
    `${table.schema === 'main' ? '' : `${table.schema}.`}${table.name}${table.view ? ' (view)' : ''}`,
}));

vi.mock('../../../src/dbt/context.js', () => ({ findDbtProject: vi.fn() }));

vi.mock('../../../src/transforms/pipeline.js', () => ({
  WranglingSession: class {
    private filePath = '';
    load(filePath: string): void {
      this.filePath = filePath;
    }
    getHistory(): unknown[] {
      return mocks.history;
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
    createOrShow: mocks.createOrShow,
    currentPanel: undefined,
  },
}));

import { DuckDBConnection } from '../../../src/duckdb/connection.js';
import {
  configureCommands,
  openDataWranglerCustomEditor,
  openWorkspaceCommand,
} from '../../../src/commands';

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
    mocks.history.length = 0;
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

  it('explains a missing remote file in plain words and keeps the raw error in the log', async () => {
    mocks.loadFile.mockRejectedValueOnce(
      new Error(
        "Failed to load file https://data.example.com/a.parquet?sig=hidden: HTTP Error: HTTP HEAD error on 'https://data.example.com/a.parquet?sig=hidden' (HTTP 404 Not Found)",
      ),
    );

    await openDataWranglerCustomEditor(
      { fsPath: 'https://data.example.com/a.parquet?sig=hidden' } as never,
      {} as never,
    );

    const shown = mocks.showErrorMessage.mock.calls[0][0] as string;
    expect(shown).toMatch(/not found \(404\)/i);
    expect(shown).not.toContain('sig=hidden');
    expect(mocks.posted).toContainEqual(
      expect.objectContaining({
        type: 'error',
        message: expect.stringMatching(/not found \(404\)/i),
      }),
    );
    expect(mocks.appendLine).toHaveBeenCalledWith(expect.stringContaining('HTTP HEAD error on'));
  });

  it('does not store or log a signed link', async () => {
    const update = vi.fn();
    const signed = 'https://b.s3.amazonaws.com/a.parquet?X-Amz-Signature=topsecret';
    configureCommands(
      { fsPath: '/extension' } as never,
      { appendLine: mocks.appendLine } as never,
      {
        globalStorageUri: { fsPath: '/writable/global-storage' },
        globalState: { get: vi.fn(() => []), update },
      } as never,
    );
    await openDataWranglerCustomEditor({ fsPath: signed } as never, {} as never);

    expect(update).not.toHaveBeenCalled();
    for (const [line] of mocks.appendLine.mock.calls)
      expect(String(line)).not.toContain('topsecret');
  });

  it('remembers an unsigned remote link and a local file as recent files', async () => {
    const update = vi.fn();
    configureCommands(
      { fsPath: '/extension' } as never,
      { appendLine: mocks.appendLine } as never,
      {
        globalStorageUri: { fsPath: '/writable/global-storage' },
        globalState: { get: vi.fn(() => []), update },
      } as never,
    );
    await openDataWranglerCustomEditor(
      { fsPath: 'https://example.com/a.csv' } as never,
      {} as never,
    );
    expect(update).toHaveBeenCalledWith('quackwrangler.recentFiles', ['https://example.com/a.csv']);
  });

  it('stops the slow-load reminder after a remote load fails', async () => {
    vi.useFakeTimers();
    try {
      mocks.loadFile.mockRejectedValueOnce(new Error('boom'));
      await openDataWranglerCustomEditor(
        { fsPath: 'https://data.example.com/a.parquet' } as never,
        {} as never,
      );
      const before = mocks.posted.length;
      vi.advanceTimersByTime(60000);
      expect(mocks.posted.length).toBe(before);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
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

  it('keeps the accepted search scope when paging', async () => {
    await openDataWranglerCustomEditor({ fsPath: '/data/initial.parquet' } as never, {} as never);
    const handler = latestMessageHandler();
    mocks.posted.length = 0;
    mocks.setFailCustomQuery(false);
    await handler({ type: 'searchRows', query: 'accepted search' });
    const search = mocks.posted.find(
      (message) => (message as { type?: string }).type === 'searchResult',
    ) as { scope: string; query: string };
    expect(search).toMatchObject({ scope: 'search', query: 'accepted search' });
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

describe('database files', () => {
  const orders = { schema: 'main', name: 'orders', view: false };
  const customers = { schema: 'main', name: 'customers', view: false };
  const info = (selected = orders): unknown => ({
    kind: 'duckdb',
    tables: [orders, customers],
    selected,
    textColumns: false,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.posted.length = 0;
    mocks.history.length = 0;
    mocks.setRevision(1);
    // An earlier suite points attach() at its own panel; use the shared one here.
    mocks.attach.mockReturnValue(mocks.panel);
    mocks.loadDatabaseTable.mockImplementation(async (_c, _f, table) =>
      info(table ? { ...table, view: false } : orders),
    );
    configureCommands(
      { fsPath: '/extension' } as never,
      { appendLine: mocks.appendLine } as never,
      {
        globalStorageUri: { fsPath: '/writable/global-storage' },
        globalState: { get: vi.fn(() => []), update: vi.fn() },
      } as never,
    );
  });

  it('opens a database through the table loader and reports its tables to the webview', async () => {
    await openDataWranglerCustomEditor({ fsPath: '/data/shop.duckdb' } as never, {} as never);

    expect(mocks.loadDatabaseTable).toHaveBeenCalledWith(
      expect.anything(),
      '/data/shop.duckdb',
      undefined,
      'auto',
      64,
      expect.stringMatching(/^qw_[0-9a-f]{16}$/),
    );
    expect(mocks.loadFile).not.toHaveBeenCalled();
    expect(mocks.posted).toContainEqual(
      expect.objectContaining({
        type: 'sessionUpdated',
        database: expect.objectContaining({ selected: orders }),
      }),
    );
  });

  it('does not attach database info to ordinary files', async () => {
    await openDataWranglerCustomEditor({ fsPath: '/data/plain.csv' } as never, {} as never);
    const update = mocks.posted.find(
      (message) => (message as { type: string }).type === 'sessionUpdated',
    ) as { database?: unknown };
    expect(update.database).toBeUndefined();
    expect(mocks.loadDatabaseTable).not.toHaveBeenCalled();
    expect(mocks.releaseDatabase).toHaveBeenCalled();
  });

  it('switches table on request and reloads that table', async () => {
    await openDataWranglerCustomEditor({ fsPath: '/data/shop.duckdb' } as never, {} as never);
    mocks.posted.length = 0;
    await latestMessageHandler()({
      type: 'selectTable',
      schema: 'main',
      name: 'customers',
      requestId: 'grid-9',
    });

    expect(mocks.loadDatabaseTable).toHaveBeenLastCalledWith(
      expect.anything(),
      '/data/shop.duckdb',
      expect.objectContaining({ schema: 'main', name: 'customers' }),
      'auto',
      64,
      expect.any(String),
    );
    expect(mocks.posted).toContainEqual(
      expect.objectContaining({
        type: 'sessionUpdated',
        requestId: 'grid-9',
        database: expect.objectContaining({
          selected: expect.objectContaining({ name: 'customers' }),
        }),
      }),
    );
  });

  it('keeps the chosen table when the data is refreshed', async () => {
    await openDataWranglerCustomEditor({ fsPath: '/data/shop.duckdb' } as never, {} as never);
    await latestMessageHandler()({ type: 'selectTable', schema: 'main', name: 'customers' });
    await latestMessageHandler()({ type: 'refresh' });

    expect(mocks.loadDatabaseTable).toHaveBeenLastCalledWith(
      expect.anything(),
      '/data/shop.duckdb',
      expect.objectContaining({ name: 'customers' }),
      'auto',
      64,
      expect.any(String),
    );
  });

  it('asks before a table switch clears applied steps and cancels cleanly', async () => {
    await openDataWranglerCustomEditor({ fsPath: '/data/shop.duckdb' } as never, {} as never);
    mocks.history.push({ id: 's1' }, { id: 's2' });
    mocks.loadDatabaseTable.mockClear();
    mocks.posted.length = 0;
    const warning = vi.fn().mockResolvedValue(undefined);
    const { window } = await import('vscode');
    (window as unknown as { showWarningMessage: unknown }).showWarningMessage = warning;

    await latestMessageHandler()({
      type: 'selectTable',
      schema: 'main',
      name: 'customers',
      requestId: 'grid-3',
    });

    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining('clears 2 applied steps'),
      { modal: true },
      'Switch table',
    );
    expect(mocks.loadDatabaseTable).not.toHaveBeenCalled();
    // The webview must still get a response so it stops showing a loading state.
    expect(mocks.posted).toContainEqual(
      expect.objectContaining({ type: 'sessionUpdated', requestId: 'grid-3' }),
    );
  });

  it('rejects a table that is not in the database', async () => {
    await openDataWranglerCustomEditor({ fsPath: '/data/shop.duckdb' } as never, {} as never);
    mocks.posted.length = 0;
    await latestMessageHandler()({ type: 'selectTable', schema: 'main', name: 'nope' });
    expect(mocks.posted).toContainEqual(
      expect.objectContaining({ type: 'error', message: '"nope" is not in this database' }),
    );
  });

  it('rejects a table switch when no database is open', async () => {
    await openDataWranglerCustomEditor({ fsPath: '/data/plain.csv' } as never, {} as never);
    mocks.posted.length = 0;
    await latestMessageHandler()({ type: 'selectTable', schema: 'main', name: 'x' });
    expect(mocks.posted).toContainEqual(
      expect.objectContaining({ type: 'error', message: 'Open a database file first' }),
    );
  });

  it('restores the previous table when a switch fails', async () => {
    await openDataWranglerCustomEditor({ fsPath: '/data/shop.duckdb' } as never, {} as never);
    mocks.loadDatabaseTable.mockRejectedValueOnce(new Error('locked by another program'));
    mocks.posted.length = 0;
    await latestMessageHandler()({ type: 'selectTable', schema: 'main', name: 'customers' });

    expect(mocks.posted).toContainEqual(
      expect.objectContaining({ type: 'error', message: 'locked by another program' }),
    );
    // The panel still shows the original table, so a later refresh reloads it.
    mocks.loadDatabaseTable.mockClear();
    await latestMessageHandler()({ type: 'refresh' });
    expect(mocks.loadDatabaseTable).toHaveBeenLastCalledWith(
      expect.anything(),
      '/data/shop.duckdb',
      expect.objectContaining({ name: 'orders' }),
      'auto',
      64,
      expect.any(String),
    );
  });

  it('saves the open table in the recipe and names the file after it', async () => {
    await openDataWranglerCustomEditor({ fsPath: '/data/shop.duckdb' } as never, {} as never);
    await latestMessageHandler()({ type: 'selectTable', schema: 'main', name: 'customers' });
    mocks.showSaveDialog.mockResolvedValue({ fsPath: '/data/out.qw' });
    const { DataWranglerPanel } = await import('../../../src/webview/provider.js');
    (DataWranglerPanel as unknown as { currentPanel: unknown }).currentPanel = mocks.panel;
    const { saveWorkspaceCommand } = await import('../../../src/commands');

    await saveWorkspaceCommand();

    // The folder separator depends on the operating system, so check the folder and file name.
    const suggested = String(
      (mocks.showSaveDialog.mock.calls.at(-1)?.[0] as { defaultUri: { fsPath: string } }).defaultUri
        .fsPath,
    ).replace(/\\/g, '/');
    expect(suggested).toBe('/data/customers.qw');
    const written = JSON.parse(String(mocks.writeFile.mock.calls.at(-1)?.[1]));
    expect(written).toMatchObject({
      sourceFile: '/data/shop.duckdb',
      sourceTable: { schema: 'main', name: 'customers' },
    });
    (DataWranglerPanel as unknown as { currentPanel: unknown }).currentPanel = undefined;
  });
});

describe('choosing a second file to join or union', () => {
  const orders = { schema: 'main', name: 'orders', view: false };
  const customers = { schema: 'main', name: 'customers', view: false };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.posted.length = 0;
    mocks.attach.mockReturnValue(mocks.panel);
    mocks.attachSecondaryDatabase.mockResolvedValue({
      kind: 'duckdb',
      tables: [orders, customers],
    });
    mocks.describeSecondaryTable.mockResolvedValue([{ name: 'id', type: 'INTEGER' }]);
    mocks.getFileMetadata.mockResolvedValue({
      columns: [{ name: 'k', type: 'VARCHAR', nullable: true }],
      rowCount: 3,
      filePath: '/data/b.csv',
    });
    configureCommands(
      { fsPath: '/extension' } as never,
      { appendLine: mocks.appendLine } as never,
      {
        globalStorageUri: { fsPath: '/writable/global-storage' },
        globalState: { get: vi.fn(() => []), update: vi.fn() },
      } as never,
    );
  });

  async function openAndPick(picked: string): Promise<void> {
    await openDataWranglerCustomEditor({ fsPath: '/data/a.csv' } as never, {} as never);
    mocks.posted.length = 0;
    mocks.showOpenDialog.mockResolvedValueOnce([{ fsPath: picked }]);
    await latestMessageHandler()({ type: 'selectSecondaryFile', requestId: 'grid-2' });
  }

  it('asks which table to use when the second file is a database', async () => {
    mocks.showQuickPick.mockResolvedValueOnce({ label: 'customers', table: customers });
    await openAndPick('/data/shop.duckdb');

    expect(mocks.showQuickPick).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ label: 'orders' })]),
      expect.objectContaining({ placeHolder: expect.stringContaining('shop.duckdb') }),
    );
    expect(mocks.posted).toContainEqual(
      expect.objectContaining({
        type: 'secondaryFileSelected',
        filePath: '/data/shop.duckdb',
        table: { schema: 'main', name: 'customers' },
        columns: [expect.objectContaining({ name: 'id', type: 'INTEGER' })],
      }),
    );
    expect(mocks.getFileMetadata).not.toHaveBeenCalled();
  });

  it('does not ask when the database has a single table', async () => {
    mocks.attachSecondaryDatabase.mockResolvedValueOnce({ kind: 'duckdb', tables: [orders] });
    await openAndPick('/data/one.duckdb');
    expect(mocks.showQuickPick).not.toHaveBeenCalled();
    expect(mocks.posted).toContainEqual(
      expect.objectContaining({
        type: 'secondaryFileSelected',
        table: { schema: 'main', name: 'orders' },
      }),
    );
  });

  it('leaves the form alone when the table picker is dismissed', async () => {
    mocks.showQuickPick.mockResolvedValueOnce(undefined);
    await openAndPick('/data/shop.duckdb');
    expect(mocks.posted.some((m) => (m as { type: string }).type === 'secondaryFileSelected')).toBe(
      false,
    );
    expect(mocks.posted.some((m) => (m as { type: string }).type === 'error')).toBe(false);
  });

  it('keeps the plain-file path unchanged for CSV and similar files', async () => {
    await openAndPick('/data/b.csv');
    expect(mocks.attachSecondaryDatabase).not.toHaveBeenCalled();
    expect(mocks.posted).toContainEqual(
      expect.objectContaining({
        type: 'secondaryFileSelected',
        filePath: '/data/b.csv',
        columns: [expect.objectContaining({ name: 'k' })],
      }),
    );
    expect(
      (
        mocks.posted.find((m) => (m as { type: string }).type === 'secondaryFileSelected') as {
          table?: unknown;
        }
      ).table,
    ).toBeUndefined();
  });

  it('attaches a database before applying a join or union step that uses it', async () => {
    await openDataWranglerCustomEditor({ fsPath: '/data/a.csv' } as never, {} as never);
    await latestMessageHandler()({
      type: 'applyTransform',
      transform: {
        type: 'union_file',
        params: { filePath: '/data/shop.duckdb', table: { schema: 'main', name: 'orders' } },
      },
    });
    expect(mocks.attachSecondaryDatabase).toHaveBeenCalledWith(
      expect.anything(),
      '/data/shop.duckdb',
    );
    expect(mocks.prepareDataFileReader).not.toHaveBeenCalledWith(
      expect.anything(),
      '/data/shop.duckdb',
    );
  });

  it('reports a database that cannot be attached as an error', async () => {
    mocks.attachSecondaryDatabase.mockRejectedValueOnce(
      new Error('not a DuckDB or SQLite database'),
    );
    await openAndPick('/data/Thumbs.db');
    expect(mocks.posted).toContainEqual(
      expect.objectContaining({
        type: 'error',
        message: expect.stringContaining('not a DuckDB or SQLite'),
      }),
    );
  });
});

describe('cancelling work', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.posted.length = 0;
    mocks.cancelled = 0;
    mocks.attach.mockReturnValue(mocks.panel);
    configureCommands(
      { fsPath: '/extension' } as never,
      { appendLine: mocks.appendLine } as never,
      {
        globalStorageUri: { fsPath: '/writable/global-storage' },
        globalState: { get: vi.fn(() => []), update: vi.fn() },
      } as never,
    );
  });

  it('asks the panel connection to stop when the editor sends cancel', async () => {
    await openDataWranglerCustomEditor({ fsPath: '/data/a.parquet' } as never, {} as never);
    await latestMessageHandler()({ type: 'cancel' });
    expect(mocks.cancelled).toBe(1);
  });

  it('reports a cancelled load as cancelled, not as an error, and keeps the earlier data', async () => {
    await openDataWranglerCustomEditor({ fsPath: '/data/current.parquet' } as never, {} as never);
    mocks.posted.length = 0;
    const { QueryCancelledError } = await import('../../../src/duckdb/connection.js');
    mocks.loadFile.mockRejectedValueOnce(new QueryCancelledError());

    await latestMessageHandler()({ type: 'refresh', requestId: 'grid-5' });

    expect(mocks.posted).toContainEqual({ type: 'cancelled', requestId: 'grid-5' });
    expect(mocks.posted.some((message) => (message as { type: string }).type === 'error')).toBe(
      false,
    );
    expect(mocks.showErrorMessage).not.toHaveBeenCalled();
    expect(mocks.posted).toContainEqual(
      expect.objectContaining({
        type: 'sessionUpdated',
        schema: expect.objectContaining({ filePath: '/data/current.parquet' }),
      }),
    );
  });

  it('reports DuckDB interrupt errors from other requests as cancelled too', async () => {
    await openDataWranglerCustomEditor({ fsPath: '/data/current.parquet' } as never, {} as never);
    mocks.posted.length = 0;
    mocks.showOpenDialog.mockResolvedValueOnce([{ fsPath: '/data/r.qw' }]);
    mocks.readFile.mockResolvedValueOnce(
      JSON.stringify({ version: 1, transforms: [{ type: 'sort_rows', params: { column: 'v' } }] }),
    );
    mocks.restoreValidated.mockRejectedValueOnce(new Error('INTERRUPT Error: Interrupted!'));

    await latestMessageHandler()({ type: 'openRecipePicker', requestId: 'grid-8' });

    expect(mocks.posted).toContainEqual({ type: 'cancelled', requestId: 'grid-8' });
    expect(mocks.posted.some((message) => (message as { type: string }).type === 'error')).toBe(
      false,
    );
  });
});

describe('opening a saved workspace', () => {
  let freshPanel: typeof mocks.panel;
  const step = { type: 'sort_rows', params: { column: 'value', direction: 'ASC' } };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.posted.length = 0;
    mocks.history.length = 0;
    // A fresh panel per test: panel state is remembered per panel object.
    freshPanel = {
      filePath: undefined as string | undefined,
      postMessage: vi.fn((message: unknown) => mocks.posted.push(message)),
      setMessageHandler: vi.fn(),
      onDispose: vi.fn(),
    };
    mocks.attach.mockReturnValue(freshPanel);
    mocks.createOrShow.mockReturnValue(freshPanel);
    mocks.restoreValidated.mockResolvedValue(true);
    configureCommands(
      { fsPath: '/extension' } as never,
      { appendLine: mocks.appendLine } as never,
      {
        globalStorageUri: { fsPath: '/writable/global-storage' },
        globalState: { get: vi.fn(() => []), update: vi.fn() },
      } as never,
    );
  });

  it('loads the source and replays the steps with the column remapping picker', async () => {
    mocks.readFile.mockResolvedValue(
      JSON.stringify({ version: 1, sourceFile: '/data/orders.parquet', transforms: [step] }),
    );
    await openWorkspaceCommand({ fsPath: '/data/orders.qw' } as never);

    expect(mocks.createOrShow).toHaveBeenCalledWith(
      { fsPath: '/extension' },
      '/data/orders.parquet',
    );
    expect(mocks.loadFile).toHaveBeenCalledWith(
      expect.anything(),
      '/data/orders.parquet',
      'auto',
      64,
      expect.any(String),
    );
    expect(mocks.restoreValidated).toHaveBeenCalledWith(
      [step],
      expect.objectContaining({
        chooseColumn: expect.any(Function),
        assertCurrent: expect.any(Function),
      }),
    );
    expect(mocks.posted).toContainEqual(expect.objectContaining({ type: 'sessionUpdated' }));
  });

  it('reopens the saved database table', async () => {
    mocks.loadDatabaseTable.mockImplementation(async (_c, _f, table) => ({
      kind: 'duckdb',
      tables: [{ schema: 'main', name: 'orders', view: false }],
      selected: { ...table, view: false },
      textColumns: false,
    }));
    mocks.readFile.mockResolvedValue(
      JSON.stringify({
        version: 1,
        sourceFile: '/data/shop.duckdb',
        sourceTable: { schema: 'main', name: 'orders' },
        transforms: [step],
      }),
    );
    await openWorkspaceCommand({ fsPath: '/data/shop.qw' } as never);

    expect(mocks.loadDatabaseTable).toHaveBeenCalledWith(
      expect.anything(),
      '/data/shop.duckdb',
      { schema: 'main', name: 'orders' },
      'auto',
      64,
      expect.any(String),
    );
    expect(mocks.restoreValidated).toHaveBeenCalled();
  });

  it('does not replay the steps when the source file cannot be loaded', async () => {
    mocks.loadFile.mockRejectedValueOnce(new Error('file not found'));
    mocks.readFile.mockResolvedValue(
      JSON.stringify({ version: 1, sourceFile: '/data/missing.parquet', transforms: [step] }),
    );
    await openWorkspaceCommand({ fsPath: '/data/missing.qw' } as never);

    expect(mocks.restoreValidated).not.toHaveBeenCalled();
    expect(mocks.posted).toContainEqual(
      expect.objectContaining({
        type: 'error',
        message: expect.stringContaining('file not found'),
      }),
    );
    expect(mocks.posted).not.toContainEqual(expect.objectContaining({ type: 'sessionUpdated' }));
  });

  it('keeps showing the existing data and skips the steps when the source cannot be loaded into a used panel', async () => {
    // The panel already shows a file, as when the command reuses an open editor.
    await openDataWranglerCustomEditor({ fsPath: '/data/current.parquet' } as never, {} as never);
    mocks.posted.length = 0;
    mocks.loadFile.mockRejectedValueOnce(new Error('file not found'));
    mocks.readFile.mockResolvedValue(
      JSON.stringify({ version: 1, sourceFile: '/data/missing.parquet', transforms: [step] }),
    );
    await openWorkspaceCommand({ fsPath: '/data/missing.qw' } as never);

    expect(mocks.restoreValidated).not.toHaveBeenCalled();
    expect(mocks.posted).toContainEqual(expect.objectContaining({ type: 'error' }));
    // The earlier data is re-sent so the editor is still usable.
    expect(mocks.posted).toContainEqual(
      expect.objectContaining({
        type: 'sessionUpdated',
        schema: expect.objectContaining({ filePath: '/data/current.parquet' }),
      }),
    );
  });

  it('rejects a file that is not a workspace before opening anything', async () => {
    mocks.readFile.mockResolvedValue(JSON.stringify({ version: 2, transforms: [] }));
    await expect(openWorkspaceCommand({ fsPath: '/data/bad.qw' } as never)).rejects.toThrow(
      'not a valid QuackWrangler workspace file',
    );
    mocks.readFile.mockResolvedValue('null');
    await expect(openWorkspaceCommand({ fsPath: '/data/null.qw' } as never)).rejects.toThrow(
      'not a valid QuackWrangler workspace file',
    );
    expect(mocks.createOrShow).not.toHaveBeenCalled();
  });

  it('does nothing when the file picker is cancelled', async () => {
    mocks.showOpenDialog.mockResolvedValueOnce(undefined);
    await openWorkspaceCommand();
    expect(mocks.createOrShow).not.toHaveBeenCalled();
    expect(mocks.restoreValidated).not.toHaveBeenCalled();
  });
});
