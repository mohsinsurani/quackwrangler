import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import * as vscode from 'vscode';

import { suggestTransforms, validateAISettings } from '../ai/assistant.js';
import { findDbtProject } from '../dbt/context.js';
import { buildDbtSql, DbtExportStyle } from '../dbt/export.js';
import { DuckDBConnection } from '../duckdb/connection.js';
import { describeTable, loadDatabaseTable, releaseDatabase } from '../duckdb/database-source.js';
import { getFileMetadata, loadFile, prepareDataFileReader } from '../duckdb/parquet-loader.js';
import { exportResults, normalizeReadOnlyQuery } from '../duckdb/query-engine.js';
import { buildPolarsRecipe } from '../polars/recipe.js';
import { schemaComparisonMarkdown } from '../schema/compare.js';
import { WranglingSession } from '../transforms/pipeline.js';
import {
  DatabaseInfo,
  DatabaseTable,
  DataWranglerConfig,
  PageInfo,
  QueryResult,
  TableSchema,
} from '../types/index.js';
import { WebviewMessage } from '../types/index.js';
import { redactedDiagnostic } from '../utils/diagnostics.js';
import { isDuckDBMemoryError } from '../utils/duckdbErrors.js';
import { DATA_EDITOR_VIEW_TYPE, shouldOpenWithDataEditor } from '../utils/editorRouting.js';
import {
  DATA_FILE_EXTENSIONS,
  DATABASE_FILE_EXTENSIONS,
  isDataFile,
  isDatabaseFile,
} from '../utils/fileDetector.js';
import {
  createRemoteProgressReporter,
  isRemoteDataSource,
  REMOTE_LOAD_STAGES,
} from '../utils/remoteProgress.js';
import { createManagedTempDirectory, ManagedTempDirectory } from '../utils/tempStorage.js';
import { DataWranglerPanel } from '../webview/provider.js';

const DATA_FILE_FILTER = { 'Data Files': [...DATA_FILE_EXTENSIONS] };
// Join, union, and schema comparison read one file as one table, which databases are not.
const TABULAR_FILE_FILTER = {
  'Data Files': DATA_FILE_EXTENSIONS.filter(
    (extension) => !(DATABASE_FILE_EXTENSIONS as readonly string[]).includes(extension),
  ),
};

