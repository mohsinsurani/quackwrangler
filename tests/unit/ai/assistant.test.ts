import { describe, expect, it, vi } from 'vitest';
import {
  suggestTransforms,
  validateAISettings,
  validateSuggestions,
} from '../../../src/ai/assistant';

const columns = [{ name: 'id', type: 'BIGINT', nullable: false }];

function response(plan: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ output_text: JSON.stringify(plan) }),
  };
}

describe('AI transform assistant', () => {
  it('validates OpenAI and compatible provider settings', () => {
    expect(validateAISettings('openai', ' gpt-4o-mini ', 'ignored', 60)).toEqual({
      provider: 'openai',
      model: 'gpt-4o-mini',
      baseUrl: 'https://api.openai.com',
      timeoutMs: 60_000,
    });
    expect(
      validateAISettings('openai-compatible', 'local-model', 'https://ai.example/', 30).baseUrl,
    ).toBe('https://ai.example');
    expect(() => validateAISettings('other', 'model', 'https://ai.example', 60)).toThrow(
      'Unsupported AI provider',
    );
    expect(() => validateAISettings('openai-compatible', 'model', 'http://ai.example', 60)).toThrow(
      'must use HTTPS',
    );
    expect(() => validateAISettings('openai', '', '', 60)).toThrow('must not be empty');
    expect(() => validateAISettings('openai', 'model', '', 4)).toThrow('between 5 and 300');
  });
  it('accepts expanded transforms and rejects join, union, SQL, and add_column operations', () => {
    expect(
      validateSuggestions({
        transforms: [
          {
            type: 'pivot',
            params: { index: 'region', column: 'year', value: 'sales', aggregate: 'SUM' },
          },
          {
            type: 'unpivot',
            params: { columns: 'q1,q2', nameColumn: 'quarter', valueColumn: 'sales' },
          },
        ],
      }),
    ).toHaveLength(2);
    // add_column is removed from AI contracts because it allows arbitrary SQL expressions.
    for (const type of ['add_column', 'join_file', 'union_file', 'execute_sql']) {
      expect(() => validateSuggestions({ transforms: [{ type, params: {} }] })).toThrow(
        'unsupported transform',
      );
    }
  });

  it('strictly validates required fields, enums, types, and unknown or raw SQL fields', () => {
    expect(() =>
      validateSuggestions({ transforms: [{ type: 'rename_column', params: { oldName: 'id' } }] }),
    ).toThrow('missing required parameter: newName');
    expect(() =>
      validateSuggestions({
        transforms: [{ type: 'sort_rows', params: { column: 'id', direction: 'SIDEWAYS' } }],
      }),
    ).toThrow('invalid direction');
    expect(() =>
      validateSuggestions({ transforms: [{ type: 'drop_column', params: { column: 4 } }] }),
    ).toThrow('invalid parameter: column');
    expect(() =>
      validateSuggestions({
        transforms: [
          { type: 'filter_rows', params: { column: 'id', operator: 'equals', condition: '1=1' } },
        ],
      }),
    ).toThrow('unknown parameter: condition');
    expect(() =>
      validateSuggestions({
        transforms: [{ type: 'aggregate', params: { function: 'COUNT', aggregations: 'evil()' } }],
      }),
    ).toThrow('unknown parameter: aggregations');
  });

  it('caps validated output at 12 transforms', () => {
    const transforms = Array.from({ length: 15 }, () => ({
      type: 'drop_column',
      params: { column: 'unused' },
    }));
    expect(validateSuggestions({ transforms })).toHaveLength(12);
  });

  it('sends schema-only metadata, history, contracts, URL, signal, and strict schema', async () => {
    const request = vi.fn().mockResolvedValue(response({
      transforms: [{ type: 'deduplicate', params: { columns: 'id' } }],
    }));
    const result = await suggestTransforms('secret', 'test-model', 'remove duplicates', columns, {
      request: request as never,
      baseUrl: 'https://gateway.example/',
      history: [{ type: 'drop_column', params: { column: 'private' } }],
    });
    const [url, init] = request.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(url).toBe('https://gateway.example/v1/responses');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(body.input).toContain('Schema metadata only');
    expect(body.input).toContain('Current transforms');
    expect(body.input).toContain('drop_column');
    expect(body.input).toContain('Never write SQL');
    expect(body.input).not.toContain('row data');
    // Column names in history are schema-safe references and allowed.
    // Values, expressions, file paths, and literals must not be included.
    expect(body.text.format.strict).toBe(true);
    // 14 contract types (add_column removed to block arbitrary SQL expression injection).
    expect(body.text.format.schema.properties.transforms.items.oneOf).toHaveLength(14);
    expect(JSON.stringify(body.text.format.schema)).not.toContain('condition');
    expect(JSON.stringify(body.text.format.schema)).not.toContain('aggregations');
    expect(result[0].type).toBe('deduplicate');
  });

  it('preserves the positional injectable fetch and parses output content fallback', async () => {
    const request = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        output: [{ content: [{ text: JSON.stringify({ transforms: [] }) }] }],
      }),
    });
    await expect(
      suggestTransforms('secret', 'test-model', 'nothing', columns, request as never),
    ).resolves.toEqual([]);
    expect(request.mock.calls[0][0]).toBe('https://api.openai.com/v1/responses');
  });

  it('reports HTTP errors', async () => {
    const request = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => 'rate limited',
    });
    await expect(
      suggestTransforms('secret', 'model', 'goal', columns, request as never),
    ).rejects.toThrow('OpenAI request failed (429): rate limited');
  });

  it('reports malformed response JSON, malformed transform JSON, and missing output', async () => {
    const malformedResponse = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => {
        throw new SyntaxError('bad');
      },
    });
    await expect(
      suggestTransforms('secret', 'model', 'goal', columns, malformedResponse as never),
    ).rejects.toThrow('OpenAI returned malformed JSON');

    const malformedPlan = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ output_text: '{' }) });
    await expect(
      suggestTransforms('secret', 'model', 'goal', columns, malformedPlan as never),
    ).rejects.toThrow('OpenAI returned malformed transform JSON');

    const missing = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ output: [] }) });
    await expect(
      suggestTransforms('secret', 'model', 'goal', columns, missing as never),
    ).rejects.toThrow('OpenAI returned no transform plan');
  });

  it('aborts after 60 seconds with a clear error', async () => {
    vi.useFakeTimers();
    const request = vi.fn((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      }),
    );
    const pending = suggestTransforms('secret', 'model', 'goal', columns, request as never);
    const assertion = expect(pending).rejects.toThrow('AI provider request timed out after 60 seconds');
    await vi.advanceTimersByTimeAsync(60_000);
    await assertion;
    vi.useRealTimers();
  });
});
