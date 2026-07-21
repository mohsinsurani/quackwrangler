import * as vscode from 'vscode';
import * as path from 'path';
import { WebviewMessage, ExtensionMessage } from '../types';

export class DataWranglerPanel {
  public static currentPanel: DataWranglerPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];
  private _filePath: string | undefined;

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel = panel;
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this._panel.webview.html = this._getHtmlForWebview(this._panel.webview, extensionUri);
  }

  public static createOrShow(
    extensionUri: vscode.Uri,
    filePath?: string
  ): DataWranglerPanel {
    const column = vscode.ViewColumn.One;

    if (DataWranglerPanel.currentPanel) {
      DataWranglerPanel.currentPanel._panel.reveal(column);
      if (filePath) {
        DataWranglerPanel.currentPanel._filePath = filePath;
        DataWranglerPanel.currentPanel._postMessage({ type: 'loadFile', filePath });
      }
      return DataWranglerPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      'dataWrangler',
      'QuackWrangler',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, 'dist', 'webview'),
          vscode.Uri.joinPath(extensionUri, 'media'),
        ],
      }
    );

    DataWranglerPanel.currentPanel = new DataWranglerPanel(panel, extensionUri);
    if (filePath) {
      DataWranglerPanel.currentPanel._filePath = filePath;
    }
    return DataWranglerPanel.currentPanel;
  }

  public static revive(panel: vscode.WebviewPanel, extensionUri: vscode.Uri): void {
    DataWranglerPanel.currentPanel = new DataWranglerPanel(panel, extensionUri);
  }

  public postMessage(message: ExtensionMessage): void {
    this._panel.webview.postMessage(message);
  }

  public onDidReceiveMessage(
    callback: (message: WebviewMessage) => void
  ): vscode.Disposable {
    return this._panel.webview.onDidReceiveMessage(callback, null, this._disposables);
  }

  public dispose(): void {
    DataWranglerPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const disposable = this._disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }

  public get filePath(): string | undefined {
    return this._filePath;
  }

  private _postMessage(message: WebviewMessage): void {
    this._panel.webview.postMessage(message);
  }

  private _getHtmlForWebview(
    webview: vscode.Webview,
    extensionUri: vscode.Uri
  ): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'dist', 'webview', 'main.js')
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'dist', 'webview', 'main.css')
    );

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>QuackWrangler</title>
  <link rel="stylesheet" href="${styleUri}">
</head>
<body>
  <div id="app">
    <div class="header">
      <h1>🦆 QuackWrangler</h1>
      <div class="toolbar">
        <button id="btn-undo" title="Undo">↩</button>
        <button id="btn-redo" title="Redo">↪</button>
        <button id="btn-reset" title="Reset">⟳</button>
        <button id="btn-export" title="Export">💾</button>
      </div>
    </div>
    <div class="query-bar">
      <input type="text" id="query-input" placeholder="Enter SQL query..." />
      <button id="btn-execute">Execute</button>
    </div>
    <div class="content">
      <div class="table-container" id="data-table"></div>
      <div class="schema-panel" id="schema-panel"></div>
    </div>
    <div class="status-bar" id="status-bar">Ready</div>
  </div>
  <script src="${scriptUri}"></script>
</body>
</html>`;
  }
}
