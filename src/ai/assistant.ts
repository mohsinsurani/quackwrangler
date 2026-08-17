import type { ColumnInfo } from '../types/index.js';

export interface SuggestedTransform {
  type: string;
  params: Record<string, unknown>;
}

type FieldContract = {
  type: 'string' | 'number' | 'boolean' | 'stringArray' | 'value';
  required?: boolean;
  enum?: readonly string[];
};

const filterOperators = [
  'equals',
  'not_equals',
  'contains',
  'not_contains',
  'starts_with',
  'ends_with',
  'greater_than',
  'greater_equals',
  'less_than',
  'less_equals',
  'between',
  'in',
  'not_in',
  'is_null',
  'is_not_null',
] as const;

const requiredString = { type: 'string', required: true } as const;
const optionalString = { type: 'string' } as const;
const TRANSFORM_CONTRACTS: Record<string, Record<string, FieldContract>> = {
  filter_rows: {
    column: requiredString,
    operator: { type: 'string', required: true, enum: filterOperators },
    value: { type: 'value' },
    value2: { type: 'value' },
  },
  sort_rows: {
    column: requiredString,
    direction: { type: 'string', required: true, enum: ['ASC', 'DESC'] },
  },
  drop_column: { column: requiredString },
  rename_column: { oldName: requiredString, newName: requiredString },
  cast_type: {
    column: requiredString,
    targetType: {
      type: 'string',
      required: true,
      enum: ['VARCHAR', 'INTEGER', 'BIGINT', 'DOUBLE', 'BOOLEAN', 'DATE', 'TIMESTAMP'],
    },
  },
  fill_nulls: { column: requiredString, value: { type: 'value', required: true } },
  deduplicate: { columns: { type: 'string', required: true } },
  aggregate: {
    groupBy: optionalString,
    function: {
      type: 'string',
      required: true,
      enum: ['COUNT', 'COUNT_DISTINCT', 'SUM', 'AVG', 'MIN', 'MAX'],
    },
    column: optionalString,
    alias: optionalString,
  },
  formula_column: {
    name: requiredString,
    formula: {
      type: 'string',
      required: true,
      enum: ['if', 'date_diff', 'regex_extract', 'concat'],
    },
    column: requiredString,
    operator: { type: 'string', enum: filterOperators },
    compareValue: { type: 'value' },
    trueValue: { type: 'value' },
    falseValue: { type: 'value' },
    secondColumn: optionalString,
    unit: { type: 'string', enum: ['day', 'week', 'month', 'year'] },
    pattern: optionalString,
    separator: optionalString,
  },
  extract_nested: { column: requiredString, path: requiredString, name: requiredString },
  flatten_nested: { column: requiredString, path: optionalString },
  explode_nested: { column: requiredString, path: optionalString, name: requiredString },
  pivot: {
    index: requiredString,
    column: requiredString,
    value: requiredString,
    aggregate: { type: 'string', required: true, enum: ['SUM', 'AVG', 'MIN', 'MAX', 'COUNT'] },
  },
  unpivot: { columns: requiredString, nameColumn: requiredString, valueColumn: requiredString },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function validateParams(type: string, value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`AI transform parameters are invalid for ${type}`);
  const contract = TRANSFORM_CONTRACTS[type];
  for (const key of Object.keys(value)) {
    if (!(key in contract)) throw new Error(`AI transform ${type} has unknown parameter: ${key}`);
  }
  for (const [key, field] of Object.entries(contract)) {
    const parameter = value[key];
    if (field.required && (parameter === undefined || parameter === '')) {
      throw new Error(`AI transform ${type} is missing required parameter: ${key}`);
    }
    if (parameter === undefined) continue;
    const valid =
      field.type === 'value'
        ? parameter === null || ['string', 'number', 'boolean'].includes(typeof parameter)
        : field.type === 'stringArray'
          ? Array.isArray(parameter) && parameter.every((item) => typeof item === 'string')
          : typeof parameter === field.type;
    if (!valid) throw new Error(`AI transform ${type} has invalid parameter: ${key}`);
    if (field.enum && !field.enum.includes(parameter as string)) {
      throw new Error(`AI transform ${type} has invalid ${key}: ${String(parameter)}`);
    }
  }
  return value;
}

export function validateSuggestions(value: unknown): SuggestedTransform[] {
  if (!isRecord(value) || !Array.isArray(value.transforms)) {
    throw new Error('AI response did not contain a transform list');
  }
  return value.transforms
    .map((item) => {
      if (!isRecord(item)) throw new Error('AI returned an invalid transform');
      const keys = Object.keys(item);
      if (keys.some((key) => key !== 'type' && key !== 'params')) {
        throw new Error('AI returned an invalid transform');
      }
      const type = typeof item.type === 'string' ? item.type : '';
      if (!(type in TRANSFORM_CONTRACTS))
        throw new Error(`AI suggested unsupported transform: ${type}`);
      return { type, params: validateParams(type, item.params) };
    })
    .slice(0, 12);
}

function fieldSchema(field: FieldContract): Record<string, unknown> {
  if (field.type === 'value') return { type: ['string', 'number', 'boolean', 'null'] };
  if (field.type === 'stringArray') return { type: 'array', items: { type: 'string' } };
  return { type: field.type, ...(field.enum ? { enum: field.enum } : {}) };
}

