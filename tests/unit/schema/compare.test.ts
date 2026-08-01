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
});
