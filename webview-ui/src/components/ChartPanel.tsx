import React, { useEffect, useMemo, useState } from 'react';

interface Column {
  name: string;
  type: string;
}

export interface ChartConfig {
  type: 'histogram' | 'bar' | 'scatter' | 'line' | 'box' | 'correlation';
  xColumn: string;
  yColumn?: string;
  aggregation?: 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX';
  columns?: string[];
}

interface ChartPanelProps {
  columns: Column[];
  config?: ChartConfig;
  rows: unknown[][];
  loading: boolean;
  onRequest: (config: ChartConfig) => void;
}

const WIDTH = 760;
const HEIGHT = 300;
const PAD = 42;
const numericType = /INT|DECIMAL|NUMERIC|DOUBLE|FLOAT|REAL/i;

function numeric(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function compact(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 2 }).format(
    value,
  );
}

function Bars({ rows }: { rows: unknown[][] }) {
  const values = rows.map((row) => numeric(row[rows[0]?.length === 3 ? 2 : 1]) ?? 0);
  const max = Math.max(...values, 1);
  const plotWidth = WIDTH - PAD * 2;
  const plotHeight = HEIGHT - PAD * 2;
  const step = plotWidth / Math.max(rows.length, 1);
  return (
    <>
      <line x1={PAD} y1={HEIGHT - PAD} x2={WIDTH - PAD} y2={HEIGHT - PAD} className="chart-axis" />
      {rows.map((row, index) => {
        const value = values[index];
        const height = (value / max) * plotHeight;
        const label = row.length === 3 ? `${String(row[0])}–${String(row[1])}` : String(row[0]);
        return (
          <g key={`${label}-${index}`}>
            <rect
              className="chart-bar"
              x={PAD + index * step + 2}
              y={HEIGHT - PAD - height}
              width={Math.max(2, step - 4)}
              height={height}
            >
              <title>
                {label}: {value.toLocaleString()}
              </title>
            </rect>
            {rows.length <= 12 && (
              <text
                className="chart-label"
                x={PAD + index * step + step / 2}
                y={HEIGHT - PAD + 15}
                textAnchor="middle"
              >
                {label.length > 10 ? `${label.slice(0, 9)}…` : label}
              </text>
            )}
          </g>
        );
      })}
      <text className="chart-label" x={PAD - 6} y={PAD} textAnchor="end">
        {compact(max)}
      </text>
      <text className="chart-label" x={PAD - 6} y={HEIGHT - PAD} textAnchor="end">
        0
      </text>
    </>
  );
}

function Points({ rows, line }: { rows: unknown[][]; line: boolean }) {
  const points = rows
    .map((row, index) => ({
      x: numeric(row[0]) ?? index,
      y: numeric(row[1]),
      label: String(row[0]),
    }))
    .filter((point): point is { x: number; y: number; label: string } => point.y !== undefined);
  if (points.length === 0)
    return (
      <text x={WIDTH / 2} y={HEIGHT / 2} textAnchor="middle" className="chart-empty">
        No numeric values
      </text>
    );
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const scaleX = (value: number) => PAD + ((value - minX) / (maxX - minX || 1)) * (WIDTH - PAD * 2);
  const scaleY = (value: number) =>
    HEIGHT - PAD - ((value - minY) / (maxY - minY || 1)) * (HEIGHT - PAD * 2);
  const path = points
    .map((point, index) => `${index ? 'L' : 'M'} ${scaleX(point.x)} ${scaleY(point.y)}`)
    .join(' ');
  return (
    <>
      <line x1={PAD} y1={HEIGHT - PAD} x2={WIDTH - PAD} y2={HEIGHT - PAD} className="chart-axis" />
      <line x1={PAD} y1={PAD} x2={PAD} y2={HEIGHT - PAD} className="chart-axis" />
      {line && <path d={path} className="chart-line" />}
      {points.map((point, index) => (
        <circle
          key={index}
          cx={scaleX(point.x)}
          cy={scaleY(point.y)}
          r={line ? 3 : 4}
          className="chart-point"
        >
          <title>
            {point.label}: {point.y}
          </title>
        </circle>
      ))}
      <text className="chart-label" x={PAD - 6} y={PAD} textAnchor="end">
        {compact(maxY)}
      </text>
      <text className="chart-label" x={PAD - 6} y={HEIGHT - PAD} textAnchor="end">
        {compact(minY)}
      </text>
    </>
  );
}