function responseSchema(): Record<string, unknown> {
  const variants = Object.entries(TRANSFORM_CONTRACTS).map(([type, fields]) => ({
    type: 'object',
    additionalProperties: false,
    required: ['type', 'params'],
    properties: {
      type: { const: type },
      params: {
        type: 'object',
        additionalProperties: false,
        required: Object.entries(fields)
          .filter(([, field]) => field.required)
          .map(([key]) => key),
        properties: Object.fromEntries(
          Object.entries(fields).map(([key, field]) => [key, fieldSchema(field)]),
        ),
      },
    },
  }));
  return {
    type: 'object',
    additionalProperties: false,
    required: ['transforms'],
    properties: { transforms: { type: 'array', maxItems: 12, items: { oneOf: variants } } },
  };
}

export interface SuggestTransformsOptions {
  request?: typeof fetch;
  baseUrl?: string;
  history?: SuggestedTransform[];
  timeoutMs?: number;
}

export type AIProvider = 'openai' | 'openai-compatible';

export function validateAISettings(
  provider: string,
  model: string,
  baseUrl: string,
  timeoutSeconds: number,
): { provider: AIProvider; model: string; baseUrl: string; timeoutMs: number } {
  if (provider !== 'openai' && provider !== 'openai-compatible') {
    throw new Error(`Unsupported AI provider: ${provider}`);
  }
  const normalizedModel = model.trim();
  if (!normalizedModel) throw new Error('AI model must not be empty');
  const normalizedBaseUrl = provider === 'openai' ? 'https://api.openai.com' : baseUrl.trim();
  let parsed: URL;
  try {
    parsed = new URL(normalizedBaseUrl);
  } catch {
    throw new Error('AI provider base URL must be a valid HTTPS URL');
  }
  if (parsed.protocol !== 'https:') throw new Error('AI provider base URL must use HTTPS');
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds < 5 || timeoutSeconds > 300) {
    throw new Error('AI request timeout must be between 5 and 300 seconds');
  }
  return {
    provider,
    model: normalizedModel,
    baseUrl: normalizedBaseUrl.replace(/\/$/, ''),
    timeoutMs: timeoutSeconds * 1_000,
  };
}

export async function suggestTransforms(
  apiKey: string,
  model: string,
  goal: string,
  columns: ColumnInfo[],
  requestOrOptions: typeof fetch | SuggestTransformsOptions = fetch,
): Promise<SuggestedTransform[]> {
  const options =
    typeof requestOrOptions === 'function' ? { request: requestOrOptions } : requestOrOptions;
  const request = options.request ?? fetch;
  const schema = columns.map(({ name, type, nullable }) => ({ name, type, nullable }));
  const contracts = Object.fromEntries(
    Object.entries(TRANSFORM_CONTRACTS).map(([type, fields]) => [type, Object.keys(fields)]),
  );
  // Include only transform types in the history summary.
  // Never send user-entered values, expressions, patterns, file paths, or literals.
  const SCHEMA_SAFE_PARAMS = new Set([
    'column',
    'oldName',
    'newName',
    'groupBy',
    'index',
    'nameColumn',
    'valueColumn',
    'secondColumn',
    'targetType',
    'direction',
    'formula',
    'operator',
    'unit',
    'aggregate',
    'function',
    'alias',
    'columns',
  ]);
  const history = (options.history ?? []).map(({ type, params }) => ({
    type,
    // Retain only param keys whose values are column/schema references, not data values.
    columns: Object.entries(params as Record<string, unknown>)
      .filter(
        ([k, v]) =>
          SCHEMA_SAFE_PARAMS.has(k) && typeof v === 'string' && v.length > 0 && v.length < 128,
      )
      .map(([k, v]) => `${k}=${v}`)
      .join(','),
  }));
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 60_000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await request(
      `${(options.baseUrl ?? 'https://api.openai.com').replace(/\/$/, '')}/v1/responses`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          input: `Build a minimal visual transform plan. Never write SQL.\nGoal: ${goal}\nSchema metadata only: ${JSON.stringify(schema)}\nContracts (only these fields): ${JSON.stringify(contracts)}\nCurrent transforms: ${JSON.stringify(history)}`,
          text: {
            format: {
              type: 'json_schema',
              name: 'quackwrangler_transforms',
              strict: true,
              schema: responseSchema(),
            },
          },
        }),
      },
    );
  } catch (error) {
    if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
      throw new Error(`AI provider request timed out after ${timeoutMs / 1_000} seconds`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok)
    throw new Error(`OpenAI request failed (${response.status}): ${await response.text()}`);
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error('OpenAI returned malformed JSON');
  }
  if (!isRecord(body)) throw new Error('OpenAI returned no transform plan');
  const output = Array.isArray(body.output) ? body.output : [];
  const text =
    (typeof body.output_text === 'string' ? body.output_text : undefined) ??
    output
      .filter(isRecord)
      .flatMap((item) => (Array.isArray(item.content) ? item.content : []))
      .find(
        (item): item is Record<string, unknown> => isRecord(item) && typeof item.text === 'string',
      )?.text;
  if (typeof text !== 'string' || !text) throw new Error('OpenAI returned no transform plan');
  try {
    return validateSuggestions(JSON.parse(text) as unknown);
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('OpenAI returned malformed transform JSON');
    throw error;
  }
}
