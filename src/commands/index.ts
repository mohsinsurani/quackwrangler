import { readFile, writeFile } from 'node:fs/promises';

import * as vscode from 'vscode';

import { suggestTransforms } from '../ai/assistant.js';
import { DuckDBConnection } from '../duckdb/connection.js';
import { getFileMetadata, loadFile, prepareDataFileReader } from '../duckdb/parquet-loader.js';
import { exportResults, normalizeReadOnlyQuery } from '../duckdb/query-engine.js';
import { schemaComparisonMarkdown } from '../schema/compare.js';
import { WranglingSession } from '../transforms/pipeline.js';
import { DataWranglerConfig } from '../types/index.js';
import { WebviewMessage } from '../types/index.js';
import { DATA_FILE_EXTENSIONS } from '../utils/fileDetector.js';
import { isDataFile } from '../utils/fileDetector.js';
import {
  createRemoteProgressReporter,
  isRemoteDataSource,
  REMOTE_LOAD_STAGES,
} from '../utils/remoteProgress.js';
import { DataWranglerPanel } from '../webview/provider.js';

const DATA_FILE_FILTER = { 'Data Files': [...DATA_FILE_EXTENSIONS] };

function getConfig(): DataWranglerConfig {
  const config = vscode.workspace.getConfiguration('quackwrangler');
  return {
    memoryLimit: config.get<string>('duckdb.memoryLimit', '1GB'),
    tempDirectory: config.get<string>('duckdb.tempDirectory', ''),
    maxTempDirectorySize: config.get<string>('duckdb.maxTempDirectorySize', '15GB'),
    autoLoadExtensions: config.get<string[]>('duckdb.autoLoadExtensions', []),
    pageSize: config.get<number>('display.pageSize', 100),
    maxRowsPreview: config.get<number>('display.maxRows', 10000),
  };
}

let connection: DuckDBConnection | null = null;
let outputChannel: vscode.OutputChannel;
let configuredExtensionUri: vscode.Uri | undefined;
let extensionContext: vscode.ExtensionContext | undefined;
let recentFilesChanged: (() => void) | undefined;
const RECENT_FILES_KEY = 'quackwrangler.recentFiles';
interface PanelState {
  session: WranglingSession | null;
  customQuerySql: string | null;
  searchQuery: string;
}
const panelStates = new WeakMap<DataWranglerPanel, PanelState>();
const WEBVIEW_PROTOCOL_VERSION = 2;

function getPanelState(panel: DataWranglerPanel): PanelState {
  let state = panelStates.get(panel);
  if (!state) {
    state = { session: null, customQuerySql: null, searchQuery: '' };
    panelStates.set(panel, state);
  }
  return state;
}

export function configureCommands(
  extensionUri: vscode.Uri,
  channel: vscode.OutputChannel,
  context?: vscode.ExtensionContext,
  onRecentFilesChanged?: () => void,
): void {
  configuredExtensionUri = extensionUri;
  outputChannel = channel;
  extensionContext = context;
  recentFilesChanged = onRecentFilesChanged;
}

export function getRecentFiles(): string[] {
  return extensionContext?.globalState.get<string[]>(RECENT_FILES_KEY, []) ?? [];
}

async function rememberRecentFile(filePath: string): Promise<void> {
  if (!extensionContext || filePath.endsWith('.qw')) return;
  const recent = [filePath, ...getRecentFiles().filter((item) => item !== filePath)].slice(0, 10);
  await extensionContext.globalState.update(RECENT_FILES_KEY, recent);
  recentFilesChanged?.();
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

async function postSession(
  panel: DataWranglerPanel,
  offset = 0,
  limit = getConfig().pageSize,
): Promise<void> {
  const { session } = getPanelState(panel);
  if (!session) throw new Error('No active wrangling session');
  const state = await session.getPage(offset, limit);
  panel.postMessage({
    type: 'sessionUpdated',
    protocolVersion: WEBVIEW_PROTOCOL_VERSION,
    schema: state.schema,
    result: state.result,
    history: session.getHistory(),
    page: state.page,
  });
}

async function postCustomQuery(panel: DataWranglerPanel, offset = 0, limit = 100): Promise<void> {
  const { session, customQuerySql } = getPanelState(panel);
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
      columns: described.rows.map((row) => ({
        name: String(row[0]),
        type: String(row[1]),
        nullable: String(row[2]).toUpperCase() === 'YES',
      })),
      rowCount: totalRows,
      filePath: session.getFilePath(),
    },
    result,
    page: { offset, limit, totalRows },
  });
}

