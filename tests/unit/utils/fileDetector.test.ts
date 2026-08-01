import { describe, it, expect } from 'vitest';
import {
  DATA_FILE_EXTENSIONS,
  isDataFile,
  getDataFilePatterns,
} from '../../../src/utils/fileDetector';

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

    it('recognizes Arrow IPC and capability-gated ORC files', () => {
      expect(isDataFile('data.arrow')).toBe(true);
      expect(isDataFile('stream.arrows')).toBe(true);
      expect(isDataFile('batch.ipc')).toBe(true);
      expect(isDataFile('warehouse.orc')).toBe(true);
    });

    it('should reject non-data files', () => {
      expect(isDataFile('readme.md')).toBe(false);
      expect(isDataFile('script.py')).toBe(false);
      expect(isDataFile('image.png')).toBe(false);
    });
  });

  describe('getDataFilePatterns', () => {
    it('derives watcher patterns from the supported extension source of truth', () => {
      expect(getDataFilePatterns()).toEqual(
        DATA_FILE_EXTENSIONS.map((extension) => `**/*.${extension}`),
      );
    });
  });
});
