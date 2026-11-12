import { describe, expect, it } from 'vitest';

import { isDuckDBMemoryError } from '../../../src/utils/duckdbErrors';

describe('DuckDB memory errors', () => {
  it.each(['Out of Memory Error', 'Failed to allocate 2 GiB', 'max_temp_directory_size exceeded'])(
    'recognizes %s',
    (message) => {
      expect(isDuckDBMemoryError(new Error(message))).toBe(true);
    },
  );

  it('does not classify ordinary file errors as memory errors', () => {
    expect(isDuckDBMemoryError(new Error('No files found'))).toBe(false);
  });
});
