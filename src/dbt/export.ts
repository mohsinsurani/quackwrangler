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

const NON_PORTABLE_TRANSFORMS = new Set(['join_file', 'union_file', 'add_column', 'addColumn']);

export function buildDbtSql(
  history: TransformOperation[],
  upstreamModel: string,
  style: DbtExportStyle,
): string {
  const nonPortable = history.find((step) => NON_PORTABLE_TRANSFORMS.has(step.type));
  if (nonPortable) {
    if (nonPortable.type === 'add_column' || nonPortable.type === 'addColumn') {
      throw new Error(
        `The transform history includes '${nonPortable.type}', whose raw DuckDB expression cannot be exported as portable dbt SQL. Replace it with the validated Formula Builder operation before copying dbt SQL.`,
      );
    }
    throw new Error(
      `The transform history includes '${nonPortable.type}' which references a local file path and cannot be exported as portable dbt SQL. Remove the join or union step before copying dbt SQL.`,
    );
  }
  const model = validateModelName(upstreamModel);
  const pipeline = buildPipelineSQL(history, 'source_data');
  const ctes = `source_data AS (\n  SELECT * FROM {{ ref('${model}') }}\n),\nquackwrangler_result AS (\n${indent(pipeline)}\n)`;
  return style === 'cte' ? ctes : `WITH ${ctes}\nSELECT * FROM quackwrangler_result`;
}
