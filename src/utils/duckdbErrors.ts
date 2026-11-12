const MEMORY_ERROR_PATTERNS = [
  /out of memory/i,
  /failed to allocate/i,
  /could not allocate/i,
  /maximum memory/i,
  /max_temp_directory_size/i,
  /temporary directory/i,
  /temp directory/i,
];

export function isDuckDBMemoryError(error: unknown): boolean {
  const message = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error);
  return MEMORY_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}
