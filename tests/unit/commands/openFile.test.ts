import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  executeCommand: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('vscode', () => ({
  commands: { executeCommand: mocks.executeCommand },
  Uri: {
    file: (fsPath: string) => ({ fsPath }),
  },
  window: {
    createOutputChannel: vi.fn(),
    showOpenDialog: vi.fn(),
  },
  workspace: {
    getConfiguration: vi.fn(),
  },
  extensions: {
    getExtension: vi.fn(),
  },
  ProgressLocation: { Notification: 15 },
  FileType: { File: 1, Directory: 2 },
}));

import { openFile } from '../../../src/commands';
import { DATA_EDITOR_VIEW_TYPE } from '../../../src/utils/editorRouting';

describe('Open in QuackWrangler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('opens a local Parquet URI in the QuackWrangler visual custom editor', async () => {
    const uri = { fsPath: '/readonly/project/data.parquet' };

    await openFile(uri as never);

    expect(mocks.executeCommand).toHaveBeenCalledOnce();
    expect(mocks.executeCommand).toHaveBeenCalledWith(
      'vscode.openWith',
      uri,
      DATA_EDITOR_VIEW_TYPE,
    );
  });

  it('opens a local Parquet string path in the same visual custom editor', async () => {
    await openFile('/readonly/project/DATA.PARQUET');

    expect(mocks.executeCommand).toHaveBeenCalledWith(
      'vscode.openWith',
      { fsPath: '/readonly/project/DATA.PARQUET' },
      DATA_EDITOR_VIEW_TYPE,
    );
  });
});
