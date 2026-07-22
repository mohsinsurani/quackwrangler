import * as vscode from 'vscode';

import { DuckDBConnection } from '../duckdb/connection.js';
import { getFileMetadata, loadFile } from '../duckdb/parquet-loader.js';
import { executeQuery, exportResults, normalizeReadOnlyQuery } from '../duckdb/query-engine.js';
import { generateDuckDBPython, generatePolarsPython } from '../transforms/codegen.js';
import { WranglingSession } from '../transforms/pipeline.js';
import { DataWranglerConfig } from '../types/index.js';
import { WebviewMessage } from '../types/index.js';
import { DataWranglerPanel } from '../webview/provider.js';

function getConfig(): DataWranglerConfig {
  const config = vscode.workspace.getConfiguration('quackwrangler');
  return {
    memoryLimit: config.get<string>('duckdb.memoryLimit', '1GB'),
    tempDirectory: config.get<string>('duckdb.tempDirectory', ''),
    autoLoadExtensions: config.get<string[]>('duckdb.autoLoadExtensions', []),
    maxRowsPreview: config.get<number>('display.maxRows', 10000),
    exportFormat: config.get<'parquet' | 'csv' | 'json'>('display.exportFormat', 'parquet'),
    engine: 'duckdb',
    defaultExportEngine: 'duckdb',
  };
}

let connection: DuckDBConnection | null = null;
let outputChannel: vscode.OutputChannel;
let session: WranglingSession | null = null;
let configuredExtensionUri: vscode.Uri | undefined;
let customQuerySql: string | null = null;
const WEBVIEW_PROTOCOL_VERSION = 2;

export function configureCommands(extensionUri: vscode.Uri, channel: vscode.OutputChannel): void {
  configuredExtensionUri = extensionUri;
  outputChannel = channel;
}

async function getConnection(): Promise<DuckDBConnection> {
  if (!connection || !connection.isConnected()) {
    outputChannel ??= vscode.window.createOutputChannel('QuackWrangler');
    const config = getConfig();
    connection = new DuckDBConnection(config, outputChannel);
    await connection.connect();
  }
  return connection;
}

async function postSession(panel: DataWranglerPanel, offset = 0, limit = 100): Promise<void> {
  if (!session) throw new Error('No active wrangling session');
  const history = session.getHistory();
  let state: Awaited<ReturnType<WranglingSession['getPage']>>;
  state = await session.getPage(offset, limit);
  let polarsPython: string;
  try {
    polarsPython = generatePolarsPython(history, session.getFilePath());
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    outputChannel.appendLine(`[Code generation] Polars export unavailable: ${detail}`);
    polarsPython = `# Polars export could not be generated for this pipeline\n# ${detail}`;
  }
  panel.postMessage({
    type: 'sessionUpdated', protocolVersion: WEBVIEW_PROTOCOL_VERSION, schema: state.schema, result: state.result, history, engine: session.getEngine(), page: state.page,
    code: {
      sql: session.getSql(),
      duckdbPython: generateDuckDBPython(history, session.getFilePath()),
      polarsPython,
    },
  });
}

async function postCustomQuery(panel: DataWranglerPanel, offset = 0, limit = 100): Promise<void> {
  if (!session || !customQuerySql) throw new Error('No custom query is active');
  const conn = await getConnection();
  const [result, count, described] = await Promise.all([
    conn.query(`SELECT * FROM (${customQuerySql}) AS custom_query LIMIT ${limit} OFFSET ${offset}`),
    conn.query(`SELECT COUNT(*) FROM (${customQuerySql}) AS custom_query_count`),
    conn.query(`DESCRIBE SELECT * FROM (${customQuerySql}) AS custom_query_schema`),
  ]);
  const totalRows = Number(count.rows[0]?.[0] ?? 0);
  panel.postMessage({
    type: 'customQueryResult',
    schema: {
      columns: described.rows.map(row => ({
        name: String(row[0]), type: String(row[1]), nullable: String(row[2]).toUpperCase() === 'YES',
      })),
      rowCount: totalRows,
      filePath: session.getFilePath(),
    },
    result,
    page: { offset, limit, totalRows },
  });
}

