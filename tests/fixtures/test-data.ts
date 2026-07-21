import { ColumnInfo, QueryResult, TableSchema } from '../../src/types';

export const sampleColumns: ColumnInfo[] = [
  { name: 'id', type: 'INTEGER', nullable: false, description: 'Unique identifier' },
  { name: 'name', type: 'VARCHAR', nullable: true, description: 'User name' },
  { name: 'email', type: 'VARCHAR', nullable: false, description: 'Email address' },
  { name: 'age', type: 'INTEGER', nullable: true, description: 'User age' },
  { name: 'salary', type: 'DOUBLE', nullable: true, description: 'Annual salary' },
  { name: 'created_at', type: 'TIMESTAMP', nullable: false, description: 'Creation date' },
];

export const sampleSchema: TableSchema = {
  columns: sampleColumns,
  rowCount: 1000,
  filePath: '/path/to/users.parquet',
};

export const sampleQueryResult: QueryResult = {
  columns: ['id', 'name', 'email', 'age', 'salary'],
  rows: [
    [1, 'Alice', 'alice@example.com', 30, 75000],
    [2, 'Bob', 'bob@example.com', 25, 65000],
    [3, null, 'charlie@example.com', 35, 80000],
    [4, 'Diana', 'diana@example.com', null, 90000],
    [5, 'Eve', 'eve@example.com', 28, 70000],
  ],
  rowCount: 5,
  duration: 15,
};

export const sampleParquetData = {
  path: '/data/test.parquet',
  size: 1024 * 1024, // 1MB
  rowCount: 1000,
  columns: sampleColumns,
};

export const sampleCsvData = {
  path: '/data/test.csv',
  size: 512 * 1024, // 512KB
  rowCount: 500,
  columns: sampleColumns.slice(0, 4),
};

export const sampleJsonData = {
  path: '/data/test.json',
  size: 256 * 1024, // 256KB
  rowCount: 200,
  columns: sampleColumns.slice(0, 3),
};