function BoxPlot({ rows }: { rows: unknown[][] }) {
  const values = (rows[0] ?? []).map((value) => numeric(value) ?? 0);
  if (values.length < 5)
    return (
      <text x={WIDTH / 2} y={HEIGHT / 2} className="chart-empty">
        No numeric values
      </text>
    );
  const [min, q1, median, q3, max] = values;
  const scale = (value: number) => PAD + ((value - min) / (max - min || 1)) * (WIDTH - PAD * 2);
  return (
    <>
      <line
        x1={scale(min)}
        y1={HEIGHT / 2}
        x2={scale(max)}
        y2={HEIGHT / 2}
        className="chart-axis"
      />
      <rect
        x={scale(q1)}
        y={HEIGHT / 2 - 42}
        width={Math.max(2, scale(q3) - scale(q1))}
        height={84}
        className="chart-box"
      />
      <line
        x1={scale(median)}
        y1={HEIGHT / 2 - 42}
        x2={scale(median)}
        y2={HEIGHT / 2 + 42}
        className="chart-median"
      />
      {[min, max].map((value) => (
        <line
          key={value}
          x1={scale(value)}
          y1={HEIGHT / 2 - 20}
          x2={scale(value)}
          y2={HEIGHT / 2 + 20}
          className="chart-axis"
        />
      ))}
      {[min, q1, median, q3, max].map((value) => (
        <text
          key={value}
          x={scale(value)}
          y={HEIGHT / 2 + 66}
          textAnchor="middle"
          className="chart-label"
        >
          {compact(value)}
        </text>
      ))}
    </>
  );
}

function Correlation({ rows }: { rows: unknown[][] }) {
  const names = [...new Set(rows.flatMap((row) => [String(row[0]), String(row[1])]))];
  const size = Math.min(52, (WIDTH - PAD * 2) / Math.max(names.length, 1));
  const cells = new Map<string, number>();
  rows.forEach((row) => {
    const value = numeric(row[2]) ?? 0;
    cells.set(`${row[0]}\0${row[1]}`, value);
    cells.set(`${row[1]}\0${row[0]}`, value);
  });
  return (
    <>
      {names.flatMap((left, y) =>
        names.map((right, x) => {
          const value = cells.get(`${left}\0${right}`) ?? 0;
          const opacity = 0.15 + Math.abs(value) * 0.85;
          return (
            <g key={`${left}-${right}`}>
              <rect
                x={PAD + x * size}
                y={PAD + y * size}
                width={size - 2}
                height={size - 2}
                fill={value < 0 ? `rgb(241 76 76 / ${opacity})` : `rgb(55 148 255 / ${opacity})`}
              >
                <title>
                  {left} × {right}: {value.toFixed(3)}
                </title>
              </rect>
              {size > 34 && (
                <text
                  x={PAD + x * size + size / 2}
                  y={PAD + y * size + size / 2 + 4}
                  textAnchor="middle"
                  className="chart-cell-label"
                >
                  {value.toFixed(2)}
                </text>
              )}
            </g>
          );
        }),
      )}
    </>
  );
}

