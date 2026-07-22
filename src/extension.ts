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
} from './commands/index.js';
import { getDataFilePatterns } from './utils/fileDetector.js';

class QuackWranglerActionsProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  constructor(private readonly extensionUri: vscode.Uri) {}

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): vscode.TreeItem[] {
    const openFileItem = new vscode.TreeItem('Open data file', vscode.TreeItemCollapsibleState.None);
    openFileItem.iconPath = new vscode.ThemeIcon('folder-opened');
    openFileItem.command = {
      command: 'quackwrangler.openDataWrangler',
      title: 'Open data file',
    };

    const sampleItem = new vscode.TreeItem('Open sample CSV', vscode.TreeItemCollapsibleState.None);
    sampleItem.iconPath = new vscode.ThemeIcon('table');
    sampleItem.command = {
      command: 'quackwrangler.openFile',
      title: 'Open sample CSV',
      arguments: [vscode.Uri.joinPath(this.extensionUri, 'tests', 'fixtures', 'sample.csv')],
    };

    return [openFileItem, sampleItem];
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const outputChannel = vscode.window.createOutputChannel('QuackWrangler');
  outputChannel.appendLine('QuackWrangler extension is now active');
  configureCommands(context.extensionUri, outputChannel);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider(
      'quackwrangler.actions',
      new QuackWranglerActionsProvider(context.extensionUri),
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('quackwrangler.openDataWrangler', () => {
      openDataWrangler();
    }),

    vscode.commands.registerCommand('quackwrangler.openFile', (uri?: vscode.Uri) => {
      openFile(uri);
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
