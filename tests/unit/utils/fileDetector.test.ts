import { describe, it, expect } from 'vitest';
import { isDataFile, getDataFilePatterns, formatFileSize } from '../../../src/utils/fileDetector';

describe('fileDetector utils', () => {
  describe('isDataFile', () => {
    it('should identify parquet files', () => {
      expect(isDataFile('data.parquet')).toBe(true);
      expect(isDataFile('DATA.PARQUET')).toBe(true);
    });

    it('should identify CSV files', () => {
      expect(isDataFile('data.csv')).toBe(true);
      expect(isDataFile('data.tsv')).toBe(true);
    });

    it('should identify JSON files', () => {
      expect(isDataFile('data.json')).toBe(true);
      expect(isDataFile('data.jsonl')).toBe(true);
      expect(isDataFile('data.ndjson')).toBe(true);
    });

    it('should identify spreadsheet files supported by DuckDB', () => {
      expect(isDataFile('data.xlsx')).toBe(true);
      expect(isDataFile('data.ods')).toBe(true);
      expect(isDataFile('legacy.xls')).toBe(false);
    });

    it('should reject non-data files', () => {
      expect(isDataFile('readme.md')).toBe(false);
      expect(isDataFile('script.py')).toBe(false);
      expect(isDataFile('image.png')).toBe(false);
    });
  });

  describe('getDataFilePatterns', () => {
    it('should return array of glob patterns', () => {
      const patterns = getDataFilePatterns();
      expect(Array.isArray(patterns)).toBe(true);
      expect(patterns.length).toBeGreaterThan(0);
    });

    it('should include parquet pattern', () => {
      const patterns = getDataFilePatterns();
      expect(patterns.some((p) => p.includes('parquet'))).toBe(true);
      expect(patterns).toContain('**/*.xlsx');
      expect(patterns).toContain('**/*.ods');
    });
  });

  describe('formatFileSize', () => {
    it('should format bytes correctly', () => {
      expect(formatFileSize(0)).toBe('0 B');
      expect(formatFileSize(1024)).toBe('1.00 KB');
      expect(formatFileSize(1024 * 1024)).toBe('1.00 MB');
      expect(formatFileSize(1024 * 1024 * 1024)).toBe('1.00 GB');
    });
  });
});
