import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import * as vscode from 'vscode';

import { suggestTransforms, validateAISettings } from '../ai/assistant.js';
import { findDbtProject } from '../dbt/context.js';
import { buildDbtSql, DbtExportStyle } from '../dbt/export.js';
import { DuckDBConnection } from '../duckdb/connection.js';
import { getFileMetadata, loadFile, prepareDataFileReader } from '../duckdb/parquet-loader.js';
import { exportResults, normalizeReadOnlyQuery } from '../duckdb/query-engine.js';
import { schemaComparisonMarkdown } from '../schema/compare.js';
import { WranglingSession } from '../transforms/pipeline.js';
import { DataWranglerConfig } from '../types/index.js';
import { WebviewMessage } from '../types/index.js';
import { DATA_EDITOR_VIEW_TYPE, shouldOpenWithDataEditor } from '../utils/editorRouting.js';
import { DATA_FILE_EXTENSIONS } from '../utils/fileDetector.js';
import { isDataFile } from '../utils/fileDetector.js';
import {
  createRemoteProgressReporter,
  isRemoteDataSource,
  REMOTE_LOAD_STAGES,
} from '../utils/remoteProgress.js';
import { createManagedTempDirectory, ManagedTempDirectory } from '../utils/tempStorage.js';
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
    loadingMode: config.get<'auto' | 'eager' | 'lazy'>('duckdb.loadingMode', 'auto'),
    eagerFileSizeLimitMb: config.get<number>('duckdb.eagerFileSizeLimitMb', 64),
    threads: config.get<number>('duckdb.threads', 0),
    preserveInsertionOrder: config.get<boolean>('duckdb.preserveInsertionOrder', true),
  };
}

let connection: DuckDBConnection | null = null;
let managedTempDirectory: ManagedTempDirectory | undefined;
let outputChannel: vscode.OutputChannel;
let configuredExtensionUri: vscode.Uri | undefined;
let extensionContext: vscode.ExtensionContext | undefined;
let recentFilesChanged: (() => void) | undefined;
const RECENT_FILES_KEY = 'quackwrangler.recentFiles';
function newRelationName(): string {
  return `qw_${randomBytes(8).toString('hex')}`;
}

interface PanelState {
  session: WranglingSession | null;
  sessionId: string;
  customQuerySql: string | null;
  searchQuery: string;
  relationName: string;
}
const panelStates = new WeakMap<DataWranglerPanel, PanelState>();
const WEBVIEW_PROTOCOL_VERSION = 3;

function getPanelState(panel: DataWranglerPanel): PanelState {
  let state = panelStates.get(panel);
  if (!state) {
    state = {
      session: null,
      sessionId: newRelationName(),
      customQuerySql: null,
      searchQuery: '',
      relationName: newRelationName(),
    };
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
    if (config.tempDirectory) {
      await mkdir(config.tempDirectory, { recursive: true });
    } else {
      const storageRoot =
        extensionContext?.globalStorageUri.fsPath ?? join(tmpdir(), 'quackwrangler');
      managedTempDirectory = await createManagedTempDirectory(storageRoot);
      config.tempDirectory = managedTempDirectory.path;
    }
    connection = new DuckDBConnection(config, outputChannel);
    try {
      await connection.connect();
    } catch (error) {
      await cleanupManagedTempDirectory();
      connection = null;
      throw error;
    }
  }
  return connection;
}

