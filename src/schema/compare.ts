import type { TableSchema } from '../types/index.js';

export interface SchemaDifference {
  column: string;
  status: 'missing' | 'added' | 'type-changed';
  expected?: string;
  actual?: string;
}

export function compareSchemas(baseline: TableSchema, candidate: TableSchema): SchemaDifference[] {
  const expected = new Map(baseline.columns.map((column) => [column.name, column.type]));
  const actual = new Map(candidate.columns.map((column) => [column.name, column.type]));
  const differences: SchemaDifference[] = [];
  for (const [column, type] of expected) {
    if (!actual.has(column)) differences.push({ column, status: 'missing', expected: type });
    else if (actual.get(column) !== type)
      differences.push({
        column,
        status: 'type-changed',
        expected: type,
        actual: actual.get(column),
      });
  }
  for (const [column, type] of actual)
    if (!expected.has(column)) differences.push({ column, status: 'added', actual: type });
  return differences;
}

export interface ComparisonNotes {
  /** Files that were found but not compared because of the limit. */
  skipped?: number;
  /** Files that could not be read, with the reason. */
  failed?: Array<{ filePath: string; reason: string }>;
}

export function schemaComparisonMarkdown(
  schemas: TableSchema[],
  notes: ComparisonNotes = {},
): string {
  if (schemas.length < 2) throw new Error('Select at least two files');
  const baseline = schemas[0];
  const sections = schemas.slice(1).map((candidate) => {
    const differences = compareSchemas(baseline, candidate);
    const rows = differences.length
      ? differences
          .map(
            (item) =>
              `| ${item.column} | ${item.status} | ${item.expected ?? '—'} | ${item.actual ?? '—'} |`,
          )
          .join('\n')
      : '| — | compatible | — | — |';
    return `## ${candidate.filePath}\n\n| Column | Status | Baseline | Candidate |\n| --- | --- | --- | --- |\n${rows}`;
  });
  const warnings: string[] = [];
  if (notes.skipped)
    warnings.push(
      `> Only the first ${schemas.length} files were compared. ${notes.skipped} more ${notes.skipped === 1 ? 'file was' : 'files were'} not checked.`,
    );
  for (const failure of notes.failed ?? [])
    warnings.push(`> Could not read \`${failure.filePath}\`: ${failure.reason}`);
  const header = warnings.length ? `${warnings.join('\n')}\n\n` : '';
  return `# QuackWrangler schema comparison\n\n${header}Baseline: \`${baseline.filePath}\`\n\n${sections.join('\n\n')}`;
}
