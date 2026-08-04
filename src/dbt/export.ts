import { buildPipelineSQL } from '../transforms/pipeline.js';
import { TransformOperation } from '../types/index.js';

export type DbtExportStyle = 'model' | 'cte';

function validateModelName(modelName: string): string {
  const trimmed = modelName.trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) {
    throw new Error('dbt model names may contain letters, numbers, and underscores');
  }
  return trimmed;
}

function indent(sql: string): string {
  return sql
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');
}

export function buildDbtSql(
  history: TransformOperation[],
  upstreamModel: string,
  style: DbtExportStyle,
): string {
  const model = validateModelName(upstreamModel);
  const pipeline = buildPipelineSQL(history, 'source_data');
  const ctes = `source_data AS (\n  SELECT * FROM {{ ref('${model}') }}\n),\nquackwrangler_result AS (\n${indent(pipeline)}\n)`;
  return style === 'cte' ? ctes : `WITH ${ctes}\nSELECT * FROM quackwrangler_result`;
}