export const ChartPanel: React.FC<ChartPanelProps> = ({
  columns,
  config,
  rows,
  loading,
  onRequest,
}) => {
  const numericColumns = useMemo(
    () => columns.filter((column) => numericType.test(column.type)),
    [columns],
  );
  const [type, setType] = useState<ChartConfig['type']>('histogram');
  const [xColumn, setXColumn] = useState('');
  const [yColumn, setYColumn] = useState('');
  const [aggregation, setAggregation] = useState<NonNullable<ChartConfig['aggregation']>>('COUNT');
  const [open, setOpen] = useState(false);
  const xOptions = type === 'bar' ? columns : numericColumns;
  const requiresY =
    type === 'scatter' || type === 'line' || (type === 'bar' && aggregation !== 'COUNT');

  useEffect(() => {
    if (!config) return;
    setType(config.type);
    setXColumn(config.xColumn);
    setYColumn(config.yColumn ?? '');
    setAggregation(config.aggregation ?? 'COUNT');
    setOpen(true);
  }, [config]);

  const createChart = () => {
    const x = xColumn || xOptions[0]?.name;
    const y = yColumn || numericColumns.find((column) => column.name !== x)?.name;
    if (type === 'correlation') {
      if (numericColumns.length < 2) return;
      onRequest({
        type,
        xColumn: numericColumns[0].name,
        columns: numericColumns.slice(0, 12).map((column) => column.name),
      });
      return;
    }
    if (!x || (requiresY && !y)) return;
    onRequest({ type, xColumn: x, yColumn: requiresY ? y : undefined, aggregation });
  };

  return (
    <section className={`chart-panel ${open ? 'open' : ''}`}>
      <button
        className="analysis-toggle"
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={`${open ? 'Collapse' : 'Expand'} visualize`}
      >
        <span className="analysis-toggle-title">
          <span className="analysis-icon">⌁</span>Visualize
        </span>
        <span className="analysis-toggle-meta">
          <small>DuckDB charts</small>
          <span className="analysis-chevron">›</span>
        </span>
      </button>
      {open && (
        <>
          <div className="chart-controls">
            <label>
              Chart
              <select
                value={type}
                onChange={(event) => {
                  setType(event.target.value as ChartConfig['type']);
                  setXColumn('');
                }}
              >
                <option value="histogram">Histogram</option>
                <option value="bar">Bar</option>
                <option value="scatter">Scatter</option>
                <option value="line">Line</option>
                <option value="box">Box plot</option>
                <option value="correlation">Correlation heatmap</option>
              </select>
            </label>
            {type !== 'correlation' && (
              <label>
                {type === 'bar' ? 'Category' : 'X column'}
                <select value={xColumn} onChange={(event) => setXColumn(event.target.value)}>
                  <option value="">Select column</option>
                  {xOptions.map((column) => (
                    <option key={column.name} value={column.name}>
                      {column.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {type === 'bar' && (
              <label>
                Measure
                <select
                  value={aggregation}
                  onChange={(event) => setAggregation(event.target.value as typeof aggregation)}
                >
                  {['COUNT', 'SUM', 'AVG', 'MIN', 'MAX'].map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </label>
            )}
            {requiresY && (
              <label>
                Y / value column
                <select value={yColumn} onChange={(event) => setYColumn(event.target.value)}>
                  <option value="">Select column</option>
                  {numericColumns.map((column) => (
                    <option key={column.name} value={column.name}>
                      {column.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button
              type="button"
              className="primary-button"
              onClick={createChart}
              disabled={loading || xOptions.length === 0}
            >
              Create chart
            </button>
          </div>
          <div className="chart-canvas">
            {loading ? (
              <div className="chart-empty">Building chart…</div>
            ) : config && rows.length > 0 ? (
              <>
                <header>
                  <strong>{config.type[0].toUpperCase() + config.type.slice(1)}</strong>
                  <span>
                    {config.xColumn}
                    {config.yColumn ? ` × ${config.yColumn}` : ''}
                  </span>
                </header>
                <svg
                  viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
                  role="img"
                  aria-label={`${config.type} chart for ${config.xColumn}`}
                >
                  {config.type === 'bar' || config.type === 'histogram' ? (
                    <Bars rows={rows} />
                  ) : config.type === 'box' ? (
                    <BoxPlot rows={rows} />
                  ) : config.type === 'correlation' ? (
                    <Correlation rows={rows} />
                  ) : (
                    <Points rows={rows} line={config.type === 'line'} />
                  )}
                </svg>
              </>
            ) : (
              <div className="chart-empty">
                Choose columns to create a chart from the complete transformed dataset.
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
};