async function handleWebviewMessage(panel: DataWranglerPanel, message: WebviewMessage): Promise<void> {
  try {
    switch (message.type) {
      case 'ready':
        if (session) await postSession(panel);
        return;
      case 'openFilePicker':
        await openFile();
        return;
      case 'loadFile':
        await openDataWrangler(message.filePath);
        return;
      case 'applyTransform':
        if (!session) throw new Error('Open a data file before applying a transform');
        customQuerySql = null;
        session.apply(message.transform.type, message.transform.params);
        await postSession(panel);
        return;
      case 'undo': customQuerySql = null; session?.undo(); await postSession(panel); return;
      case 'redo': customQuerySql = null; session?.redo(); await postSession(panel); return;
      case 'reset': customQuerySql = null; session?.reset(); await postSession(panel); return;
      case 'removeTransform': customQuerySql = null; session?.remove(message.id); await postSession(panel); return;
      case 'pageChange':
        if (customQuerySql) await postCustomQuery(panel, message.offset, message.limit);
        else await postSession(panel, message.offset, message.limit);
        return;
      case 'executeCustomQuery':
        if (!session) throw new Error('Open a data file before running a query');
        customQuerySql = normalizeReadOnlyQuery(message.sql);
        await postCustomQuery(panel);
        return;
      case 'clearCustomQuery':
        customQuerySql = null;
        await postSession(panel);
        return;
      case 'refresh':
        if (!session?.getFilePath()) return;
        customQuerySql = null;
        await openDataWrangler(session.getFilePath());
        return;
      case 'getStats':
        if (!session) throw new Error('No active wrangling session');
        panel.postMessage({ type: 'stats', stats: await session.getStatistics() });
        return;
      case 'exportData': {
        if (!session) throw new Error('Open a data file before exporting');
        const sourcePath = session.getFilePath();
        const defaultPath = sourcePath.replace(/\.[^.]+$/, `_transformed.${message.format}`);
        const target = message.outputPath
          ? vscode.Uri.file(message.outputPath)
          : await vscode.window.showSaveDialog({
              defaultUri: vscode.Uri.file(defaultPath),
              filters: { [message.format.toUpperCase()]: [message.format] },
              saveLabel: `Export ${message.format.toUpperCase()}`,
            });
        if (!target) {
          panel.postMessage({ type: 'exportComplete', outputPath: '' });
          return;
        }
        const conn = await getConnection();
        await exportResults(conn, session.getSql(), target.fsPath, message.format);
        panel.postMessage({ type: 'exportComplete', outputPath: target.fsPath });
        vscode.window.showInformationMessage(`Exported ${message.format.toUpperCase()} to ${target.fsPath}`);
        return;
      }
      default:
        return;
    }
  } catch (error) {
    panel.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
}

export async function openDataWrangler(filePath?: string): Promise<void> {
  const extensionUri = configuredExtensionUri ?? vscode.extensions.getExtension('quackwrangler.quackwrangler')?.extensionUri;

  if (!filePath) {
    const uris = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectMany: false,
      filters: {
        'Data Files': ['parquet', 'csv', 'tsv', 'json', 'jsonl', 'ndjson', 'xlsx', 'ods'],
      },
    });

    if (!uris || uris.length === 0) {
      return;
    }
    filePath = uris[0].fsPath;
  }

  if (!extensionUri) {
    vscode.window.showErrorMessage('Extension URI not found');
    return;
  }

  const panel = DataWranglerPanel.createOrShow(extensionUri, filePath);
  session = null;
  customQuerySql = null;
  panel.setMessageHandler(message => handleWebviewMessage(panel, message));

  try {
    const conn = await getConnection();
    await loadFile(conn, filePath);
    session = new WranglingSession(conn);
    session.load(filePath, getConfig().engine);
    await postSession(panel, 0, Math.min(getConfig().maxRowsPreview, 100));
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
        'Data Files': ['parquet', 'csv', 'tsv', 'json', 'jsonl', 'ndjson', 'xlsx', 'ods'],
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
    await exportResults(conn, session?.getSql() ?? 'SELECT * FROM current_data', uri.fsPath, format as 'parquet' | 'csv' | 'json');
    vscode.window.showInformationMessage(`Data exported to ${uri.fsPath}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Export failed: ${message}`);
  }
}

export async function disposeCommands(): Promise<void> {
  await connection?.close();
  connection = null;
  session = null;
  customQuerySql = null;
}

export async function summarizeFileCommand(): Promise<void> {
  const panel = DataWranglerPanel.currentPanel;
  if (!panel || !session) {
    vscode.window.showWarningMessage('No file loaded. Open a file first.');
    return;
  }

  try {
    const stats = await session.getStatistics();
    panel.postMessage({ type: 'stats', stats });
    vscode.window.showInformationMessage(
      `Summarized ${stats.length} columns in ${session.getFilePath().split(/[\\/]/).pop()}`,
    );
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
