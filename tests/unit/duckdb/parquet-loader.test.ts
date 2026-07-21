import { describe, it, expect } from 'vitest';
import { detectFileType, isDataFile, getDataFilePatterns } from '../../../src/utils/fileDetector';

describe('fileDetector', () => {
  describe('detectFileType', () => {
    it('should detect parquet files', () => {
      expect(detectFileType('data.parquet')).toBe('parquet');
      expect(detectFileType('/path/to/data.parquet')).toBe('parquet');
    });

    it('should detect CSV files', () => {
      expect(detectFileType('data.csv')).toBe('csv');
      expect(detectFileType('data.tsv')).toBe('csv');
    });

    it('should detect JSON files', () => {
      expect(detectFileType('data.json')).toBe('json');
      expect(detectFileType('data.jsonl')).toBe('json');
      expect(detectFileType('data.ndjson')).toBe('json');
    });

    it('should return null for unknown files', () => {
      expect(detectFileType('data.txt')).toBeNull();
      expect(detectFileType('data.py')).toBeNull();
    });
  });

  describe('isDataFile', () => {
    it('should return true for data files', () => {
      expect(isDataFile('data.parquet')).toBe(true);
      expect(isDataFile('data.csv')).toBe(true);
      expect(isDataFile('data.json')).toBe(true);
    });

    it('should return false for non-data files', () => {
      expect(isDataFile('readme.md')).toBe(false);
      expect(isDataFile('script.py')).toBe(false);
    });
  });

  describe('getDataFilePatterns', () => {
    it('should return glob patterns for data files', () => {
      const patterns = getDataFilePatterns();
      expect(patterns).toContain('**/*.parquet');
      expect(patterns).toContain('**/*.csv');
      expect(patterns).toContain('**/*.json');
    });
  });
});
