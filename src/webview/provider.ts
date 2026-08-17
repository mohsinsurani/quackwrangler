import * as fs from 'fs';

import * as vscode from 'vscode';

import { WebviewMessage, ExtensionMessage } from '../types/index.js';

export class DataWranglerPanel {
  // The currently active (focused/visible) panel - derived from view-state changes.
  public static currentPanel: DataWranglerPanel | undefined;
  // All live panels, used to recompute context after disposal.
  private static _allPanels = new Set<DataWranglerPanel>();
  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];
  private _filePath: string | undefined;
  private _messageDisposable: vscode.Disposable | undefined;
  // dbt state is per-panel, not global - allows independent context per editor.
  public dbtProjectRoot: string | undefined;

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel = panel;
    this._panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(extensionUri, 'dist', 'webview'),
        vscode.Uri.joinPath(extensionUri, 'media'),
      ],
    };
    this._panel.onDidDispose(() => this._cleanup(), null, this._disposables);
    // Track view-state changes so currentPanel always reflects the visible editor.
    this._panel.onDidChangeViewState(
      () => DataWranglerPanel._updateActivePanel(),
      null,
      this._disposables,
    );
    this._panel.webview.html = this._getHtmlForWebview(this._panel.webview, extensionUri);
  }

  private static _updateActivePanel(): void {
    // Find the panel that is currently active (focused), or fall back to any visible one.
    const active = [...DataWranglerPanel._allPanels].find((p) => p._panel.active);
    const visible = [...DataWranglerPanel._allPanels].find((p) => p._panel.visible);
    const candidate = active ?? visible;
    if (candidate !== DataWranglerPanel.currentPanel) {
      DataWranglerPanel.currentPanel = candidate;
      void vscode.commands.executeCommand(
        'setContext',
        'quackwrangler.dbtDetected',
        Boolean(candidate?.dbtProjectRoot),
      );
    }
  }

  public static createOrShow(extensionUri: vscode.Uri, filePath?: string): DataWranglerPanel {
    const column = vscode.ViewColumn.One;

    const panel = vscode.window.createWebviewPanel('dataWrangler', 'QuackWrangler', column, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [
        vscode.Uri.joinPath(extensionUri, 'dist', 'webview'),
        vscode.Uri.joinPath(extensionUri, 'media'),
      ],
    });

    const instance = new DataWranglerPanel(panel, extensionUri);
    DataWranglerPanel._allPanels.add(instance);
    if (filePath) instance._filePath = filePath;
    DataWranglerPanel.currentPanel = instance;
    return instance;
  }

  public static attach(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    filePath: string,
  ): DataWranglerPanel {
    const instance = new DataWranglerPanel(panel, extensionUri);
    DataWranglerPanel._allPanels.add(instance);
    instance._filePath = filePath;
    DataWranglerPanel._updateActivePanel();
    return instance;
  }

  public postMessage(message: ExtensionMessage): void {
    this._panel.webview.postMessage(message);
  }

  public setMessageHandler(callback: (message: WebviewMessage) => void | Promise<void>): void {
    this._messageDisposable?.dispose();
    this._messageDisposable = this._panel.webview.onDidReceiveMessage(
      (message) => void Promise.resolve(callback(message)),
      null,
      this._disposables,
    );
  }

  private _cleanup(): void {
    DataWranglerPanel._allPanels.delete(this);
    if (DataWranglerPanel.currentPanel === this) {
      DataWranglerPanel.currentPanel = undefined;
    }
    // Recompute context from any remaining panels.
    DataWranglerPanel._updateActivePanel();
    // If no panels remain, ensure context is cleared.
    if (DataWranglerPanel._allPanels.size === 0) {
      void vscode.commands.executeCommand('setContext', 'quackwrangler.dbtDetected', false);
    }
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

  private _getHtmlForWebview(webview: vscode.Webview, extensionUri: vscode.Uri): string {
    const indexPath = vscode.Uri.joinPath(extensionUri, 'dist', 'webview', 'index.html').fsPath;
    try {
      let html = fs.readFileSync(indexPath, 'utf8');
      html = html.replace(/<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]*>/gi, '');
      html = html.replace(/(src|href)="\/?(assets\/[^\"]+)"/g, (_match, attribute, asset) => {
        const uri = webview.asWebviewUri(
          vscode.Uri.joinPath(extensionUri, 'dist', 'webview', asset),
        );
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