async function cleanupManagedTempDirectory(): Promise<void> {
  const directory = managedTempDirectory;
  managedTempDirectory = undefined;
  if (!directory) return;
  try {
    await directory.cleanup();
  } catch (error) {
    outputChannel?.appendLine(
      `[DuckDB] Could not remove temporary directory ${directory.path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function postSession(
  panel: DataWranglerPanel,
  offset = 0,
  limit = getConfig().pageSize,
  requestId?: string,
): Promise<void> {
  const { session, sessionId } = getPanelState(panel);
  if (!session) throw new Error('No active wrangling session');
  const revision = session.getRevision();
  const state = await session.getPage(offset, limit);
  panel.postMessage({
    type: 'sessionUpdated',
    protocolVersion: WEBVIEW_PROTOCOL_VERSION,
    schema: state.schema,
    result: state.result,
    history: session.getHistory(),
    page: state.page,
    canUndo: session.canUndo(),
    canRedo: session.canRedo(),
    requestId,
    sessionId,
    revision,
  });
}

function getCustomQuerySource(session: WranglingSession, customQuerySql: string): string {
  return `WITH current_data AS (${session.getSql()}) SELECT * FROM (${customQuerySql}) AS custom_query`;
}

function getActiveExportSql(state: PanelState): string {
  if (!state.session) throw new Error('No active wrangling session');
  return state.customQuerySql
    ? getCustomQuerySource(state.session, state.customQuerySql)
    : state.session.getSql();
}

async function postCustomQuery(
  panel: DataWranglerPanel,
  offset = 0,
  limit = 100,
  requestId?: string,
): Promise<void> {
  const { session, sessionId, customQuerySql } = getPanelState(panel);
  if (!session || !customQuerySql) throw new Error('No custom query is active');
  const revision = session.getRevision();
  const sourceSql = getCustomQuerySource(session, customQuerySql);
  const conn = await getConnection();
  const [result, count, described] = await Promise.all([
    conn.query(`SELECT * FROM (${sourceSql}) AS custom_query_page LIMIT ${limit} OFFSET ${offset}`),
    conn.query(`SELECT COUNT(*) FROM (${sourceSql}) AS custom_query_count`),
    conn.query(`DESCRIBE SELECT * FROM (${sourceSql}) AS custom_query_schema`),
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
    requestId,
    sessionId,
    revision,
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
        if (session) await postSession(panel, 0, getConfig().pageSize, message.requestId);
        return;
      case 'openFilePicker':
        await selectFileIntoPanel(panel, message.requestId);
        return;
      case 'openFolderPicker':
        await selectFolderFileIntoPanel(panel, message.requestId);
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
          requestId: message.requestId,
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
        await postSession(panel, 0, getConfig().pageSize, message.requestId);
        return;
      case 'undo':
        state.customQuerySql = null;
        state.searchQuery = '';
        session?.undo();
        await postSession(panel, 0, getConfig().pageSize, message.requestId);
        return;
      case 'redo':
        state.customQuerySql = null;
        state.searchQuery = '';
        session?.redo();
        await postSession(panel, 0, getConfig().pageSize, message.requestId);
        return;
      case 'removeTransform':
        state.customQuerySql = null;
        state.searchQuery = '';
        session?.remove(message.id);
        await postSession(panel, 0, getConfig().pageSize, message.requestId);
        return;
      case 'reorderTransforms':
        state.customQuerySql = null;
        state.searchQuery = '';
        session?.reorder(message.sourceId, message.targetId);
        await postSession(panel, 0, getConfig().pageSize, message.requestId);
        return;
      case 'pageChange':
        if (state.customQuerySql)
          await postCustomQuery(panel, message.offset, message.limit, message.requestId);
        else if (state.searchQuery && session) {
          const query = state.searchQuery;
          const revision = session.getRevision();
          const sessionId = state.sessionId;
          const searched = await session.search(query, message.offset, message.limit);
          panel.postMessage({
            type: 'searchResult',
            ...searched,
            query,
            requestId: message.requestId,
            sessionId,
            revision,
          });
        } else await postSession(panel, message.offset, message.limit, message.requestId);
        return;
      case 'searchRows':
        if (!session) throw new Error('Open a data file before searching');
        state.customQuerySql = null;
        state.searchQuery = message.query.trim();
        if (!state.searchQuery) {
          await postSession(panel, 0, getConfig().pageSize, message.requestId);
          return;
        }
        {
          const query = state.searchQuery;
          const revision = session.getRevision();
          const sessionId = state.sessionId;
          const searched = await session.search(query, 0, 100);
          panel.postMessage({
            type: 'searchResult',
            ...searched,
            query,
            requestId: message.requestId,
            sessionId,
            revision,
          });
        }
        return;
      case 'executeCustomQuery':
        if (!session) throw new Error('Open a data file before running a query');
        state.searchQuery = '';
        state.customQuerySql = normalizeReadOnlyQuery(message.sql);
        await postCustomQuery(panel, 0, 100, message.requestId);
        return;
      case 'clearCustomQuery':
        state.customQuerySql = null;
        await postSession(panel, 0, getConfig().pageSize, message.requestId);
        return;
      case 'refresh':
        if (!session?.getFilePath()) return;
        state.customQuerySql = null;
        await loadDataIntoPanel(panel, session.getFilePath(), message.requestId);
        return;
      case 'getStats':
        if (!session) throw new Error('No active wrangling session');
        {
          const requestedSession = session;
          const sessionId = state.sessionId;
          const revision = requestedSession.getRevision();
          const sql = requestedSession.getSql();
          const stats = await requestedSession.getStatistics();
          const quality = await requestedSession.getQualitySummary(stats, sql);
          panel.postMessage({
            type: 'stats',
            stats,
            quality,
            requestId: message.requestId,
            sessionId,
            revision,
          });
        }
        return;
      case 'generateAITransforms':
        await generateAITransformsCommand(panel, message.requestId);
        return;
      case 'requestChart':
        if (!session) throw new Error('No active wrangling session');
        {
          const revision = session.getRevision();
          const sessionId = state.sessionId;
          const result = await session.getChartData(message.chart);
          panel.postMessage({
            type: 'chartResult',
            chart: message.chart,
            result,
            requestId: message.requestId,
            sessionId,
            revision,
          });
        }
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
          panel.postMessage({
            type: 'exportComplete',
            outputPath: '',
            status: 'cancelled',
            requestId: message.requestId,
          });
          return;
        }
        const conn = await getConnection();
        await exportResults(conn, getActiveExportSql(state), target.fsPath, message.format);
        panel.postMessage({
          type: 'exportComplete',
          outputPath: target.fsPath,
          status: 'completed',
          requestId: message.requestId,
        });
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
      requestId: message.requestId,
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

  if (shouldOpenWithDataEditor(filePath) && !isRemoteDataSource(filePath)) {
    await vscode.commands.executeCommand(
      'vscode.openWith',
      vscode.Uri.file(filePath),
      DATA_EDITOR_VIEW_TYPE,
    );
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
    title: 'Configure AI provider for QuackWrangler',
    prompt: 'Stored in VS Code SecretStorage. Only schema metadata and your instruction are sent.',
    password: true,
    ignoreFocusOut: true,
  });
  if (key?.trim()) {
    await extensionContext.secrets.store('quackwrangler.openaiApiKey', key.trim());
    vscode.window.showInformationMessage('QuackWrangler AI provider key stored securely.');
  }
}

// Track per-panel AI workflow to prevent overlapping requests.
const panelAIInFlight = new WeakMap<DataWranglerPanel, boolean>();

export async function generateAITransformsCommand(
  sourcePanel = DataWranglerPanel.currentPanel,
  requestId?: string,
): Promise<void> {
  const panel = sourcePanel;
  const state = panel ? getPanelState(panel) : null;
  const session = state?.session ?? null;
  if (!panel || !session || !extensionContext) throw new Error('Open a data file first');

  // Only one AI workflow per panel at a time.
  if (panelAIInFlight.get(panel)) {
    vscode.window.showInformationMessage('An AI plan is already in progress for this editor.');
    panel.postMessage({ type: 'aiComplete', status: 'discarded', requestId });
    return;
  }
  panelAIInFlight.set(panel, true);

  try {
    let key = await extensionContext.secrets.get('quackwrangler.openaiApiKey');
    if (!key) {
      await configureAICommand();
      key = await extensionContext.secrets.get('quackwrangler.openaiApiKey');
    }
    if (!key) {
      panel.postMessage({ type: 'aiComplete', status: 'cancelled', requestId });
      return;
    }
    const goal = await vscode.window.showInputBox({
      title: 'Generate visual transforms',
      prompt: 'Describe the desired result. No row values will be sent.',
      placeHolder: 'Remove duplicates and keep active customers after 2025',
    });
    if (!goal) {
      panel.postMessage({ type: 'aiComplete', status: 'cancelled', requestId });
      return;
    }

    // Capture the session identity and revision before any await so we can
    // detect if the user modified the pipeline while the AI was running.
    const capturedSession = state!.session;
    const capturedRevision = capturedSession!.getRevision();

    const schema = (await session.getPage(0, 1)).schema;
    const config = vscode.workspace.getConfiguration('quackwrangler');
    const ai = validateAISettings(
      config.get<string>('ai.provider', 'openai'),
      config.get<string>('ai.model', 'gpt-4o-mini'),
      config.get<string>('ai.baseUrl', ''),
      config.get<number>('ai.timeoutSeconds', 60),
    );
    const suggestions = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Generating schema-only transform plan…',
      },
      () =>
        suggestTransforms(key!, ai.model, goal, schema.columns, {
          baseUrl: ai.baseUrl,
          timeoutMs: ai.timeoutMs,
          history: session.getHistory(),
        }),
    );
    if (!suggestions.length) {
      vscode.window.showInformationMessage('No transforms were suggested.');
      panel.postMessage({ type: 'aiComplete', status: 'empty', requestId });
      return;
    }

    // Reject the plan if the panel's session or pipeline changed while waiting.
    const currentSession = state!.session;
    const currentRevision = currentSession?.getRevision();
    if (currentSession !== capturedSession || currentRevision !== capturedRevision) {
      vscode.window.showWarningMessage(
        'The data was changed while the AI plan was loading. Discarded to avoid applying to a different dataset.',
      );
      panel.postMessage({ type: 'aiComplete', status: 'discarded', requestId });
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
    if (approval !== 'Apply transforms') {
      panel.postMessage({ type: 'aiComplete', status: 'cancelled', requestId });
      return;
    }
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
    await postSession(panel, 0, getConfig().pageSize, requestId);
    panel.postMessage({ type: 'aiComplete', status: 'applied', requestId });
  } finally {
    panelAIInFlight.delete(panel);
  }
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

async function loadDataIntoPanel(
  panel: DataWranglerPanel,
  filePath: string,
  requestId?: string,
): Promise<void> {
  panel.setMessageHandler((message) => handleWebviewMessage(panel, message));
  const state = getPanelState(panel);
  // Preserve the existing session so a failed reload doesn't break the current view.
  const previousSession = state.session;
  const previousSessionId = state.sessionId;
  state.customQuerySql = null;
  state.searchQuery = '';
  await vscode.commands.executeCommand('setContext', 'quackwrangler.dbtDetected', false);

  try {
    const remote = isRemoteDataSource(filePath);
    const progress = createRemoteProgressReporter(filePath, (stage) =>
      panel.postMessage({ type: 'loadingProgress', ...stage, requestId }),
    );
    progress(REMOTE_LOAD_STAGES.connecting);
    const conn = await getConnection();
    progress(REMOTE_LOAD_STAGES.preparing);
    if (remote) await prepareDataFileReader(conn, filePath);
    progress(REMOTE_LOAD_STAGES.reading);
    const config = getConfig();
    // Each panel loads into its own uniquely named DuckDB relation so multiple
    // open editors never cross-contaminate each other's data.
    await loadFile(
      conn,
      filePath,
      config.loadingMode,
      config.eagerFileSizeLimitMb,
      state.relationName,
    );
    progress(REMOTE_LOAD_STAGES.previewing);
    state.session = new WranglingSession(conn, state.relationName);
    state.sessionId = newRelationName();
    state.session.load(filePath);
    // Store dbt state on the panel directly so each editor maintains independent context.
    panel.dbtProjectRoot = undefined;
    if (!remote) {
      const workspaceRoot = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath))?.uri
        .fsPath;
      panel.dbtProjectRoot = await findDbtProject(filePath, workspaceRoot);
      // Only update context if this panel is the currently active one.
      if (DataWranglerPanel.currentPanel === panel) {
        await vscode.commands.executeCommand(
          'setContext',
          'quackwrangler.dbtDetected',
          Boolean(panel.dbtProjectRoot),
        );
      }
    }
    await rememberRecentFile(filePath);
    progress(REMOTE_LOAD_STAGES.ready);
    await postSession(panel, 0, Math.min(config.maxRowsPreview, config.pageSize), requestId);
  } catch (error) {
    // Restore the previous session so an already-loaded panel remains usable.
    state.session = previousSession;
    state.sessionId = previousSessionId;
    if (previousSession) {
      await postSession(panel, 0, getConfig().pageSize, requestId).catch(() => undefined);
    }
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Failed to load file: ${message}`);
    panel.postMessage({ type: 'error', message, requestId });
  }
}

