import { describe, it, expect } from 'vitest';
import { generateDuckDBSQL, generatePythonCode } from '../../../src/transforms/codegen';
import { TransformOperation } from '../../../src/types';

describe('codegen', () => {
  const sampleSteps: TransformOperation[] = [
    {
      id: '1',
      type: 'dropColumn',
      params: { column: 'old_col' },
      sql: 'SELECT * EXCLUDE(old_col) FROM step0',
      description: 'Drop column old_col',
    },
    {
      id: '2',
      type: 'fillMissing',
      params: { column: 'price', value: '0' },
      sql: 'SELECT *, COALESCE(price, 0) AS price FROM step1',
      description: 'Fill missing values in price',
    },
  ];

  describe('generateDuckDBSQL', () => {
    it('should generate valid SQL from steps', () => {
      const sql = generateDuckDBSQL(sampleSteps, 'data.parquet');
      expect(sql).toContain('read_parquet');
      expect(sql).toContain('CREATE VIEW');
      expect(sql).toContain('EXCLUDE');
      expect(sql).toContain('COALESCE');
    });

    it('should wrap steps as views', () => {
      const sql = generateDuckDBSQL(sampleSteps, 'data.parquet');
      expect(sql).toContain('step0');
      expect(sql).toContain('step1');
      expect(sql).toContain('step2');
    });

    it('should handle empty steps', () => {
      const sql = generateDuckDBSQL([], 'data.parquet');
      expect(sql).toContain('read_parquet');
    });
  });

  describe('generatePythonCode', () => {
    it('should generate Python code with duckdb', () => {
      const python = generatePythonCode(sampleSteps, 'data.parquet');
      expect(python).toContain('import duckdb');
      expect(python).toContain('read_parquet');
      expect(python).toContain('.sql()');
    });

    it('should include step comments', () => {
      const python = generatePythonCode(sampleSteps, 'data.parquet');
      expect(python).toContain('Step 1');
      expect(python).toContain('Step 2');
    });
  });
});
