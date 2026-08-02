import React from 'react';
import ReactDOM from 'react-dom/client';

import { App } from './App';
import './styles/theme.css';

declare const acquireVsCodeApi: (() => unknown) | undefined;

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element not found');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

const isDevelopment = (import.meta as ImportMeta & { env: { DEV: boolean } }).env.DEV;

if (isDevelopment && typeof acquireVsCodeApi === 'undefined') {
  const columns = [
    { name: 'country', type: 'VARCHAR', nullable: false },
    { name: 'year', type: 'INTEGER', nullable: false },
    { name: 'attendance', type: 'BIGINT', nullable: true },
    { name: 'revenue', type: 'DOUBLE', nullable: true },
    { name: 'stadium', type: 'VARCHAR', nullable: true },
    { name: 'metadata', type: 'STRUCT', nullable: true },
  ];
  const rows = Array.from({ length: 100 }, (_, index) => [
    ['Brazil', 'Germany', 'Argentina', 'France'][index % 4],
    1930 + index,
    index % 9 === 0 ? null : 20_000 + index * 1_250,
    1.2 + index * 0.36,
    `Stadium ${index + 1}`,
    { source: 'preview', verified: index % 3 === 0, tags: ['world-cup', `row-${index + 1}`] },
  ]);

  window.setTimeout(() => {
    window.postMessage(
      {
        type: 'sessionUpdated',
        protocolVersion: 2,
        schema: { columns, rowCount: 12_450, filePath: '/preview/world_cup.csv' },
        result: { rows },
        history: [
          {
            id: 'preview-filter',
            type: 'filter_rows',
            params: { column: 'attendance', operator: 'is_not_null' },
            description: 'Keep rows where attendance is not null',
          },
          {
            id: 'preview-formula',
            type: 'formula_column',
            params: {
              name: 'revenue_band',
              formula: 'if',
              column: 'revenue',
              operator: 'greater_than',
              value: 10,
              thenValue: 'High',
              elseValue: 'Standard',
            },
            description: 'Create revenue_band from a conditional formula',
          },
        ],
        page: { offset: 0, limit: 100, totalRows: 12_450 },
      },
      '*',
    );
    window.postMessage(
      {
        type: 'stats',
        stats: columns.map((column, index) => ({
          name: column.name,
          type: column.type,
          nullCount: index < 2 ? 0 : index * 17,
          distinctCount: 20 + index * 31,
          min: /INT|DOUBLE/.test(column.type) ? index : 'Argentina',
          max: /INT|DOUBLE/.test(column.type) ? 125_000 + index : 'Stadium 99',
          mean: /INT|DOUBLE/.test(column.type) ? 42_000 + index : undefined,
          p50: /INT|DOUBLE/.test(column.type) ? 35_000 : undefined,
          p90: /INT|DOUBLE/.test(column.type) ? 91_000 : undefined,
          p99: /INT|DOUBLE/.test(column.type) ? 119_000 : undefined,
        })),
        quality: {
          issues: [
            {
              severity: 'warning',
              kind: 'nulls',
              message: 'attendance contains 34 null values',
              column: 'attendance',
              count: 34,
            },
            {
              severity: 'info',
              kind: 'outliers',
              message: 'revenue contains 12 potential outliers',
              column: 'revenue',
              count: 12,
            },
          ],
        },
      },
      '*',
    );
    window.postMessage(
      {
        type: 'chartResult',
        chart: {
          type: 'correlation',
          xColumn: 'year',
          columns: ['year', 'attendance', 'revenue'],
        },
        result: {
          rows: [
            ['year', 'year', 1],
            ['year', 'attendance', 0.78],
            ['year', 'revenue', 0.64],
            ['attendance', 'attendance', 1],
            ['attendance', 'revenue', 0.87],
            ['revenue', 'revenue', 1],
          ],
        },
      },
      '*',
    );
  }, 50);
}
