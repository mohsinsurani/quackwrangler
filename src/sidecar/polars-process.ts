import { spawn, ChildProcess, execFile } from 'child_process';
import * as path from 'path';

import { OutputChannel } from 'vscode';

import { QueryResult } from '../types/index.js';
import { TransformOperation } from '../types/index.js';

export interface PolarsQueryResult {
  success: boolean;
  columns?: string[];
  rows?: any[][];
  rowCount?: number;
  columnCount?: number;
  dtypes?: Record<string, string>;
  duration?: number;
  error?: string;
  traceback?: string;
}

export interface PolarsSchemaResult {
  success: boolean;
  columns?: { name: string; type: string; nullable: boolean }[];
  rowCount?: number;
  columnCount?: number;
  error?: string;
}

export interface PolarsStatsResult {
  success: boolean;
  stats?: {
    rowCount: number;
    columnCount: number;
    columns: Record<string, {
      type: string;
      nullCount: number;
      nullPercentage: number;
      min?: number;
      max?: number;
      mean?: number;
      median?: number;
      std?: number;
      minLength?: number;
      maxLength?: number;
      nUnique?: number;
    }>;
  };
  error?: string;
}

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class PolarsProcess {
  private process: ChildProcess | null = null;
  private outputChannel: OutputChannel;
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private requestCounter = 0;
  private ready = false;
  private queryTimeout: number;
  private pythonPath: string | null = null;
  private preferredPythonPaths: string[] = [];
  private outputBuffer = '';
  private readyResolver: (() => void) | null = null;

  constructor(
    outputChannel: OutputChannel,
    queryTimeoutMs = 30000,
    preferredPythonPath?: string | string[],
  ) {
    this.outputChannel = outputChannel;
    this.queryTimeout = queryTimeoutMs;
    this.preferredPythonPaths = Array.isArray(preferredPythonPath)
      ? preferredPythonPath.filter(Boolean)
      : preferredPythonPath
        ? [preferredPythonPath]
        : [];
  }

  private log(message: string): void {
    this.outputChannel.appendLine(`[Polars] ${message}`);
  }

  private logError(message: string, error?: unknown): void {
    const errMsg = error instanceof Error ? error.message : String(error);
    this.outputChannel.appendLine(`[Polars ERROR] ${message}: ${errMsg}`);
  }

  /**
   * Auto-detect Python path and validate polars is installed.
   */
  async connect(): Promise<void> {
    this.pythonPath = await this.findPython();
    if (!this.pythonPath) {
      throw new Error(
        'Polars is unavailable in the configured Python environments. From the QuackWrangler repository run `uv sync`, or set `quackwrangler.polars.pythonPath` to a Python executable containing Polars.',
      );
    }
    this.log(`Found Python at: ${this.pythonPath}`);
    this.log('polars is available');

    await this.startProcess();
  }

  /**
   * Find a working Python installation.
   */
  private async findPython(): Promise<string | null> {
    const candidates = [...new Set([...this.preferredPythonPaths, 'python3', 'python'])];

    for (const candidate of candidates) {
      try {
        const result = await this.execCommand(candidate, ['--version']);
        if (result.includes('Python 3.') && await this.validatePolars(candidate)) {
          return candidate;
        }
      } catch {
        continue;
      }
    }
    return null;
  }

  /**
   * Execute a command and return stdout.
   */
  private execCommand(command: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(command, args, { timeout: 10000 }, (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(stdout || stderr);
      });
    });
  }

  /**
   * Validate that polars is importable by Python.
   */
  private async validatePolars(pythonPath: string): Promise<boolean> {
    try {
      const result = await this.execCommand(pythonPath, [
        '-c',
        'import polars; print(polars.__version__)'
      ]);
      this.log(`Polars ${result.trim()} available at: ${pythonPath}`);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Start the Python sidecar process.
   */
  private async startProcess(): Promise<void> {
    const bridgePath = path.join(__dirname, 'polars-bridge.py');

    this.process = spawn(this.pythonPath!, [bridgePath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUNBUFFERED: '1' }
    });

    this.process.stderr?.on('data', (data: Buffer) => {
      this.logError('stderr', data.toString());
    });

    this.process.on('exit', (code) => {
      this.log(`Process exited with code ${code}`);
      this.ready = false;
      this.rejectAllPending('Process exited');
    });

    this.process.on('error', (error) => {
      this.logError('Process error', error);
      this.ready = false;
      this.rejectAllPending(error.message);
    });

    const readyPromise = this.waitForReady();
    this.process.stdout?.on('data', (data: Buffer) => this.handleOutput(data.toString()));
    await readyPromise;
    this.ready = true;
    this.log('Sidecar process ready');
  }

  /**
   * Wait for the ready signal from the sidecar.
   */
  private waitForReady(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.readyResolver = null;
        reject(new Error('Sidecar process did not send ready signal within 10s'));
      }, 10000);
      this.readyResolver = () => {
        clearTimeout(timeout);
        this.readyResolver = null;
        resolve();
      };
    });
  }

  /**
   * Handle JSON output from the sidecar process.
   */
  private handleOutput(data: string): void {
    this.outputBuffer += data;
    const chunks = this.outputBuffer.split('\n');
    this.outputBuffer = chunks.pop() ?? '';
    const lines = chunks.filter(l => l.trim());
    for (const line of lines) {
      try {
        const response = JSON.parse(line);
        if (response.type === 'ready') {
          this.readyResolver?.();
          continue;
        }
        if (response.id && this.pendingRequests.has(response.id)) {
          const pending = this.pendingRequests.get(response.id)!;
          clearTimeout(pending.timer);
          this.pendingRequests.delete(response.id);
          if (response.success === false) {
            pending.reject(new Error(response.error || 'Unknown error'));
          } else {
            pending.resolve(response);
          }
        }
      } catch {
        // Ignore non-JSON output
      }
    }
  }

  /**
   * Send a command to the sidecar and wait for response.
   */
  private async sendCommand(type: string, params: Record<string, any> = {}): Promise<any> {
    if (!this.process || !this.ready) {
      throw new Error('Polars sidecar not connected');
    }

    const id = `req_${++this.requestCounter}_${Date.now()}`;
    const command = JSON.stringify({ type, params, id });

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Command "${type}" timed out after ${this.queryTimeout}ms`));
      }, this.queryTimeout);

      this.pendingRequests.set(id, { resolve, reject, timer });

      this.process!.stdin?.write(command + '\n', (err) => {
        if (err) {
          clearTimeout(timer);
          this.pendingRequests.delete(id);
          reject(new Error(`Failed to write to stdin: ${err.message}`));
        }
      });
    });
  }

  /**
   * Reject all pending requests (used during shutdown).
   */
  private rejectAllPending(reason: string): void {
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
    }
    this.pendingRequests.clear();
  }

  /**
   * Load a file into the sidecar's DataFrame.
   */
  async loadFile(filePath: string): Promise<{
    schema: Record<string, string>;
    rowCount: number;
    columnCount: number;
  }> {
    const result = await this.sendCommand('load_file', { filePath });
    this.log(`Loaded file: ${filePath} (${result.rowCount} rows, ${result.columnCount} columns)`);
    return {
      schema: result.schema,
      rowCount: result.rowCount,
      columnCount: result.columnCount
    };
  }

  /**
   * Execute a SQL or expression query.
   */
  async query(sql: string): Promise<QueryResult> {
    const startTime = Date.now();
    const result: PolarsQueryResult = await this.sendCommand('query', { sql });
    const duration = Date.now() - startTime;

    if (!result.success) {
      throw new Error(result.error || 'Query failed');
    }

    return {
      columns: result.columns || [],
      rows: result.rows || [],
      rowCount: result.rowCount || 0,
      duration
    };
  }

  /**
   * Apply a transformation expression to the DataFrame.
   */
  async transform(operation: string): Promise<QueryResult> {
    const startTime = Date.now();
    const result: PolarsQueryResult = await this.sendCommand('transform', { operation });
    const duration = Date.now() - startTime;

    if (!result.success) {
      throw new Error(result.error || 'Transform failed');
    }

    return {
      columns: result.columns || [],
      rows: result.rows || [],
      rowCount: result.rowCount || 0,
      duration
    };
  }

  async applyPipeline(steps: TransformOperation[], offset: number, limit: number): Promise<{
    result: QueryResult;
    totalRows: number;
    schema: Array<{ name: string; type: string; nullable: boolean }>;
  }> {
    const startTime = Date.now();
    const response = await this.sendCommand('apply_pipeline', {
      steps: steps.map(step => ({ type: step.type, params: step.params })), offset, limit,
    });
    return {
      result: {
        columns: response.columns ?? [], rows: response.rows ?? [],
        rowCount: response.rows?.length ?? 0, duration: Date.now() - startTime,
      },
      totalRows: response.totalRows ?? 0,
      schema: response.schema ?? [],
    };
  }

  /**
   * Export the current DataFrame to a file.
   */
  async export(filePath: string, format: 'parquet' | 'csv' | 'json' | 'feather'): Promise<void> {
    const result = await this.sendCommand('export', { filePath, format });
    if (!result.success) {
      throw new Error(result.error || 'Export failed');
    }
    this.log(`Exported to ${filePath} (${result.rowCount} rows)`);
  }

  /**
   * Get the schema of the current DataFrame.
   */
  async getSchema(filePath?: string): Promise<PolarsSchemaResult> {
    const result = await this.sendCommand('get_schema', filePath ? { filePath } : {});
    if (!result.success) {
      throw new Error(result.error || 'Failed to get schema');
    }
    return result;
  }

  /**
   * Get summary statistics for the current DataFrame.
   */
  async getStats(): Promise<PolarsStatsResult> {
    const result = await this.sendCommand('get_stats', {});
    if (!result.success) {
      throw new Error(result.error || 'Failed to get stats');
    }
    return result;
  }

  /**
   * Health check.
   */
  async ping(): Promise<{ polarsVersion: string; hasPyArrow: boolean; pid: number }> {
    const result = await this.sendCommand('ping', {});
    if (!result.success) {
      throw new Error(result.error || 'Ping failed');
    }
    return {
      polarsVersion: result.polarsVersion,
      hasPyArrow: result.hasPyArrow,
      pid: result.pid
    };
  }

  /**
   * Restart the sidecar process.
   */
  async restart(): Promise<void> {
    this.log('Restarting sidecar process...');
    await this.close();
    await this.startProcess();
  }

  /**
   * Shutdown the sidecar process gracefully.
   */
  async close(): Promise<void> {
    if (this.process) {
      try {
        await this.sendCommand('quit', {});
      } catch {
        // Ignore errors during shutdown
      }

      this.rejectAllPending('Process closing');

      if (this.process && !this.process.killed) {
        this.process.kill();
      }

      this.process = null;
      this.ready = false;
      this.log('Sidecar process closed');
    }
  }

  /**
   * Check if the sidecar is connected and ready.
   */
  isConnected(): boolean {
    return this.ready && this.process !== null && !this.process.killed;
  }
}
