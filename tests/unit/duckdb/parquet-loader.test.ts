import { describe, it, expect } from 'vitest';
import { isDataFile, getDataFilePatterns } from '../../../src/utils/fileDetector';

describe('fileDetector', () => {
  describe('isDataFile', () => {
    it('should detect parquet files', () => {
      expect(isDataFile('data.parquet')).toBe(true);
      expect(isDataFile('/path/to/data.parquet')).toBe(true);
    });

    it('should detect CSV files', () => {
      expect(isDataFile('data.csv')).toBe(true);
      expect(isDataFile('data.tsv')).toBe(true);
    });

    it('should detect JSON files', () => {
      expect(isDataFile('data.json')).toBe(true);
      expect(isDataFile('data.jsonl')).toBe(true);
      expect(isDataFile('data.ndjson')).toBe(true);
      expect(isDataFile('data.xlsx')).toBe(true);
      expect(isDataFile('data.ods')).toBe(true);
    });

    it('should return false for unknown files', () => {
      expect(isDataFile('data.txt')).toBe(false);
      expect(isDataFile('data.py')).toBe(false);
    });
  });

  describe('getDataFilePatterns', () => {
    it('should return glob patterns for data files', () => {
      const patterns = getDataFilePatterns();
      expect(patterns).toContain('**/*.parquet');
      expect(patterns).toContain('**/*.csv');
      expect(patterns).toContain('**/*.json');
      expect(patterns).toContain('**/*.ndjson');
      expect(patterns).toContain('**/*.xlsx');
      expect(patterns).toContain('**/*.ods');
    });
  });
});
