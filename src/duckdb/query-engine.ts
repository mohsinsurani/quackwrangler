import { DuckDBConnection } from './connection.js';
import { quoteLiteral } from './sql.js';

export function normalizeReadOnlyQuery(sql: string): string {
  const normalized = sql.trim().replace(/;\s*$/, '').trim();
  if (!normalized) throw new Error('Enter a query to run');
  if (normalized.includes(';')) throw new Error('Run one query at a time');
  const withoutComments = normalized.replace(/^(?:\s*--[^\n]*(?:\n|$)|\s*\/\*[\s\S]*?\*\/\s*)+/, '').trimStart();
  if (!/^(SELECT|WITH|VALUES)\b/i.test(withoutComments)) {
    throw new Error('Custom queries are read-only. Start with SELECT, WITH, or VALUES.');
  }
  return normalized;
}

export async function exportResults(
  connection: DuckDBConnection,
  sql: string,
  outputPath: string,
  format: 'parquet' | 'csv' | 'json'
): Promise<void> {
  const trimmedSql = sql.replace(/;$/, '');
  const destination = quoteLiteral(outputPath);

  let exportSql: string;
  switch (format) {
    case 'parquet':
      exportSql = `COPY (${trimmedSql}) TO ${destination} (FORMAT PARQUET)`;
      break;
    case 'csv':
      exportSql = `COPY (${trimmedSql}) TO ${destination} (FORMAT CSV, HEADER)`;
      break;
    case 'json':
      exportSql = `COPY (${trimmedSql}) TO ${destination} (FORMAT JSON)`;
      break;
    default:
      throw new Error(`Unsupported export format: ${format}`);
  }

  await connection.query(exportSql);
}