async function handleWebviewMessage(
  panel: DataWranglerPanel,
  message: WebviewMessage,
): Promise<void> {
  const state = getPanelState(panel);
  const { session } = state;
  try {
    switch (message.type) {
      case 'ready':
        if (session) await postSession(panel);
        return;
      case 'openFilePicker':
        await openFile();
        return;
      case 'openFolderPicker':
        await vscode.commands.executeCommand('quackwrangler.openFolder');
        return;
      case 'selectSecondaryFile': {
        const selected = await vscode.window.showOpenDialog({
          canSelectFiles: true,
          canSelectMany: false,
          filters: DATA_FILE_FILTER,
          openLabel: 'Select file to join or union',
        });
        if (!selected?.[0]) return;
        const conn = await getConnection();
        const metadata = await getFileMetadata(conn, selected[0].fsPath);
        panel.postMessage({
          type: 'secondaryFileSelected',
          filePath: selected[0].fsPath,
          columns: metadata.columns,
        });
        return;
      }
      case 'applyTransform':
        if (!session) throw new Error('Open a data file before applying a transform');
        state.customQuerySql = null;
        state.searchQuery = '';
        if (['join_file', 'union_file'].includes(message.transform.type)) {
          await prepareDataFileReader(
            await getConnection(),
            String(message.transform.params.filePath ?? ''),
          );
        }
        session.apply(message.transform.type, message.transform.params);
        await postSession(panel);
        return;
      case 'undo':
        state.customQuerySql = null;
        session?.undo();
        await postSession(panel);
        return;
      case 'redo':
        state.customQuerySql = null;
        session?.redo();
        await postSession(panel);
        return;
      case 'removeTransform':
        state.customQuerySql = null;
        session?.remove(message.id);
        await postSession(panel);
        return;
      case 'reorderTransforms':
        state.customQuerySql = null;
        session?.reorder(message.sourceId, message.targetId);
        await postSession(panel);
        return;
      case 'pageChange':
        if (state.customQuerySql) await postCustomQuery(panel, message.offset, message.limit);
        else if (state.searchQuery && session) {
          const searched = await session.search(state.searchQuery, message.offset, message.limit);
          panel.postMessage({ type: 'searchResult', ...searched, query: state.searchQuery });
        } else await postSession(panel, message.offset, message.limit);
        return;
      case 'searchRows':
        if (!session) throw new Error('Open a data file before searching');
        state.customQuerySql = null;
        state.searchQuery = message.query.trim();
        if (!state.searchQuery) {
          await postSession(panel);
          return;
        }
        {
          const searched = await session.search(state.searchQuery, 0, 100);
          panel.postMessage({ type: 'searchResult', ...searched, query: state.searchQuery });
        }
        return;
      case 'executeCustomQuery':
        if (!session) throw new Error('Open a data file before running a query');
        state.searchQuery = '';
        state.customQuerySql = normalizeReadOnlyQuery(message.sql);
        await postCustomQuery(panel);
        return;
      case 'clearCustomQuery':
        state.customQuerySql = null;
        await postSession(panel);
        return;
      case 'refresh':
        if (!session?.getFilePath()) return;
        state.customQuerySql = null;
        await loadDataIntoPanel(panel, session.getFilePath());
        return;
      case 'getStats':
        if (!session) throw new Error('No active wrangling session');
        {
          const stats = await session.getStatistics();
          panel.postMessage({
            type: 'stats',
            stats,
            quality: await session.getQualitySummary(stats),
          });
        }
        return;
      case 'requestChart':
        if (!session) throw new Error('No active wrangling session');
        panel.postMessage({
          type: 'chartResult',
          chart: message.chart,
          result: await session.getChartData(message.chart),
        });
        return;
      case 'exportData': {
        if (!session) throw new Error('Open a data file before exporting');
        const sourcePath = session.getFilePath();
        const remoteSource = /^(https?|s3):\/\//i.test(sourcePath);
        const defaultPath = remoteSource
          ? undefined
          : sourcePath.replace(/\.[^.]+$/, `_transformed.${message.format}`);
        const target = message.outputPath
          ? vscode.Uri.file(message.outputPath)
          : await vscode.window.showSaveDialog({
              defaultUri: defaultPath ? vscode.Uri.file(defaultPath) : undefined,
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
        vscode.window.showInformationMessage(
          `Exported ${message.format.toUpperCase()} to ${target.fsPath}`,
        );
        return;
      }
      default:
        return;
    }
  } catch (error) {
    panel.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function openDataWrangler(filePath?: string): Promise<void> {
  const extensionUri =
    configuredExtensionUri ??
    vscode.extensions.getExtension('quackwrangler.quackwrangler')?.extensionUri;

  if (!filePath) {
    const uris = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectMany: false,
      filters: DATA_FILE_FILTER,
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
  await loadDataIntoPanel(panel, filePath);
}

export async function openRemoteDataCommand(): Promise<void> {
  const source = await vscode.window.showInputBox({
    title: 'Open remote data in QuackWrangler',
    prompt: 'Enter an HTTPS or S3 URL. Credentials remain managed by DuckDB/AWS configuration.',
    placeHolder: 'https://example.com/data.parquet or s3://bucket/data.parquet',
    validateInput: (value) =>
      /^(https:\/\/|s3:\/\/)/i.test(value.trim()) ? undefined : 'Use an HTTPS or S3 URL',
  });
  if (source) await openDataWrangler(source.trim());
}

export async function configureAICommand(): Promise<void> {
  if (!extensionContext) throw new Error('Extension context is unavailable');
  const key = await vscode.window.showInputBox({
    title: 'Configure OpenAI for QuackWrangler',
    prompt: 'Stored in VS Code SecretStorage. Only schema metadata and your instruction are sent.',
    password: true,
    ignoreFocusOut: true,
  });
  if (key?.trim()) {
    await extensionContext.secrets.store('quackwrangler.openaiApiKey', key.trim());
    vscode.window.showInformationMessage('QuackWrangler OpenAI key stored securely.');
  }
}

export async function generateAITransformsCommand(): Promise<void> {
  const panel = DataWranglerPanel.currentPanel;
  const session = panel ? getPanelState(panel).session : null;
  if (!panel || !session || !extensionContext) throw new Error('Open a data file first');
  let key = await extensionContext.secrets.get('quackwrangler.openaiApiKey');
  if (!key) {
    await configureAICommand();
    key = await extensionContext.secrets.get('quackwrangler.openaiApiKey');
  }
  if (!key) return;
  const goal = await vscode.window.showInputBox({
    title: 'Generate visual transforms',
    prompt: 'Describe the desired result. No row values will be sent.',
    placeHolder: 'Remove duplicates and keep active customers after 2025',
  });
  if (!goal) return;
  const schema = (await session.getPage(0, 1)).schema;
  const model = vscode.workspace
    .getConfiguration('quackwrangler')
    .get<string>('ai.model', 'gpt-5.6-luna');
  const suggestions = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Generating schema-only transform plan…',
    },
    () => suggestTransforms(key!, model, goal, schema.columns),
  );
  if (!suggestions.length) {
    vscode.window.showInformationMessage('No transforms were suggested.');
    return;
  }
  const preview = suggestions
    .map((item, index) => `${index + 1}. ${item.type} ${JSON.stringify(item.params)}`)
    .join('\n');
  const approval = await vscode.window.showInformationMessage(
    `Apply this AI-generated plan?\n${preview}`,
    { modal: true },
    'Apply transforms',
  );
  if (approval !== 'Apply transforms') return;
  let applied = 0;
  try {
    for (const suggestion of suggestions) {
      session.apply(suggestion.type, suggestion.params);
      applied += 1;
    }
  } catch (error) {
    while (applied-- > 0) session.undo();
    throw error;
  }
  await postSession(panel);
}

async function collectDataFiles(
  folder: vscode.Uri,
  output: vscode.Uri[] = [],
): Promise<vscode.Uri[]> {
  for (const [name, type] of await vscode.workspace.fs.readDirectory(folder)) {
    const child = vscode.Uri.joinPath(folder, name);
    if (type === vscode.FileType.Directory) await collectDataFiles(child, output);
    else if (
      type === vscode.FileType.File &&
      isDataFile(name) &&
      !name.toLowerCase().endsWith('.orc')
    )
      output.push(child);
  }
  return output;
}

export async function compareSchemasCommand(folderMode = false): Promise<void> {
  let files: vscode.Uri[];
  if (folderMode) {
    const folder = (
      await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: false,
        openLabel: 'Analyze schema drift',
      })
    )?.[0];
    if (!folder) return;
    files = await collectDataFiles(folder);
  } else {
    files =
      (await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectMany: true,
        filters: DATA_FILE_FILTER,
        openLabel: 'Compare schemas',
      })) ?? [];
  }
  if (files.length < 2) throw new Error('Select a folder or at least two supported files');
  const conn = await getConnection();
  const schemas = [];
  for (const file of files.slice(0, 100)) schemas.push(await getFileMetadata(conn, file.fsPath));
  const document = await vscode.workspace.openTextDocument({
    language: 'markdown',
    content: schemaComparisonMarkdown(schemas),
  });
  await vscode.window.showTextDocument(document, { preview: false });
}

