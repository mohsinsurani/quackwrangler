import * as path from 'node:path';

export type ErrorCategory =
  'memory' | 'extension' | 'format' | 'filesystem' | 'network' | 'query' | 'unknown';

export function classifyError(error: unknown): ErrorCategory {
  const message = error instanceof Error ? error.message : String(error);
  if (
    /out of memory|failed to allocate|max_temp_directory_size|temp(?:orary)? directory/i.test(
      message,
    )
  )
    return 'memory';
  if (/install|load .*extension|extension.*(?:missing|unavailable)|requires duckdb/i.test(message))
    return 'extension';
  if (/http|https|s3|network|connection|timeout|certificate/i.test(message)) return 'network';
  if (/permission|access denied|no such file|cannot open file|read-only/i.test(message))
    return 'filesystem';
  if (/parse|conversion|invalid input|unsupported file|malformed/i.test(message)) return 'format';
  if (/binder|catalog|parser|sql|query/i.test(message)) return 'query';
  return 'unknown';
}

export function redactedDiagnostic(error: unknown, source?: string): Record<string, string> {
  const message = error instanceof Error ? error.message : String(error);
  return {
    category: classifyError(error),
    fileType: source ? path.extname(source).toLowerCase() || '(none)' : '(unknown)',
    message: message
      .replace(/(?:[A-Za-z]:)?[\\/](?:[^\s'"`]+[\\/])*[^\s'"`]+/g, '<path>')
      .replace(/https?:\/\/[^\s'"`]+/gi, '<url>')
      .slice(0, 500),
  };
}
