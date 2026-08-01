import type { ColumnInfo } from '../types/index.js';

export interface SuggestedTransform {
  type: string;
  params: Record<string, unknown>;
}

const ALLOWED_TRANSFORMS = new Set([
  'filter_rows',
  'sort_rows',
  'drop_column',
  'rename_column',
  'cast_type',
  'fill_nulls',
  'deduplicate',
  'aggregate',
  'formula_column',
  'extract_nested',
  'flatten_nested',
  'explode_nested',
]);

export function validateSuggestions(value: unknown): SuggestedTransform[] {
  if (
    !value ||
    typeof value !== 'object' ||
    !Array.isArray((value as { transforms?: unknown }).transforms)
  ) {
    throw new Error('AI response did not contain a transform list');
  }
  return (value as { transforms: unknown[] }).transforms
    .map((item) => {
      if (!item || typeof item !== 'object') throw new Error('AI returned an invalid transform');
      const type = String((item as { type?: unknown }).type ?? '');
      const params = (item as { params?: unknown }).params;
      if (!ALLOWED_TRANSFORMS.has(type))
        throw new Error(`AI suggested unsupported transform: ${type}`);
      if (!params || typeof params !== 'object' || Array.isArray(params))
        throw new Error('AI transform parameters are invalid');
      return { type, params: params as Record<string, unknown> };
    })
    .slice(0, 12);
}

export async function suggestTransforms(
  apiKey: string,
  model: string,
  goal: string,
  columns: ColumnInfo[],
  request: typeof fetch = fetch,
): Promise<SuggestedTransform[]> {
  const schema = columns.map(({ name, type, nullable }) => ({ name, type, nullable }));
  const response = await request('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      input: `Create a minimal visual data-cleaning pipeline for this goal: ${goal}\nSchema only (no row data): ${JSON.stringify(schema)}\nUse only the allowed transform types. Never emit SQL.`,
      text: {
        format: {
          type: 'json_schema',
          name: 'quackwrangler_transforms',
          strict: false,
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['transforms'],
            properties: {
              transforms: {
                type: 'array',
                maxItems: 12,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['type', 'params'],
                  properties: {
                    type: { type: 'string', enum: [...ALLOWED_TRANSFORMS] },
                    params: { type: 'object', additionalProperties: true },
                  },
                },
              },
            },
          },
        },
      },
    }),
  });
  if (!response.ok)
    throw new Error(`OpenAI request failed (${response.status}): ${await response.text()}`);
  const body = (await response.json()) as {
    output_text?: string;
    output?: Array<{ content?: Array<{ text?: string }> }>;
  };
  const text =
    body.output_text ??
    body.output?.flatMap((item) => item.content ?? []).find((item) => item.text)?.text;
  if (!text) throw new Error('OpenAI returned no transform plan');
  return validateSuggestions(JSON.parse(text));
}
