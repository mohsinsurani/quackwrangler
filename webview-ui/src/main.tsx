import React from 'react';
import ReactDOM from 'react-dom/client';

import { App } from './App';
import './styles/theme.css';

declare const acquireVsCodeApi: (() => unknown) | undefined;

const rootElement = document.getElementById('root');
const isDevelopment = (import.meta as ImportMeta & { env: { DEV: boolean } }).env.DEV;

if (isDevelopment && typeof acquireVsCodeApi === 'undefined') {
  (globalThis as typeof globalThis & { acquireVsCodeApi?: () => unknown }).acquireVsCodeApi =
    () => ({
      postMessage: (message: unknown) =>
        window.postMessage({ ...(message as object), __fromWebview: true }, window.location.origin),
    });
}

if (!rootElement) {
  throw new Error('Root element not found');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

if (isDevelopment) {
  const sessionId = 'preview-session';
  const revision = 1;
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
        protocolVersion: 3,
        sessionId,
        revision,
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
  }, 50);

  // Respond to webview messages that the real extension host would handle,
  // so interactive actions don't leave the preview stuck in a loading state.
  window.addEventListener('message', (event: MessageEvent) => {
    if (!event.data || typeof event.data.type !== 'string' || !event.data.__fromWebview) return;
    const { type, requestId } = event.data as { type: string; requestId?: string };
    const replySession = () =>
      window.postMessage(
        {
          type: 'sessionUpdated',
          protocolVersion: 3,
          requestId,
          sessionId,
          revision,
          schema: { columns, rowCount: 12_450, filePath: '/preview/world_cup.csv' },
          result: { rows: rows.slice(0, 100) },
          history: [],
          page: { offset: 0, limit: 100, totalRows: 12_450 },
          canUndo: false,
          canRedo: false,
        },
        '*',
      );
    if (
      [
        'applyTransform',
        'undo',
        'redo',
        'removeTransform',
        'reorderTransforms',
        'refresh',
        'clearCustomQuery',
      ].includes(type)
    ) {
      setTimeout(replySession, 80);
    } else if (type === 'searchRows') {
      setTimeout(
        () =>
          window.postMessage(
            {
              type: 'searchResult',
              schema: { columns, rowCount: 0, filePath: '/preview/world_cup.csv' },
              result: { rows: [] },
              page: { offset: 0, limit: 100, totalRows: 0 },
              query: event.data.query,
              requestId,
              sessionId,
              revision,
            },
            '*',
          ),
        80,
      );
    } else if (type === 'executeCustomQuery') {
      setTimeout(
        () =>
          window.postMessage(
            {
              type: 'customQueryResult',
              schema: { columns, rowCount: 0, filePath: '/preview/world_cup.csv' },
              result: { rows: [] },
              page: { offset: 0, limit: 100, totalRows: 0 },
              requestId,
              sessionId,
              revision,
            },
            '*',
          ),
        80,
      );
    } else if (type === 'exportData') {
      setTimeout(
        () =>
          window.postMessage(
            { type: 'exportComplete', outputPath: '', status: 'cancelled', requestId },
            '*',
          ),
        80,
      );
    } else if (type === 'pageChange') {
      setTimeout(replySession, 80);
    } else if (type === 'getStats') {
      setTimeout(
        () =>
          window.postMessage(
            {
              type: 'stats',
              stats: columns.map((column, index) => ({
                name: column.name,
                type: column.type,
                nullCount: index < 2 ? 0 : index * 17,
                distinctCount: 20 + index * 31,
              })),
              quality: {
                duplicateRows: 0,
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
              requestId,
              sessionId,
              revision,
            },
            '*',
          ),
        80,
      );
    } else if (type === 'requestChart') {
      setTimeout(
        () =>
          window.postMessage(
            {
              type: 'chartResult',
              chart: event.data.chart ?? {
                type: 'correlation',
                xColumn: 'year',
                columns: ['year', 'attendance', 'revenue'],
              },
              result: {
                rows: [
                  ['year', 'year', 1],
                  ['year', 'attendance', 0.78],
                  ['attendance', 'attendance', 1],
                ],
              },
              requestId,
              sessionId,
              revision,
            },
            '*',
          ),
        80,
      );
    } else if (type === 'generateAITransforms') {
      setTimeout(
        () => window.postMessage({ type: 'aiComplete', status: 'cancelled', requestId }, '*'),
        80,
      );
    }
  });
}
