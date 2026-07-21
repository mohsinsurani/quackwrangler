import { describe, it, expect, beforeEach } from 'vitest';
import { TransformRegistry } from '../../../src/transforms/registry';

describe('TransformRegistry', () => {
  let registry: TransformRegistry;

  beforeEach(() => {
    registry = new TransformRegistry();
  });

  describe('registerTransform', () => {
    it('should register a new transform', () => {
      registry.registerTransform('custom', () => 'SELECT *');
      expect(registry.getTransform('custom')).toBeDefined();
    });

    it('should allow overwriting existing transforms', () => {
      registry.registerTransform('custom', () => 'SELECT 1');
      registry.registerTransform('custom', () => 'SELECT 2');
      expect(registry.getTransform('custom')).toBeDefined();
    });
  });

  describe('listTransforms', () => {
    it('should list all registered transforms', () => {
      const transforms = registry.listTransforms();
      expect(transforms.length).toBeGreaterThan(0);
      expect(transforms).toContain('dropColumn');
      expect(transforms).toContain('filterRows');
    });
  });

  describe('applyTransform', () => {
    it('should apply dropColumn transform', () => {
      const sql = registry.applyTransform({
        id: '1',
        type: 'dropColumn',
        params: { columns: ['col1'] },
        sql: '',
        description: '',
      });
      expect(sql).toContain('EXCLUDE');
      expect(sql).toContain('col1');
    });

    it('should apply filterRows transform', () => {
      const sql = registry.applyTransform({
        id: '1',
        type: 'filterRows',
        params: { condition: 'age > 18' },
        sql: '',
        description: '',
      });
      expect(sql).toContain('WHERE');
      expect(sql).toContain('age > 18');
    });

    it('should apply sortRows transform', () => {
      const sql = registry.applyTransform({
        id: '1',
        type: 'sortRows',
        params: { column: 'name', ascending: true },
        sql: '',
        description: '',
      });
      expect(sql).toContain('ORDER BY');
      expect(sql).toContain('ASC');
    });

    it('should throw error for unknown transform', () => {
      expect(() =>
        registry.applyTransform({
          id: '1',
          type: 'unknown',
          params: {},
          sql: '',
          description: '',
        }),
      ).toThrow('Unknown transform type');
    });
  });
});
