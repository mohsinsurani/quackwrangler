import * as vscode from 'vscode';
import {
  openDataWrangler,
  openFile,
  executeQueryCommand,
  exportDataCommand,
  summarizeFileCommand,
  showSchemaCommand,
} from './commands';
import { getDataFilePatterns } from './utils/fileDetector';

export function activate(context: vscode.ExtensionContext): void {
  const outputChannel = vscode.window.createOutputChannel('QuackWrangler');
  outputChannel.appendLine('QuackWrangler extension is now active');

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

export function deactivate(): void {
  // Cleanup
}