function getConfig(): DataWranglerConfig {
  const config = vscode.workspace.getConfiguration('quackwrangler');
  return {
    memoryLimit: config.get<string>('duckdb.memoryLimit', '80%'),
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

// Shared connection used only for panel-independent commands (schema compare,
// drift detection, global export). It must not be used for panel queries because
// preserve_insertion_order and threads are instance-global — setting them on the
// shared instance would race with every open panel.
let sharedConnection: DuckDBConnection | null = null;
let sharedManagedTempDirectory: ManagedTempDirectory | undefined;
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
  inspectionFilter: { column: string; operator: 'is_null' | 'is_not_null' } | null;
  relationName: string;
  // Set while the panel shows a table from a DuckDB or SQLite file.
  database: DatabaseInfo | null;
  // Each panel owns its DuckDBConnection so preserve_insertion_order and other
  // instance-global settings cannot bleed between panels.
  connection: DuckDBConnection | null;
  managedTempDir: ManagedTempDirectory | undefined;
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
      inspectionFilter: null,
      relationName: newRelationName(),
      database: null,
      connection: null,
      managedTempDir: undefined,
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

async function createConnection(config: DataWranglerConfig): Promise<{
  connection: DuckDBConnection;
  managedTempDir: ManagedTempDirectory | undefined;
}> {
  outputChannel ??= vscode.window.createOutputChannel('QuackWrangler');
  let managedTempDir: ManagedTempDirectory | undefined;
  if (config.tempDirectory) {
    await mkdir(config.tempDirectory, { recursive: true });
  } else {
    const storageRoot =
      extensionContext?.globalStorageUri.fsPath ?? join(tmpdir(), 'quackwrangler');
    managedTempDir = await createManagedTempDirectory(storageRoot);
    config.tempDirectory = managedTempDir.path;
  }
  const conn = new DuckDBConnection(config, outputChannel);
  try {
    await conn.connect();
  } catch (error) {
    await cleanupDirectory(managedTempDir);
    throw error;
  }
  return { connection: conn, managedTempDir };
}

async function cleanupDirectory(directory: ManagedTempDirectory | undefined): Promise<void> {
  if (!directory) return;
  try {
    await directory.cleanup();
  } catch (error) {
    outputChannel?.appendLine(
      `[DuckDB] Could not remove temporary directory ${directory.path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** Returns the shared connection used by panel-independent commands. */
async function getSharedConnection(): Promise<DuckDBConnection> {
  if (!sharedConnection || !sharedConnection.isConnected()) {
    const { connection, managedTempDir } = await createConnection(getConfig());
    sharedConnection = connection;
    sharedManagedTempDirectory = managedTempDir;
  }
  return sharedConnection;
}

/**
 * Returns the per-panel DuckDB connection, creating it if needed.
 *
 * Each panel owns its own DuckDBInstance so that preserve_insertion_order and
 * other instance-global settings are isolated and cannot bleed between panels
 * open at the same time.
 */
async function getPanelConnection(panel: DataWranglerPanel): Promise<DuckDBConnection> {
  const state = getPanelState(panel);
  if (!state.connection || !state.connection.isConnected()) {
    const { connection, managedTempDir } = await createConnection(getConfig());
    state.connection = connection;
    state.managedTempDir = managedTempDir;
  }
  return state.connection;
}

async function closePanelConnection(panel: DataWranglerPanel): Promise<void> {
  const state = panelStates.get(panel);
  if (!state) return;
  await state.connection?.close();
  state.connection = null;
  await cleanupDirectory(state.managedTempDir);
  state.managedTempDir = undefined;
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
    database: getPanelState(panel).database ?? undefined,
    requestId,
    sessionId,
    revision,
  });
}

/** Path next to the source file for derived files, named after the table for databases. */
function derivedOutputPath(state: PanelState, source: string, suffix: string): string {
  const table = state.database?.selected;
  return `${table ? join(dirname(source), table.name) : source.replace(/\.[^.]+$/, '')}${suffix}`;
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
  customQuerySql?: string,
): Promise<void> {
  const { session, sessionId, customQuerySql: activeCustomQuery } = getPanelState(panel);
  customQuerySql ??= activeCustomQuery ?? undefined;
  if (!session || !customQuerySql) throw new Error('No custom query is active');
  const querySql = customQuerySql;
  const revision = session.getRevision();
  const sourceSql = getCustomQuerySource(session, querySql);
  const conn = await getPanelConnection(panel);
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
    customQuerySql: querySql,
    requestId,
    sessionId,
    revision,
  });
}

async function queryCustomSql(
  panel: DataWranglerPanel,
  customQuerySql: string,
  offset: number,
  limit: number,
): Promise<{
  schema: TableSchema;
  result: QueryResult;
  page: PageInfo;
  sessionId: string;
  revision: number;
}> {
  const state = getPanelState(panel);
  const session = state.session;
  if (!session) throw new Error('Open a data file before running a query');
  const revision = session.getRevision();
  const sessionId = state.sessionId;
  const sourceSql = getCustomQuerySource(session, customQuerySql);
  const connection = await getPanelConnection(panel);
  const [result, count, described] = await Promise.all([
    connection.query(
      `SELECT * FROM (${sourceSql}) AS custom_query_page LIMIT ${limit} OFFSET ${offset}`,
    ),
    connection.query(`SELECT COUNT(*) FROM (${sourceSql}) AS custom_query_count`),
    connection.query(`DESCRIBE SELECT * FROM (${sourceSql}) AS custom_query_schema`),
  ]);
  return {
    schema: {
      columns: described.rows.map((row) => ({
        name: String(row[0]),
        type: String(row[1]),
        nullable: String(row[2]).toUpperCase() === 'YES',
      })),
      rowCount: Number(count.rows[0]?.[0] ?? 0),
      filePath: session.getFilePath(),
    },
    result,
    page: { offset, limit, totalRows: Number(count.rows[0]?.[0] ?? 0) },
    sessionId,
    revision,
  };
}

function postCustomQueryResult(
  panel: DataWranglerPanel,
  result: Awaited<ReturnType<typeof queryCustomSql>>,
  customQuerySql: string,
  requestId?: string,
): void {
  panel.postMessage({ type: 'customQueryResult', ...result, customQuerySql, requestId });
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
          filters: TABULAR_FILE_FILTER,
          openLabel: 'Select file to join or union',
        });
        if (!selected?.[0]) return;
        const conn = await getPanelConnection(panel);
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
        if (['join_file', 'union_file'].includes(message.transform.type)) {
          await prepareDataFileReader(
            await getPanelConnection(panel),
            String(message.transform.params.filePath ?? ''),
          );
        }
        await session.applyValidated(message.transform.type, message.transform.params);
        state.customQuerySql = null;
        state.searchQuery = '';
        state.inspectionFilter = null;
        await postSession(panel, 0, getConfig().pageSize, message.requestId);
        return;
      case 'undo':
        await session?.undoValidated();
        state.customQuerySql = null;
        state.searchQuery = '';
        state.inspectionFilter = null;
        await postSession(panel, 0, getConfig().pageSize, message.requestId);
        return;
      case 'redo':
        await session?.redoValidated();
        state.customQuerySql = null;
        state.searchQuery = '';
        state.inspectionFilter = null;
        await postSession(panel, 0, getConfig().pageSize, message.requestId);
        return;
      case 'removeTransform':
        await session?.removeValidated(message.id);
        state.customQuerySql = null;
        state.searchQuery = '';
        state.inspectionFilter = null;
        await postSession(panel, 0, getConfig().pageSize, message.requestId);
        return;
      case 'reorderTransforms':
        await session?.reorderValidated(message.sourceId, message.targetId);
        state.customQuerySql = null;
        state.searchQuery = '';
        state.inspectionFilter = null;
        await postSession(panel, 0, getConfig().pageSize, message.requestId);
        return;
      case 'pageChange':
        if (state.customQuerySql)
          await postCustomQuery(panel, message.offset, message.limit, message.requestId);
        else if ((state.searchQuery || state.inspectionFilter) && session) {
          const query = state.searchQuery;
          if (!query && !state.inspectionFilter) {
            await postSession(panel, message.offset, message.limit, message.requestId);
            return;
          }
          const revision = session.getRevision();
          const sessionId = state.sessionId;
          const searched = await session.search(
            query,
            message.offset,
            message.limit,
            state.inspectionFilter ?? undefined,
          );
          panel.postMessage({
            type: 'searchResult',
            ...searched,
            query,
            scope: state.inspectionFilter ? 'inspection' : 'search',
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
        state.inspectionFilter = 'filter' in message ? (message.filter ?? null) : null;
        if (!state.searchQuery && !state.inspectionFilter) {
          await postSession(panel, 0, getConfig().pageSize, message.requestId);
          return;
        }
        {
          const query = state.searchQuery;
          const revision = session.getRevision();
          const sessionId = state.sessionId;
          const searched = await session.search(
            query,
            0,
            100,
            'filter' in message ? message.filter : undefined,
          );
          panel.postMessage({
            type: 'searchResult',
            ...searched,
            query,
            scope: state.inspectionFilter ? 'inspection' : 'search',
            requestId: message.requestId,
            sessionId,
            revision,
          });
        }
        return;
      case 'searchChange':
        return;
      case 'executeCustomQuery':
        if (!session) throw new Error('Open a data file before running a query');
        {
          const normalizedSql = normalizeReadOnlyQuery(message.sql);
          const result = await queryCustomSql(panel, normalizedSql, 0, 100);
          if (getPanelState(panel).session !== session || result.revision !== session.getRevision())
            throw new Error('The data changed while the query was running. Run the query again.');
          state.searchQuery = '';
          state.inspectionFilter = null;
          state.customQuerySql = normalizedSql;
          postCustomQueryResult(panel, result, normalizedSql, message.requestId);
        }
        return;
      case 'clearCustomQuery':
        state.customQuerySql = null;
        state.inspectionFilter = null;
        await postSession(panel, 0, getConfig().pageSize, message.requestId);
        return;
      case 'refresh':
        if (!session?.getFilePath()) return;
        state.customQuerySql = null;
        state.inspectionFilter = null;
        await loadDataIntoPanel(
          panel,
          session.getFilePath(),
          message.requestId,
          undefined,
          state.database?.selected,
        );
        return;
      case 'selectTable': {
        if (!session || !state.database) throw new Error('Open a database file first');
        const table = state.database.tables.find(
          (candidate) => candidate.schema === message.schema && candidate.name === message.name,
        );
        if (!table) throw new Error(`"${message.name}" is not in this database`);
        if (table === state.database.selected) {
          await postSession(panel, 0, getConfig().pageSize, message.requestId);
          return;
        }
        const steps = session.getHistory().length;
        if (steps > 0) {
          const choice = await vscode.window.showWarningMessage(
            `Switching to ${describeTable(table)} clears ${steps} applied ${steps === 1 ? 'step' : 'steps'}. Save a recipe first to keep them.`,
            { modal: true },
            'Switch table',
          );
          if (choice !== 'Switch table') {
            // Re-send the current session so the webview stops waiting and keeps its selection.
            await postSession(panel, 0, getConfig().pageSize, message.requestId);
            return;
          }
        }
        state.customQuerySql = null;
        state.inspectionFilter = null;
        await loadDataIntoPanel(panel, session.getFilePath(), message.requestId, undefined, table);
        return;
      }
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
        const exportSession = session;
        const exportSessionId = state.sessionId;
        if (
          message.sessionId !== exportSessionId ||
          message.revision !== exportSession.getRevision()
        )
          throw new Error(
            'The data changed before export started. Review the current result and try again.',
          );
        const sourcePath = exportSession.getFilePath();
        const remoteSource = /^(https?|s3):\/\//i.test(sourcePath);
        const defaultPath = remoteSource
          ? undefined
          : derivedOutputPath(state, sourcePath, `_transformed.${message.format}`);
        const exportSql = message.customQuerySql
          ? getCustomQuerySource(exportSession, normalizeReadOnlyQuery(message.customQuerySql))
          : exportSession.getSql();
        const exportCount = await (
          await getPanelConnection(panel)
        ).query(`SELECT COUNT(*) FROM (${exportSql}) AS export_scope_count`);
        const rowCount = Number(exportCount.rows[0]?.[0] ?? 0);
        const approved =
          message.outputPath ||
          (await vscode.window.showQuickPick(
            [
              {
                label: 'Export',
                description: 'Temporary search and inspection filters are not included.',
              },
            ],
            {
              title: `Export all ${rowCount.toLocaleString()} rows from the ${message.customQuerySql ? 'query result' : 'pipeline result'}?`,
            },
          ));
        const target = message.outputPath
          ? vscode.Uri.file(message.outputPath)
          : approved
            ? await vscode.window.showSaveDialog({
                defaultUri: defaultPath ? vscode.Uri.file(defaultPath) : undefined,
                filters: { [message.format.toUpperCase()]: [message.format] },
                saveLabel: `Export all ${rowCount.toLocaleString()} rows`,
              })
            : undefined;
        if (!target) {
          panel.postMessage({
            type: 'exportComplete',
            outputPath: '',
            status: 'cancelled',
            requestId: message.requestId,
          });
          return;
        }
        if (
          state.session !== exportSession ||
          state.sessionId !== exportSessionId ||
          exportSession.getRevision() !== message.revision
        )
          throw new Error(
            'The data changed while choosing an export location. Review the current result and try again.',
          );
        const conn = await getPanelConnection(panel);
        await exportResults(conn, exportSql, target.fsPath, message.format);
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
      case 'saveRecipe':
        await saveWorkspaceCommand(panel);
        return;
      case 'openRecipePicker':
        await pickRecipeFile(panel, message.requestId);
        return;
      case 'replayRecipe':
        await replayWorkspaceCommand(panel, message.filePath, message.requestId);
        return;
      case 'polarsHandoff':
        await exportPolarsHandoff(panel, message);
        return;
      default:
        return;
    }
  } catch (error) {
    outputChannel?.appendLine(
      `[Diagnostic] ${JSON.stringify(redactedDiagnostic(error, state.session?.getFilePath()))}`,
    );
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
        await session.applyValidated(suggestion.type, suggestion.params);
        applied += 1;
      }
    } catch (error) {
      while (applied-- > 0) await session.undoValidated();
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
    else if (type === vscode.FileType.File && isDataFile(name)) output.push(child);
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
    files = (await collectDataFiles(folder)).filter((file) => !isDatabaseFile(file.fsPath));
  } else {
    files =
      (await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectMany: true,
        filters: TABULAR_FILE_FILTER,
        openLabel: 'Compare schemas',
      })) ?? [];
  }
  if (files.length < 2) throw new Error('Select a folder or at least two supported files');
  const conn = await getSharedConnection();
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
  loadingModeOverride?: 'auto' | 'eager' | 'lazy',
  table?: Pick<DatabaseTable, 'schema' | 'name'>,
): Promise<void> {
  panel.setMessageHandler((message) => handleWebviewMessage(panel, message));
  // Register cleanup exactly once per panel. Registering after setMessageHandler
  // means it fires after the message disposable, so no in-flight queries can
  // arrive on a closed connection.
  if (!getPanelState(panel).connection) {
    panel.onDispose(() => void closePanelConnection(panel));
  }
  const state = getPanelState(panel);
  // Preserve the existing session so a failed reload doesn't break the current view.
  const previousSession = state.session;
  const previousSessionId = state.sessionId;
  const previousDatabase = state.database;
  state.customQuerySql = null;
  state.searchQuery = '';
  await vscode.commands.executeCommand('setContext', 'quackwrangler.dbtDetected', false);
  let stage = 'initializing';
  outputChannel?.appendLine(`[Load] Opening ${filePath}`);

  try {
    const remote = isRemoteDataSource(filePath);
    const progress = createRemoteProgressReporter(filePath, (stage) =>
      panel.postMessage({ type: 'loadingProgress', ...stage, requestId }),
    );
    progress(REMOTE_LOAD_STAGES.connecting);
    stage = 'connecting to DuckDB';
    const conn = await getPanelConnection(panel);
    progress(REMOTE_LOAD_STAGES.preparing);
    stage = 'preparing the source reader';
    await prepareDataFileReader(conn, filePath);
    progress(REMOTE_LOAD_STAGES.reading);
    stage = 'loading the source data';
    const config = getConfig();
    // Each panel loads into its own uniquely named DuckDB relation so multiple
    // open editors never cross-contaminate each other's data.
    let database: DatabaseInfo | null = null;
    if (isDatabaseFile(filePath)) {
      database = await loadDatabaseTable(
        conn,
        filePath,
        table,
        loadingModeOverride ?? config.loadingMode,
        config.eagerFileSizeLimitMb,
        state.relationName,
      );
    } else {
      await loadFile(
        conn,
        filePath,
        loadingModeOverride ?? config.loadingMode,
        config.eagerFileSizeLimitMb,
        state.relationName,
      );
      // Opening a regular file in a panel that showed a database releases that database.
      await releaseDatabase(conn);
    }
    state.database = database;
    progress(REMOTE_LOAD_STAGES.previewing);
    stage = 'building the initial preview';
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
    outputChannel?.appendLine(`[Load] Ready: ${filePath}`);
  } catch (error) {
    // Restore the previous session so an already-loaded panel remains usable.
    state.session = previousSession;
    state.sessionId = previousSessionId;
    state.database = previousDatabase;
    if (previousSession) {
      await postSession(panel, 0, getConfig().pageSize, requestId).catch(() => undefined);
    }
    const message = error instanceof Error ? error.message : String(error);
    const details = error instanceof Error ? (error.stack ?? error.message) : String(error);
    outputChannel?.appendLine(`[Load ERROR] Failed while ${stage}: ${filePath}\n${details}`);
    outputChannel?.appendLine(
      `[Diagnostic] ${JSON.stringify({ stage, ...redactedDiagnostic(error, filePath) })}`,
    );
    const recovery = isDuckDBMemoryError(error)
      ? await vscode.window.showErrorMessage(
          'DuckDB ran out of memory or spill space while loading this file.',
          'Retry with Lazy Loading',
          'Choose Spill Folder',
          'Open DuckDB Settings',
        )
      : undefined;
    if (recovery === 'Retry with Lazy Loading') {
      await loadDataIntoPanel(panel, filePath, requestId, 'lazy', table);
      return;
    }
    if (recovery === 'Choose Spill Folder') {
      const selected = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: 'Use folder for DuckDB spill files',
      });
      if (selected?.[0]) {
        await vscode.workspace
          .getConfiguration('quackwrangler')
          .update('duckdb.tempDirectory', selected[0].fsPath, vscode.ConfigurationTarget.Workspace);
        await closePanelConnection(panel);
        await loadDataIntoPanel(panel, filePath, requestId, undefined, table);
        return;
      }
    }
    if (recovery === 'Open DuckDB Settings') {
      await vscode.commands.executeCommand(
        'workbench.action.openSettings',
        '@ext:quackwrangler.quackwrangler duckdb',
      );
    }
    if (!recovery) {
      await vscode.window.showErrorMessage(
        `Failed to load file: ${message}. See View > Output > QuackWrangler for details.`,
      );
    }
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
  // Present when the source is a database file, so the same table reopens.
  sourceTable?: { schema: string; name: string };
  transforms: Array<{ type: string; params: Record<string, unknown> }>;
}

export async function saveWorkspaceCommand(targetPanel?: DataWranglerPanel): Promise<void> {
  const panel = targetPanel ?? DataWranglerPanel.currentPanel;
  const state = panel ? getPanelState(panel) : null;
  const session = state?.session;
  if (!state || !session) {
    vscode.window.showWarningMessage('Open a data file before saving a workspace.');
    return;
  }
  const target = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(derivedOutputPath(state, session.getFilePath(), '.qw')),
    filters: { 'QuackWrangler Workspace': ['qw'] },
    saveLabel: 'Save QuackWrangler Workspace',
  });
  if (!target) return;
  const selected = state.database?.selected;
  const workspace: SavedWorkspace = {
    version: 1,
    sourceFile: session.getFilePath(),
    ...(selected ? { sourceTable: { schema: selected.schema, name: selected.name } } : {}),
    transforms: session.getHistory().map(({ type, params }) => ({ type, params })),
  };
  await writeFile(target.fsPath, `${JSON.stringify(workspace, null, 2)}\n`, 'utf8');
  vscode.window.showInformationMessage(`Saved QuackWrangler workspace to ${target.fsPath}`);
}

async function replayWorkspaceCommand(
  panel: DataWranglerPanel,
  filePath?: string,
  requestId?: string,
): Promise<void> {
  const state = getPanelState(panel);
  const session = state.session;
  if (!session) throw new Error('Open a data file before replaying a recipe');
  const sessionId = state.sessionId;
  const revision = session.getRevision();
  const { customQuerySql, searchQuery, inspectionFilter } = state;
  const assertCurrent = (): void => {
    if (
      state.session !== session ||
      state.sessionId !== sessionId ||
      session.getRevision() !== revision ||
      state.customQuerySql !== customQuerySql ||
      state.searchQuery !== searchQuery ||
      state.inspectionFilter !== inspectionFilter
    )
      throw new Error(
        'The editor changed while replaying the recipe. Run it again on the current result.',
      );
  };
  let recipePath = filePath;
  if (!recipePath) {
    const selected = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectMany: false,
      filters: { 'QuackWrangler Workspace': ['qw'] },
      openLabel: 'Choose recipe to replay',
    });
    recipePath = selected?.[0]?.fsPath;
  }
  if (!recipePath) return;
  const parsed = JSON.parse(await readFile(recipePath, 'utf8')) as Partial<SavedWorkspace> | null;
  if (
    parsed?.version !== 1 ||
    !Array.isArray(parsed.transforms) ||
    parsed.transforms.some(
      (step) =>
        !step ||
        typeof step !== 'object' ||
        typeof step.type !== 'string' ||
        !step.params ||
        typeof step.params !== 'object' ||
        Array.isArray(step.params),
    )
  )
    throw new Error('This is not a valid QuackWrangler recipe file');
  assertCurrent();
  const committed = await session.restoreValidated(parsed.transforms, {
    assertCurrent,
    chooseColumn: async (missing, columns, step, operation) => {
      const selected = await vscode.window.showQuickPick(
        columns.map(({ name, type }) => ({ label: name, description: type })),
        {
          title: `Recipe step ${step} · ${operation.replaceAll('_', ' ')}`,
          placeHolder: `Replace missing column “${missing}”`,
        },
      );
      return selected?.label;
    },
  });
  if (!committed) return;
  state.customQuerySql = null;
  state.searchQuery = '';
  state.inspectionFilter = null;
  await postSession(panel, 0, getConfig().pageSize, requestId);
}

async function pickRecipeFile(panel: DataWranglerPanel, requestId?: string): Promise<void> {
  await replayWorkspaceCommand(panel, undefined, requestId);
}

async function exportPolarsHandoff(
  panel: DataWranglerPanel,
  message: Extract<WebviewMessage, { type: 'polarsHandoff' }>,
): Promise<void> {
  const state = getPanelState(panel);
  const session = state.session;
  if (!session) throw new Error('Open a data file before creating a Polars handoff');
  const targetSession = session;
  const targetSessionId = state.sessionId;
  const targetRevision = targetSession.getRevision();
  if (message.sessionId !== targetSessionId || message.revision !== targetRevision)
    throw new Error(
      'The data changed before the Polars handoff started. Review the current result and try again.',
    );
  const sourcePath = session.getFilePath();
  const exportSql = message.customQuerySql
    ? getCustomQuerySource(session, normalizeReadOnlyQuery(message.customQuerySql))
    : session.getSql();
  const mode = message.mode;
  if (mode === 'recipe' && (message.customQuerySql || state.inspectionFilter))
    throw new Error(
      'The active view is a query or temporary inspection. Clear it before copying a source recipe, or use Continue in Polars to preserve the exact result.',
    );
  if (mode === 'result') {
    const target = await vscode.window.showSaveDialog({
      filters: { Parquet: ['parquet'] },
      saveLabel: 'Export query result for Polars',
    });
    if (!target) return;
    if (
      state.session !== targetSession ||
      state.sessionId !== targetSessionId ||
      targetSession.getRevision() !== targetRevision
    )
      throw new Error(
        'The data changed while choosing an export location. Review the current result and try again.',
      );
    await exportResults(await getPanelConnection(panel), exportSql, target.fsPath, 'parquet');
    const document = await vscode.workspace.openTextDocument({
      language: 'python',
      content: `import polars as pl\n\n# Install Polars in your Python environment: python -m pip install polars\nresult = pl.scan_parquet(${JSON.stringify(target.fsPath)}).collect()\n`,
    });
    await vscode.window.showTextDocument(document, { preview: false });
    return;
  }
  if (mode === 'recipe') {
    const recipe = buildPolarsRecipe(sourcePath, session.getHistory());
    const document = await vscode.workspace.openTextDocument({
      language: 'python',
      content: recipe,
    });
    await vscode.window.showTextDocument(document, { preview: false });
    return;
  }
  const target = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(derivedOutputPath(state, sourcePath, '_result.parquet')),
    filters: { Parquet: ['parquet'] },
    saveLabel: 'Export result for Polars',
  });
  if (!target) return;
  if (
    state.session !== targetSession ||
    state.sessionId !== targetSessionId ||
    targetSession.getRevision() !== targetRevision
  )
    throw new Error(
      'The data changed while choosing an export location. Review the current result and try again.',
    );
  await exportResults(await getPanelConnection(panel), exportSql, target.fsPath, 'parquet');
  const document = await vscode.workspace.openTextDocument({
    language: 'python',
    content: `import polars as pl\n\n# Install Polars in your Python environment: python -m pip install polars\nresult = pl.scan_parquet(${JSON.stringify(target.fsPath)}).collect()\n`,
  });
  await vscode.window.showTextDocument(document, { preview: false });
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
  const table =
    parsed.sourceTable &&
    typeof parsed.sourceTable.schema === 'string' &&
    typeof parsed.sourceTable.name === 'string'
      ? { schema: parsed.sourceTable.schema, name: parsed.sourceTable.name }
      : undefined;
  const panel = DataWranglerPanel.createOrShow(extensionUri, parsed.sourceFile);
  await loadDataIntoPanel(panel, parsed.sourceFile, undefined, undefined, table);
  const session = getPanelState(panel).session;
  await session?.restoreValidated(
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

  const defaultModel = (
    getPanelState(panel).database?.selected.name ??
    basename(session.getFilePath()).replace(/\.[^.]+$/, '')
  ).replace(/\W/g, '_');
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
    const panel = DataWranglerPanel.currentPanel;
    const activeState = panel ? getPanelState(panel) : null;
    const conn = activeState ? await getPanelConnection(panel!) : await getSharedConnection();
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
  await sharedConnection?.close();
  sharedConnection = null;
  await cleanupDirectory(sharedManagedTempDirectory);
  sharedManagedTempDirectory = undefined;
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
