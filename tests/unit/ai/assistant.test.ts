import { describe, expect, it, vi } from 'vitest';
import { suggestTransforms, validateSuggestions } from '../../../src/ai/assistant';

describe('AI transform assistant', () => {
  it('accepts allow-listed structured transforms and rejects SQL-like operations', () => {
    expect(
      validateSuggestions({
        transforms: [
          { type: 'filter_rows', params: { column: 'active', operator: 'equals', value: true } },
        ],
      }),
    ).toHaveLength(1);
    expect(() =>
      validateSuggestions({
        transforms: [{ type: 'execute_sql', params: { sql: 'DROP TABLE x' } }],
      }),
    ).toThrow('unsupported transform');
  });

  it('sends schema metadata but no row data and parses structured output', async () => {
    const request = vi
      .fn()
      .mockResolvedValue({
        ok: true,
        json: async () => ({
          output_text: JSON.stringify({
            transforms: [{ type: 'deduplicate', params: { columns: 'id' } }],
          }),
        }),
      });
    const result = await suggestTransforms(
      'secret',
      'test-model',
      'remove duplicates',
      [{ name: 'id', type: 'BIGINT', nullable: false }],
      request as never,
    );
    const body = JSON.parse(request.mock.calls[0][1].body);
    expect(body.input).toContain('Schema only');
    expect(body.input).not.toContain('rows');
    expect(result[0].type).toBe('deduplicate');
  });
});
