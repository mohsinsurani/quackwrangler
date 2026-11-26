import { describe, expect, it } from 'vitest';
import { compareSchemas, schemaComparisonMarkdown } from '../../../src/schema/compare';

const baseline = {
  filePath: 'a.csv',
  rowCount: 1,
  columns: [
    { name: 'id', type: 'BIGINT', nullable: false },
    { name: 'name', type: 'VARCHAR', nullable: true },
  ],
};

describe('schema comparison', () => {
  it('detects missing, added, and changed fields', () => {
    const candidate = {
      filePath: 'b.csv',
      rowCount: 1,
      columns: [
        { name: 'id', type: 'VARCHAR', nullable: false },
        { name: 'extra', type: 'BOOLEAN', nullable: true },
      ],
    };
    expect(compareSchemas(baseline, candidate).map((item) => item.status)).toEqual([
      'type-changed',
      'missing',
      'added',
    ]);
    expect(schemaComparisonMarkdown([baseline, candidate])).toContain(
      '| id | type-changed | BIGINT | VARCHAR |',
    );
  });

  const candidate = (filePath: string) => ({ ...baseline, filePath });

  it('says when files were left out because of the limit', () => {
    const markdown = schemaComparisonMarkdown([baseline, candidate('b.csv')], { skipped: 7 });
    expect(markdown).toContain(
      'Only the first 2 files were compared. 7 more files were not checked.',
    );
    expect(markdown.indexOf('Only the first')).toBeLessThan(markdown.indexOf('Baseline:'));
  });

  it('uses the singular for one skipped file', () => {
    expect(schemaComparisonMarkdown([baseline, candidate('b.csv')], { skipped: 1 })).toContain(
      '1 more file was not checked',
    );
  });

  it('lists files that could not be read without dropping the others', () => {
    const markdown = schemaComparisonMarkdown([baseline, candidate('b.csv')], {
      failed: [{ filePath: 'broken.parquet', reason: 'not a valid Parquet file' }],
    });
    expect(markdown).toContain('Could not read `broken.parquet`: not a valid Parquet file');
    expect(markdown).toContain('## b.csv');
  });

  it('adds no warning when nothing was skipped or failed', () => {
    const markdown = schemaComparisonMarkdown([baseline, candidate('b.csv')]);
    expect(markdown).not.toContain('>');
    expect(markdown).toContain('compatible');
  });
});
