import * as fs from 'fs';

import * as vscode from 'vscode';

import { WebviewMessage, ExtensionMessage } from '../types/index.js';

export class DataWranglerPanel {
  public static currentPanel: DataWranglerPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];
  private _filePath: string | undefined;
  private _messageDisposable: vscode.Disposable | undefined;

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

  public setMessageHandler(callback: (message: WebviewMessage) => void | Promise<void>): void {
    this._messageDisposable?.dispose();
    this._messageDisposable = this._panel.webview.onDidReceiveMessage(
      message => void Promise.resolve(callback(message)),
      null,
      this._disposables,
    );
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

  private _getHtmlForWebview(
    webview: vscode.Webview,
    extensionUri: vscode.Uri
  ): string {
    const indexPath = vscode.Uri.joinPath(extensionUri, 'dist', 'webview', 'index.html').fsPath;
    try {
      let html = fs.readFileSync(indexPath, 'utf8');
      html = html.replace(/<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]*>/gi, '');
      html = html.replace(/(src|href)="\/?(assets\/[^\"]+)"/g, (_match, attribute, asset) => {
        const uri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'webview', asset));
        return `${attribute}="${uri}"`;
      });
      return html.replace(
        '<head>',
        `<head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource};">`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `<!doctype html><html><body><h2>QuackWrangler webview is not built</h2><pre>${message}</pre></body></html>`;
    }
  }
}