async function selectFileIntoPanel(panel: DataWranglerPanel, requestId?: string): Promise<void> {
  const selected = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectMany: false,
    filters: DATA_FILE_FILTER,
    openLabel: 'Open in QuackWrangler',
  });
  if (selected?.[0]) await loadDataIntoPanel(panel, selected[0].fsPath, requestId);
}

async function selectFolderFileIntoPanel(
  panel: DataWranglerPanel,
  requestId?: string,
): Promise<void> {
  const folder = (
    await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: false,
      canSelectMany: false,
      openLabel: 'Choose data folder',
    })
  )?.[0];
  if (!folder) return;

  const files = await collectDataFiles(folder);
  if (!files.length) {
    vscode.window.showWarningMessage('No supported data files were found in this folder.');
    return;
  }
  const selected = await vscode.window.showQuickPick(
    files
      .sort((left, right) => left.fsPath.localeCompare(right.fsPath))
      .map((uri) => ({
        label: basename(uri.fsPath),
        description: uri.fsPath.slice(folder.fsPath.length).replace(/^[\\/]/, ''),
        uri,
      })),
    { placeHolder: 'Select a data file to open in this QuackWrangler tab' },
  );
  if (selected) await loadDataIntoPanel(panel, selected.uri.fsPath, requestId);
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
    if (shouldOpenWithDataEditor(filePath) && !isRemoteDataSource(filePath)) {
      await vscode.commands.executeCommand(
        'vscode.openWith',
        typeof uri === 'object' ? uri : vscode.Uri.file(filePath),
        DATA_EDITOR_VIEW_TYPE,
      );
    } else {
      await openDataWrangler(filePath);
    }
  }
}

