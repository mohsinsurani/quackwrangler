import * as vscode from 'vscode';

import {
  openDataWrangler,
  openFile,
  executeQueryCommand,
  exportDataCommand,
  summarizeFileCommand,
  showSchemaCommand,
  configureCommands,
  disposeCommands,
  openDataWranglerCustomEditor,
} from './commands/index.js';
import { getDataFilePatterns } from './utils/fileDetector.js';
import { DataFilesProvider } from './views/dataFilesProvider.js';

type ActionNode = vscode.TreeItem | import('./views/dataFilesProvider.js').DataFileNode;
const DATA_EDITOR_VIEW_TYPE = 'quackwrangler.dataEditor';

class QuackWranglerDocument implements vscode.CustomDocument {
  constructor(readonly uri: vscode.Uri) {}
  dispose(): void {}
}

class QuackWranglerEditorProvider implements vscode.CustomReadonlyEditorProvider {
  openCustomDocument(uri: vscode.Uri): QuackWranglerDocument {
    return new QuackWranglerDocument(uri);
  }

  async resolveCustomEditor(
    document: QuackWranglerDocument,
    webviewPanel: vscode.WebviewPanel,
  ): Promise<void> {
    await openDataWranglerCustomEditor(document.uri, webviewPanel);
  }
}

class QuackWranglerActionsProvider implements vscode.TreeDataProvider<ActionNode> {
  private readonly changeEmitter = new vscode.EventEmitter<ActionNode | undefined>();
  readonly onDidChangeTreeData = this.changeEmitter.event;

  constructor(private readonly dataFiles: DataFilesProvider) {
    this.dataFiles.onDidChangeTreeData(() => this.changeEmitter.fire(undefined));
  }

  getTreeItem(element: ActionNode): vscode.TreeItem {
    return element instanceof vscode.TreeItem ? element : this.dataFiles.getTreeItem(element);
  }

  getChildren(element?: ActionNode): ActionNode[] {
    if (element && !(element instanceof vscode.TreeItem)) return this.dataFiles.getChildren(element);
    if (element) return [];

    const openFileItem = new vscode.TreeItem('Open data file', vscode.TreeItemCollapsibleState.None);
    openFileItem.iconPath = new vscode.ThemeIcon('file');
    openFileItem.command = {
      command: 'quackwrangler.openDataWrangler',
      title: 'Open data file',
    };

    const openFolderItem = new vscode.TreeItem(
      'Open data folder',
      vscode.TreeItemCollapsibleState.None,
    );
    openFolderItem.iconPath = new vscode.ThemeIcon('folder-opened');
    openFolderItem.command = {
      command: 'quackwrangler.openFolder',
      title: 'Open data folder',
    };

    return [openFileItem, openFolderItem, ...this.dataFiles.getChildren()];
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const outputChannel = vscode.window.createOutputChannel('QuackWrangler');
  outputChannel.appendLine('QuackWrangler extension is now active');
  configureCommands(context.extensionUri, outputChannel);
  const dataFilesProvider = new DataFilesProvider();
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      DATA_EDITOR_VIEW_TYPE,
      new QuackWranglerEditorProvider(),
      {
        supportsMultipleEditorsPerDocument: false,
        webviewOptions: { retainContextWhenHidden: true },
      },
    ),
    vscode.window.registerTreeDataProvider(
      'quackwrangler.actions',
      new QuackWranglerActionsProvider(dataFilesProvider),
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('quackwrangler.openDataWrangler', () => {
      openDataWrangler();
    }),

    vscode.commands.registerCommand('quackwrangler.openFile', (uri?: vscode.Uri) => {
      openFile(uri);
    }),

    vscode.commands.registerCommand('quackwrangler.openFolder', async () => {
      await dataFilesProvider.selectFolder();
    }),

    vscode.commands.registerCommand('quackwrangler.refreshFolder', async () => {
      await dataFilesProvider.refresh();
    }),

    vscode.commands.registerCommand('quackwrangler.executeQuery', () => {
      executeQueryCommand();
    }),

    vscode.commands.registerCommand('quackwrangler.exportData', () => {
      exportDataCommand();
    }),

    vscode.commands.registerCommand('quackwrangler.summarizeFile', () => {
      summarizeFileCommand();
    }),

    vscode.commands.registerCommand('quackwrangler.showSchema', () => {
      showSchemaCommand();
    })
  );

  const filePatterns = getDataFilePatterns();
  const fileWatcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(vscode.workspace.workspaceFolders?.[0] || '', `{${filePatterns.join(',')}}`)
  );

  fileWatcher.onDidCreate((uri) => {
    outputChannel.appendLine(`Data file created: ${uri.fsPath}`);
  });

  fileWatcher.onDidDelete((uri) => {
    outputChannel.appendLine(`Data file deleted: ${uri.fsPath}`);
  });

  context.subscriptions.push(fileWatcher);

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('quackwrangler')) {
        outputChannel.appendLine('QuackWrangler configuration changed');
      }
    })
  );

  context.subscriptions.push(outputChannel);
}

export async function deactivate(): Promise<void> {
  await disposeCommands();
}
