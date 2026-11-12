import { describe, expect, it } from 'vitest';

import { classifyError, redactedDiagnostic } from '../../../src/utils/diagnostics';

describe('diagnostics', () => {
  it('classifies common recovery categories', () => {
    expect(classifyError(new Error('Out of Memory Error'))).toBe('memory');
    expect(classifyError(new Error('INSTALL excel failed'))).toBe('extension');
    expect(classifyError(new Error('HTTP timeout'))).toBe('network');
    expect(classifyError(new Error('Cannot open file'))).toBe('filesystem');
  });

  it('removes paths and URLs from local diagnostic summaries', () => {
    const report = redactedDiagnostic(
      new Error('Cannot open /Users/person/private/data.csv at https://example.com/secret.csv'),
      '/Users/person/private/data.csv',
    );
    expect(report.fileType).toBe('.csv');
    expect(report.message).not.toContain('/Users/person');
    expect(report.message).not.toContain('example.com');
  });
});
