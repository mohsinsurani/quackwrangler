import * as vscode from 'vscode';
import { DuckDBConnection } from '../duckdb/connection';
import { loadFilePreview, getFileMetadata, loadFile } from '../duckdb/parquet-loader';
import { executeQuery, exportResults } from '../duckdb/query-engine';
import { DataWranglerPanel } from '../webview/provider';
import { DataWranglerConfig, TransformOperation } from '../types';

function getConfig(): DataWranglerConfig {
  const config = vscode.workspace.getConfiguration('quackwrangler');
  return {
    memoryLimit: config.get<string>('memoryLimit', '1GB'),
    tempDirectory: config.get<string>('tempDirectory', ''),
    autoLoadExtensions: config.get<boolean>('autoLoadExtensions', true),
    maxRowsPreview: config.get<number>('maxRowsPreview', 100),
    exportFormat: config.get<'parquet' | 'csv' | 'json'>('exportFormat', 'parquet'),
  };
}

let connection: DuckDBConnection | null = null;
let outputChannel: vscode.OutputChannel;

async function getConnection(): Promise<DuckDBConnection> {
  if (!connection || !connection.isConnected()) {
    outputChannel = vscode.window.createOutputChannel('QuackWrangler');
    const config = getConfig();
    connection = new DuckDBConnection(config, outputChannel);
    await connection.connect();
  }
  return connection;
}

export async function openDataWrangler(filePath?: string): Promise<void> {
  const extensionUri = vscode.extensions.getExtension('quackwrangler.quackwrangler')?.extensionUri
    || vscode.Uri.file(__dirname);

  if (!filePath) {
    const uris = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectMany: false,
      filters: {
        'Data Files': ['parquet', 'csv', 'tsv', 'json', 'jsonl'],
      },
    });

    if (!uris || uris.length === 0) {
      return;
    }
    filePath = uris[0].fsPath;
  }

  const panel = DataWranglerPanel.createOrShow(extensionUri, filePath);

  try {
    const conn = await getConnection();
    const [schema, preview] = await Promise.all([
      getFileMetadata(conn, filePath),
      loadFilePreview(conn, filePath, getConfig().maxRowsPreview),
    ]);

    await loadFile(conn, filePath);
    panel.postMessage({ type: 'fileLoaded', schema, preview });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Failed to load file: ${message}`);
    panel.postMessage({ type: 'error', message });
  }
}

export async function openFile(uri?: vscode.Uri): Promise<void> {
  let filePath: string | undefined;

  if (uri) {
    filePath = uri.fsPath;
  } else {
    const uris = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectMany: false,
      filters: {
        'Data Files': ['parquet', 'csv', 'tsv', 'json', 'jsonl'],
      },
    });

    if (!uris || uris.length === 0) {
      return;
    }
    filePath = uris[0].fsPath;
  }

  if (filePath) {
    await openDataWrangler(filePath);
  }
}

export async function executeQueryCommand(): Promise<void> {
  const sql = await vscode.window.showInputBox({
    prompt: 'Enter SQL query',
    placeHolder: 'SELECT * FROM current_data LIMIT 100',
  });

  if (!sql) {
    return;
  }

  try {
    const conn = await getConnection();
    const result = await executeQuery(conn, sql);
    const panel = DataWranglerPanel.currentPanel;
    if (panel) {
      panel.postMessage({ type: 'queryResult', result });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Query failed: ${message}`);
  }
}

export async function exportDataCommand(): Promise<void> {
  const format = await vscode.window.showQuickPick(['parquet', 'csv', 'json'], {
    placeHolder: 'Select export format',
  });

  if (!format) {
    return;
  }

  const defaultUri = DataWranglerPanel.currentPanel?.filePath
    ? vscode.Uri.file(DataWranglerPanel.currentPanel.filePath.replace(/\.[^.]+$/, `.${format}`))
    : undefined;

  const uri = await vscode.window.showSaveDialog({
    defaultUri,
    filters: {
      [format.toUpperCase()]: [format],
    },
  });

  if (!uri) {
    return;
  }

  try {
    const conn = await getConnection();
    await exportResults(conn, 'SELECT * FROM current_data', uri.fsPath, format as any);
    vscode.window.showInformationMessage(`Data exported to ${uri.fsPath}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Export failed: ${message}`);
  }
}

export async function summarizeFileCommand(): Promise<void> {
  const filePath = DataWranglerPanel.currentPanel?.filePath;
  if (!filePath) {
    vscode.window.showWarningMessage('No file loaded. Open a file first.');
    return;
  }

  try {
    const conn = await getConnection();
    const sql = `SELECT * FROM current_data`;
    const result = await conn.query(sql);

    const summaryLines: string[] = [`File: ${filePath}`, `Rows: ${result.rowCount}`, ''];

    const columnStats = await conn.query(`
      SELECT
        column_name,
        data_type
      FROM information_schema.columns
      WHERE table_name = 'current_data'
    `);

    summaryLines.push('Schema:');
    for (const row of columnStats.rows) {
      summaryLines.push(`  ${row[0]}: ${row[1]}`);
    }

    const panel = DataWranglerPanel.currentPanel;
    if (panel) {
      panel.postMessage({ type: 'summary', summary: summaryLines.join('\n') });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Summarize failed: ${message}`);
  }
}

export async function showSchemaCommand(): Promise<void> {
  const filePath = DataWranglerPanel.currentPanel?.filePath;
  if (!filePath) {
    vscode.window.showWarningMessage('No file loaded. Open a file first.');
    return;
  }

  try {
    const conn = await getConnection();
    const schema = await getFileMetadata(conn, filePath);

    const panel = DataWranglerPanel.currentPanel;
    if (panel) {
      panel.postMessage({ type: 'schema', schema });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Failed to get schema: ${message}`);
  }
}
