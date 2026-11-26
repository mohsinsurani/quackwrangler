import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

import { buildPolarsRecipe } from '../../../src/polars/recipe.js';
import type { TransformOperation } from '../../../src/types/index.js';

const step = (type: string, params: Record<string, unknown>): TransformOperation => ({
  id: type,
  type,
  params,
  sql: '',
  description: type,
});

// One pinned pair, used by every uv call. PyPI can yank releases (1.43.0 was yanked), so a
// failure to resolve these means: pick the latest non-yanked Polars and update both here.
const POLARS = 'polars==1.44.2';
const PYARROW = 'pyarrow==25.0.0';

describe('Polars recipe generation', () => {
  it.skipIf(process.env.QW_POLARS_INTEGRATION !== '1')(
    'runs generated supported recipes against Parquet with the installed Polars and DuckDB',
    async () => {
      const dir = await mkdtemp(join(tmpdir(), 'qw-polars-'));
      try {
        const source = join(dir, 'source.parquet');
        const generate = spawnSync(
          'uv',
          [
            'run',
            '--no-project',
            '--with',
            POLARS,
            '--with',
            PYARROW,
            'python',
            '-c',
            `import polars as pl; pl.DataFrame({'id':['00123','00002','00003','00004'],'group':['b','a','a','a'],'n':[None,2,1,None]}).write_parquet(${JSON.stringify(source)})`,
          ],
          { encoding: 'utf8' },
        );
        expect(generate.status, generate.stderr).toBe(0);
        const history = [
          step('filter_rows', { column: 'n', operator: 'is_null' }),
          step('rename_column', { oldName: 'group', newName: 'category' }),
          step('drop_column', { columns: ['n'] }),
          step('sort_rows', { column: 'id', direction: 'DESC' }),
        ];
        const recipe = buildPolarsRecipe(source, history);
        const python = `import json\n${recipe}\nprint(result.write_json())\n`;
        const run = spawnSync(
          'uv',
          ['run', '--no-project', '--with', POLARS, 'python', '-c', python],
          { encoding: 'utf8' },
        );
        expect(run.status, run.stderr).toBe(0);
        const rows = JSON.parse(run.stdout.trim());
        const duckdbExpected = spawnSync(
          'node',
          [
            '--input-type=module',
            '-e',
            `import duckdb from '@duckdb/node-api'; const db=await duckdb.DuckDBInstance.create(':memory:'); const c=await db.connect(); await c.run("CREATE VIEW source AS SELECT * FROM read_parquet('${source.replaceAll("'", "''")}')"); const r=await c.runAndReadAll('WITH f AS (SELECT * FROM source WHERE n IS NULL), r AS (SELECT * RENAME (\"group\" AS category) FROM f), d AS (SELECT * EXCLUDE (n) FROM r), o AS (SELECT * FROM d ORDER BY id DESC) SELECT * FROM o'); console.log(JSON.stringify((await r.getRowsJson()).map(row => Object.fromEntries(r.columnNames().map((name, i) => [name, row[i]])))))`,
          ],
          { encoding: 'utf8' },
        );
        expect(duckdbExpected.status, duckdbExpected.stderr).toBe(0);
        expect(rows).toEqual(JSON.parse(duckdbExpected.stdout.trim()));
        expect(rows).toEqual([
          { id: '00123', category: 'b' },
          { id: '00004', category: 'a' },
        ]);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    // A cold uv cache downloads Polars and PyArrow for each environment.
    180_000,
  );

  it('rejects sources, filters, and selector-like identifiers whose semantics are not verified', () => {
    expect(() => buildPolarsRecipe('/tmp/data.csv', [])).toThrow('Parquet source');
    expect(() =>
      buildPolarsRecipe('/tmp/data.parquet', [
        step('filter_rows', { column: 'id', operator: 'equals', value: 1 }),
      ]),
    ).toThrow('null filters only');
    expect(() =>
      buildPolarsRecipe('/tmp/data.parquet', [
        step('filter_rows', { column: '*', operator: 'is_null' }),
      ]),
    ).toThrow('interpreted as a Polars selector');
    expect(() =>
      buildPolarsRecipe('/tmp/data.parquet', [
        step('sort_rows', { column: 'value?', direction: 'ASC' }),
      ]),
    ).toThrow('interpreted as a Polars selector');
  });

  it('refuses a multi-column sort instead of exporting only its first column', () => {
    expect(() =>
      buildPolarsRecipe('/tmp/data.parquet', [
        step('sort_rows', {
          keys: [
            { column: 'region', direction: 'ASC' },
            { column: 'price', direction: 'DESC' },
          ],
        }),
      ]),
    ).toThrow(/several columns/);
  });

  it('uses literal selectors for special names or rejects selector patterns', () => {
    expect(() =>
      buildPolarsRecipe('/tmp/data.parquet', [
        step('filter_rows', { column: '*', operator: 'is_null' }),
      ]),
    ).toThrow('interpreted as a Polars selector');
    expect(() =>
      buildPolarsRecipe('/tmp/data.parquet', [
        step('sort_rows', { column: 'value?', direction: 'ASC' }),
      ]),
    ).toThrow('interpreted as a Polars selector');
  });
});