async function loadDataIntoPanel(panel: DataWranglerPanel, filePath: string): Promise<void> {
  const state = getPanelState(panel);
  state.session = null;
  state.customQuerySql = null;
  state.searchQuery = '';
  panel.setMessageHandler((message) => handleWebviewMessage(panel, message));

  try {
    const remote = isRemoteDataSource(filePath);
    const progress = createRemoteProgressReporter(filePath, (stage) =>
      panel.postMessage({ type: 'loadingProgress', ...stage }),
    );
    progress(REMOTE_LOAD_STAGES.connecting);
    const conn = await getConnection();
    progress(REMOTE_LOAD_STAGES.preparing);
    if (remote) await prepareDataFileReader(conn, filePath);
    progress(REMOTE_LOAD_STAGES.reading);
    await loadFile(conn, filePath);
    progress(REMOTE_LOAD_STAGES.previewing);
    state.session = new WranglingSession(conn);
    state.session.load(filePath);
    await rememberRecentFile(filePath);
    const config = getConfig();
    progress(REMOTE_LOAD_STAGES.ready);
    await postSession(panel, 0, Math.min(config.maxRowsPreview, config.pageSize));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Failed to load file: ${message}`);
    panel.postMessage({ type: 'error', message });
  }
}

interface SavedWorkspace {
  version: 1;
  sourceFile: string;
  transforms: Array<{ type: string; params: Record<string, unknown> }>;
}

export async function saveWorkspaceCommand(): Promise<void> {
  const panel = DataWranglerPanel.currentPanel;
  const session = panel ? getPanelState(panel).session : null;
  if (!session) {
    vscode.window.showWarningMessage('Open a data file before saving a workspace.');
    return;
  }
  const target = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(session.getFilePath().replace(/\.[^.]+$/, '.qw')),
    filters: { 'QuackWrangler Workspace': ['qw'] },
    saveLabel: 'Save QuackWrangler Workspace',
  });
  if (!target) return;
  const workspace: SavedWorkspace = {
    version: 1,
    sourceFile: session.getFilePath(),
    transforms: session.getHistory().map(({ type, params }) => ({ type, params })),
  };
  await writeFile(target.fsPath, `${JSON.stringify(workspace, null, 2)}\n`, 'utf8');
  vscode.window.showInformationMessage(`Saved QuackWrangler workspace to ${target.fsPath}`);
}

export async function openWorkspaceCommand(uri?: vscode.Uri): Promise<void> {
  const selected =
    uri ??
    (
      await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectMany: false,
        filters: { 'QuackWrangler Workspace': ['qw'] },
        openLabel: 'Open QuackWrangler Workspace',
      })
    )?.[0];
  if (!selected) return;
  const parsed = JSON.parse(await readFile(selected.fsPath, 'utf8')) as Partial<SavedWorkspace>;
  if (
    parsed.version !== 1 ||
    typeof parsed.sourceFile !== 'string' ||
    !Array.isArray(parsed.transforms)
  ) {
    throw new Error('This is not a valid QuackWrangler workspace file');
  }
  const extensionUri =
    configuredExtensionUri ??
    vscode.extensions.getExtension('quackwrangler.quackwrangler')?.extensionUri;
  if (!extensionUri) throw new Error('Extension URI not found');
  const panel = DataWranglerPanel.createOrShow(extensionUri, parsed.sourceFile);
  await loadDataIntoPanel(panel, parsed.sourceFile);
  const session = getPanelState(panel).session;
  session?.restore(
    parsed.transforms.map((step) => ({ type: String(step.type), params: step.params ?? {} })),
  );
  await postSession(panel);
}

export async function openDataWranglerCustomEditor(
  documentUri: vscode.Uri,
  webviewPanel: vscode.WebviewPanel,
): Promise<void> {
  const extensionUri =
    configuredExtensionUri ??
    vscode.extensions.getExtension('quackwrangler.quackwrangler')?.extensionUri;
  if (!extensionUri) throw new Error('Extension URI not found');

  const panel = DataWranglerPanel.attach(webviewPanel, extensionUri, documentUri.fsPath);
  await loadDataIntoPanel(panel, documentUri.fsPath);
}

export async function openFile(uri?: vscode.Uri | string): Promise<void> {
  let filePath: string | undefined;

  if (uri) {
    filePath = typeof uri === 'string' ? uri : uri.fsPath;
  } else {
    const uris = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectMany: false,
      filters: DATA_FILE_FILTER,
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
    const panel = DataWranglerPanel.currentPanel;
    const activeSession = panel ? getPanelState(panel).session : null;
    await exportResults(
      conn,
      activeSession?.getSql() ?? 'SELECT * FROM current_data',
      uri.fsPath,
      format as 'parquet' | 'csv' | 'json',
    );
    vscode.window.showInformationMessage(`Data exported to ${uri.fsPath}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Export failed: ${message}`);
  }
}

export async function disposeCommands(): Promise<void> {
  await connection?.close();
  connection = null;
}

export async function summarizeFileCommand(): Promise<void> {
  const panel = DataWranglerPanel.currentPanel;
  const activeSession = panel ? getPanelState(panel).session : null;
  if (!panel || !activeSession) {
    vscode.window.showWarningMessage('No file loaded. Open a file first.');
    return;
  }

  try {
    const stats = await activeSession.getStatistics();
    panel.postMessage({
      type: 'stats',
      stats,
      quality: await activeSession.getQualitySummary(stats),
    });
    vscode.window.showInformationMessage(
      `Summarized ${stats.length} columns in ${activeSession.getFilePath().split(/[\\/]/).pop()}`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Summarize failed: ${message}`);
  }
}
