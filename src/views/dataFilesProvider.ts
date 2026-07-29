import * as path from 'path';

import * as vscode from 'vscode';

import { isDataFile } from '../utils/fileDetector.js';

export interface DataFileNode {
  type: 'folder' | 'file';
  uri: vscode.Uri;
  children?: DataFileNode[];
}

function byFolderThenName(left: DataFileNode, right: DataFileNode): number {
  if (left.type !== right.type) return left.type === 'folder' ? -1 : 1;
  return path.basename(left.uri.fsPath).localeCompare(path.basename(right.uri.fsPath), undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

export async function scanDataFolder(uri: vscode.Uri): Promise<DataFileNode[]> {
  let entries: [string, vscode.FileType][];
  try {
    entries = await vscode.workspace.fs.readDirectory(uri);
  } catch {
    return [];
  }

  const nodes = await Promise.all(
    entries.map(async ([name, type]): Promise<DataFileNode | undefined> => {
      const childUri = vscode.Uri.joinPath(uri, name);
      if ((type & vscode.FileType.Directory) !== 0) {
        const children = await scanDataFolder(childUri);
        return children.length > 0 ? { type: 'folder', uri: childUri, children } : undefined;
      }
      if ((type & vscode.FileType.File) !== 0 && isDataFile(name)) {
        return { type: 'file', uri: childUri };
      }
      return undefined;
    }),
  );

  return nodes.filter((node): node is DataFileNode => node !== undefined).sort(byFolderThenName);
}

export class DataFilesProvider implements vscode.TreeDataProvider<DataFileNode> {
  private readonly changeEmitter = new vscode.EventEmitter<DataFileNode | undefined>();
  private roots: DataFileNode[] = [];
  private selectedFolder: vscode.Uri | undefined;

  readonly onDidChangeTreeData = this.changeEmitter.event;

  get folder(): vscode.Uri | undefined {
    return this.selectedFolder;
  }

  async selectFolder(): Promise<boolean> {
    const selected = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: 'Select data folder',
      title: 'Select a folder containing data files',
      defaultUri: this.selectedFolder,
    });
    if (!selected?.[0]) return false;
    await this.setFolder(selected[0]);
    return true;
  }

  async setFolder(uri: vscode.Uri): Promise<void> {
    this.selectedFolder = uri;
    this.roots = await scanDataFolder(uri);
    this.changeEmitter.fire(undefined);
  }

  async refresh(): Promise<void> {
    if (this.selectedFolder) await this.setFolder(this.selectedFolder);
  }

  getTreeItem(node: DataFileNode): vscode.TreeItem {
    const item = new vscode.TreeItem(
      path.basename(node.uri.fsPath),
      node.type === 'folder'
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.None,
    );
    item.resourceUri = node.uri;
    item.contextValue = `quackwrangler.${node.type}`;
    item.iconPath = new vscode.ThemeIcon(node.type === 'folder' ? 'folder' : 'table');
    if (node.type === 'file') {
      item.command = {
        command: 'quackwrangler.openFile',
        title: 'Open in QuackWrangler',
        arguments: [node.uri],
      };
      item.tooltip = node.uri.fsPath;
    }
    return item;
  }

  getChildren(node?: DataFileNode): DataFileNode[] {
    return node?.children ?? this.roots;
  }
}
