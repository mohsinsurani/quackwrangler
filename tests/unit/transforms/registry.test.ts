import { describe, it, expect, beforeEach } from 'vitest';
import { TransformRegistry } from '../../../src/transforms/registry';

describe('TransformRegistry', () => {
  let registry: TransformRegistry;

  beforeEach(() => {
    registry = new TransformRegistry();
  });

  describe('registerTransform', () => {
    it('should register a new transform', () => {
      registry.registerTransform('custom', {
        name: 'Custom Transform',
        description: 'A custom transform',
        execute: (input) => input,
      });
      expect(registry.getTransform('custom')).toBeDefined();
    });

    it('should throw error for duplicate names', () => {
      registry.registerTransform('test', {
        name: 'Test',
        description: 'Test',
        execute: (input) => input,
      });
      expect(() =>
        registry.registerTransform('test', {
          name: 'Test 2',
          description: 'Test 2',
          execute: (input) => input,
        }),
      ).toThrow('Transform already registered');
    });
  });

  describe('listTransforms', () => {
    it('should list all registered transforms', () => {
      const transforms = registry.listTransforms();
      expect(transforms.length).toBeGreaterThan(0);
      expect(transforms.some((t) => t.id === 'dropColumn')).toBe(true);
      expect(transforms.some((t) => t.id === 'filterRows')).toBe(true);
    });
  });

  describe('built-in transforms', () => {
    it('should have dropColumn transform', () => {
      const transform = registry.getTransform('dropColumn');
      expect(transform).toBeDefined();
      expect(transform?.name).toBe('Drop Column');
    });

    it('should have filterRows transform', () => {
      const transform = registry.getTransform('filterRows');
      expect(transform).toBeDefined();
      expect(transform?.name).toBe('Filter Rows');
    });

    it('should have sortRows transform', () => {
      const transform = registry.getTransform('sortRows');
      expect(transform).toBeDefined();
    });

    it('should have castType transform', () => {
      const transform = registry.getTransform('castType');
      expect(transform).toBeDefined();
    });

    it('should have fillMissing transform', () => {
      const transform = registry.getTransform('fillMissing');
      expect(transform).toBeDefined();
    });

    it('should have deduplicate transform', () => {
      const transform = registry.getTransform('deduplicate');
      expect(transform).toBeDefined();
    });
  });
});