export async function copyDbtSqlCommand(): Promise<void> {
  const panel = DataWranglerPanel.currentPanel;
  const session = panel ? getPanelState(panel).session : null;
  if (!panel || !session || !panel.dbtProjectRoot) {
    vscode.window.showWarningMessage('Open a data file inside a dbt project first.');
    return;
  }

  const choice = await vscode.window.showQuickPick(
    [
      { label: 'Copy dbt model SQL', description: 'Complete model query', style: 'model' },
      { label: 'Copy dbt CTEs', description: 'CTE snippet for an existing model', style: 'cte' },
    ] as Array<{ label: string; description: string; style: DbtExportStyle }>,
    { placeHolder: `dbt project: ${basename(panel.dbtProjectRoot)}` },
  );
  if (!choice) return;

  const defaultModel = basename(session.getFilePath())
    .replace(/\.[^.]+$/, '')
    .replace(/\W/g, '_');
  const upstreamModel = await vscode.window.showInputBox({
    title: 'Upstream dbt model',
    prompt: "Used in {{ ref('model_name') }}. Row data is not read or sent anywhere.",
    value: defaultModel,
    validateInput: (value) =>
      /^[A-Za-z_][A-Za-z0-9_]*$/.test(value.trim())
        ? undefined
        : 'Use letters, numbers, and underscores; start with a letter or underscore',
  });
  if (!upstreamModel) return;

  try {
    await vscode.env.clipboard.writeText(
      buildDbtSql(session.getHistory(), upstreamModel, choice.style),
    );
    vscode.window.showInformationMessage(`${choice.label} copied to the clipboard.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`dbt SQL export failed: ${message}`);
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
    const activeState = panel ? getPanelState(panel) : null;
    await exportResults(
      conn,
      activeState?.session ? getActiveExportSql(activeState) : 'SELECT * FROM current_data',
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
  await cleanupManagedTempDirectory();
}

export async function summarizeFileCommand(): Promise<void> {
  const panel = DataWranglerPanel.currentPanel;
  const activeSession = panel ? getPanelState(panel).session : null;
  if (!panel || !activeSession) {
    vscode.window.showWarningMessage('No file loaded. Open a file first.');
    return;
  }

  try {
    const state = getPanelState(panel);
    const revision = activeSession.getRevision();
    const sql = activeSession.getSql();
    const stats = await activeSession.getStatistics();
    panel.postMessage({
      type: 'stats',
      stats,
      quality: await activeSession.getQualitySummary(stats, sql),
      sessionId: state.sessionId,
      revision,
    });
    vscode.window.showInformationMessage(
      `Summarized ${stats.length} columns in ${activeSession.getFilePath().split(/[\\/]/).pop()}`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Summarize failed: ${message}`);
  }
}
