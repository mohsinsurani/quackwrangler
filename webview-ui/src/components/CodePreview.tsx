import React, { useCallback, useState, useMemo } from 'react';
import type { TransformStep, ColumnInfo } from '../types';

interface CodePreviewProps {
  transformSteps: TransformStep[];
  columns: ColumnInfo[];
  tableName: string;
  generatedCode?: { sql: string; duckdbPython: string; polarsPython: string };
}

type Language = 'sql' | 'python';

function stringList(value: unknown, fallback?: unknown): string[] {
  const source = value ?? fallback;
  if (Array.isArray(source)) return source.filter((item): item is string => typeof item === 'string');
  return typeof source === 'string' && source ? [source] : [];
}

interface HighlightToken {
  text: string;
  type: 'keyword' | 'function' | 'string' | 'number' | 'comment' | 'operator' | 'plain';
}

const SQL_KEYWORDS = new Set([
  'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'BETWEEN', 'LIKE',
  'IS', 'NULL', 'AS', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'ON',
  'GROUP', 'BY', 'ORDER', 'ASC', 'DESC', 'LIMIT', 'OFFSET', 'INSERT',
  'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE', 'CREATE', 'TABLE', 'DROP',
  'ALTER', 'INDEX', 'VIEW', 'UNION', 'ALL', 'DISTINCT', 'HAVING',
  'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'EXISTS', 'COUNT', 'SUM',
  'AVG', 'MIN', 'MAX', 'CAST', 'WITH', 'RECURSIVE', 'OVER', 'PARTITION',
  'ROW_NUMBER', 'RANK', 'DENSE_RANK', 'LAG', 'LEAD', 'FIRST_VALUE',
  'LAST_VALUE', 'NTILE', 'CUME_DIST', 'PERCENT_RANK', 'COALESCE',
  'NULLIF', 'IF', 'IFNULL', 'GREATEST', 'LEAST', 'ROUND', 'FLOOR',
  'CEIL', 'ABS', 'POWER', 'SQRT', 'LOG', 'EXP', 'MOD', 'TRUNC',
  'SUBSTRING', 'TRIM', 'UPPER', 'LOWER', 'LENGTH', 'REPLACE', 'CONCAT',
  'SPLIT', 'REGEXP_REPLACE', 'REGEXP_MATCH', 'REGEXP_COUNT',
  'PARQUET', 'CSV', 'JSON', 'ARROW', 'IMPORT', 'EXPORT', 'COPY',
  'TO', 'FORMAT', 'HEADER', 'DELIMITER', 'ENCODING', 'TRUE', 'FALSE',
]);

const PY_KEYWORDS = new Set([
  'import', 'from', 'as', 'def', 'class', 'return', 'if', 'elif', 'else',
  'for', 'while', 'in', 'not', 'and', 'or', 'is', 'None', 'True', 'False',
  'with', 'try', 'except', 'finally', 'raise', 'pass', 'break', 'continue',
  'lambda', 'yield', 'global', 'nonlocal', 'assert', 'del', 'print',
  'self', 'cls', 'async', 'await',
]);

function highlightSQL(code: string): HighlightToken[] {
  const tokens: HighlightToken[] = [];
  const lines = code.split('\n');

  for (const line of lines) {
    if (line.trimStart().startsWith('--')) {
      tokens.push({ text: line, type: 'comment' });
      tokens.push({ text: '\n', type: 'plain' });
      continue;
    }

    let i = 0;
    while (i < line.length) {
      if (line[i] === "'") {
        let j = i + 1;
        while (j < line.length && line[j] !== "'") j++;
        j = Math.min(j + 1, line.length);
        tokens.push({ text: line.slice(i, j), type: 'string' });
        i = j;
      } else if (line[i] === '"') {
        let j = i + 1;
        while (j < line.length && line[j] !== '"') j++;
        j = Math.min(j + 1, line.length);
        tokens.push({ text: line.slice(i, j), type: 'string' });
        i = j;
      } else if (/[0-9]/.test(line[i]) && (i === 0 || /[\s(,=+\-*/<>]/.test(line[i - 1]))) {
        let j = i;
        while (j < line.length && /[0-9.]/.test(line[j])) j++;
        tokens.push({ text: line.slice(i, j), type: 'number' });
        i = j;
      } else if (/[a-zA-Z_]/.test(line[i])) {
        let j = i;
        while (j < line.length && /[a-zA-Z0-9_]/.test(line[j])) j++;
        const word = line.slice(i, j);
        if (SQL_KEYWORDS.has(word.toUpperCase())) {
          tokens.push({ text: word, type: 'keyword' });
        } else if (j < line.length && line[j] === '(') {
          tokens.push({ text: word, type: 'function' });
        } else {
          tokens.push({ text: word, type: 'plain' });
        }
        i = j;
      } else if (/[+\-*/=<>!]/.test(line[i])) {
        let j = i;
        while (j < line.length && /[+\-*/=<>!]/.test(line[j])) j++;
        tokens.push({ text: line.slice(i, j), type: 'operator' });
        i = j;
      } else {
        let j = i + 1;
        while (j < line.length && !/[a-zA-Z_0-9'"+\-*/=<>!]/.test(line[j])) j++;
        tokens.push({ text: line.slice(i, j), type: 'plain' });
        i = j;
      }
    }
    tokens.push({ text: '\n', type: 'plain' });
  }

  return tokens;
}

function highlightPython(code: string): HighlightToken[] {
  const tokens: HighlightToken[] = [];
  const lines = code.split('\n');

  for (const line of lines) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith('#')) {
      tokens.push({ text: line, type: 'comment' });
      tokens.push({ text: '\n', type: 'plain' });
      continue;
    }

    let i = 0;
    while (i < line.length) {
      if (line[i] === '#') {
        tokens.push({ text: line.slice(i), type: 'comment' });
        i = line.length;
      } else if (line[i] === '"' && line.slice(i, i + 3) === '"""') {
        let j = i + 3;
        const endIdx = line.indexOf('"""', j);
        if (endIdx !== -1) {
          j = endIdx + 3;
        } else {
          j = line.length;
        }
        tokens.push({ text: line.slice(i, j), type: 'string' });
        i = j;
      } else if (line[i] === "'" && line.slice(i, i + 3) === "'''") {
        let j = i + 3;
        const endIdx = line.indexOf("'''", j);
        if (endIdx !== -1) {
          j = endIdx + 3;
        } else {
          j = line.length;
        }
        tokens.push({ text: line.slice(i, j), type: 'string' });
        i = j;
      } else if (line[i] === '"') {
        let j = i + 1;
        while (j < line.length && line[j] !== '"') j++;
        j = Math.min(j + 1, line.length);
        tokens.push({ text: line.slice(i, j), type: 'string' });
        i = j;
      } else if (line[i] === "'") {
        let j = i + 1;
        while (j < line.length && line[j] !== "'") j++;
        j = Math.min(j + 1, line.length);
        tokens.push({ text: line.slice(i, j), type: 'string' });
        i = j;
      } else if (/[0-9]/.test(line[i]) && (i === 0 || /[\s(,=+\-*/<>]/.test(line[i - 1]))) {
        let j = i;
        while (j < line.length && /[0-9.eE]/.test(line[j])) j++;
        tokens.push({ text: line.slice(i, j), type: 'number' });
        i = j;
      } else if (/[a-zA-Z_]/.test(line[i])) {
        let j = i;
        while (j < line.length && /[a-zA-Z0-9_]/.test(line[j])) j++;
        const word = line.slice(i, j);
        if (PY_KEYWORDS.has(word)) {
          tokens.push({ text: word, type: 'keyword' });
        } else if (j < line.length && line[j] === '(') {
          tokens.push({ text: word, type: 'function' });
        } else {
          tokens.push({ text: word, type: 'plain' });
        }
        i = j;
      } else if (line[i] === '@') {
        let j = i + 1;
        while (j < line.length && /[a-zA-Z0-9_.]/.test(line[j])) j++;
        tokens.push({ text: line.slice(i, j), type: 'function' });
        i = j;
      } else {
        tokens.push({ text: line[i], type: 'plain' });
        i++;
      }
    }
    tokens.push({ text: '\n', type: 'plain' });
  }

  return tokens;
}

function generateDuckDBSQL(_columns: ColumnInfo[], steps: TransformStep[], tableName: string): string {
  if (steps.length === 0) {
    return `SELECT *\nFROM ${tableName}\nLIMIT 1000;`;
  }

  let sql = '';
  let currentTable = tableName;

  for (const step of steps) {
    switch (step.name) {
      case 'rename_column': {
        const oldName = step.params.oldName as string;
        const newName = step.params.newName as string;
        if (oldName && newName) {
          sql += `-- Rename column: ${oldName} -> ${newName}\n`;
          sql += `CREATE OR REPLACE VIEW ${currentTable}_renamed AS\n`;
          sql += `SELECT *, "${oldName}" AS "${newName}" FROM ${currentTable};\n\n`;
          currentTable = `${currentTable}_renamed`;
        }
        break;
      }
      case 'drop_column': {
        const col = step.params.column as string;
        if (col) {
          sql += `-- Drop column: ${col}\n`;
          sql += `CREATE OR REPLACE VIEW ${currentTable}_dropped AS\n`;
          sql += `SELECT * EXCLUDE("${col}") FROM ${currentTable};\n\n`;
          currentTable = `${currentTable}_dropped`;
        }
        break;
      }
      case 'add_column': {
        const newName = step.params.name as string;
        const expression = step.params.expression as string;
        if (newName && expression) {
          sql += `-- Add column: ${newName}\n`;
          sql += `CREATE OR REPLACE VIEW ${currentTable}_added AS\n`;
          sql += `SELECT *, (${expression}) AS "${newName}" FROM ${currentTable};\n\n`;
          currentTable = `${currentTable}_added`;
        }
        break;
      }
      case 'filter_rows': {
        const condition = step.params.condition as string;
        if (condition) {
          sql += `-- Filter rows\n`;
          sql += `CREATE OR REPLACE VIEW ${currentTable}_filtered AS\n`;
          sql += `SELECT * FROM ${currentTable}\nWHERE ${condition};\n\n`;
          currentTable = `${currentTable}_filtered`;
        }
        break;
      }
      case 'sort_rows': {
        const col = step.params.column as string;
        const direction = (step.params.direction as string) || 'ASC';
        if (col) {
          sql += `-- Sort by: ${col} ${direction}\n`;
          sql += `CREATE OR REPLACE VIEW ${currentTable}_sorted AS\n`;
          sql += `SELECT * FROM ${currentTable}\nORDER BY "${col}" ${direction};\n\n`;
          currentTable = `${currentTable}_sorted`;
        }
        break;
      }
      case 'fill_nulls': {
        const col = step.params.column as string;
        const value = step.params.value as string;
        if (col && value) {
          sql += `-- Fill nulls in: ${col}\n`;
          sql += `CREATE OR REPLACE VIEW ${currentTable}_filled AS\n`;
          sql += `SELECT *, COALESCE("${col}", ${value}) AS "${col}" FROM ${currentTable};\n\n`;
          currentTable = `${currentTable}_filled`;
        }
        break;
      }
      case 'cast_type': {
        const col = step.params.column as string;
        const newType = step.params.targetType as string;
        if (col && newType) {
          sql += `-- Cast column: ${col} to ${newType}\n`;
          sql += `CREATE OR REPLACE VIEW ${currentTable}_cast AS\n`;
          sql += `SELECT *, CAST("${col}" AS ${newType}) AS "${col}" FROM ${currentTable};\n\n`;
          currentTable = `${currentTable}_cast`;
        }
        break;
      }
      case 'deduplicate': {
        const cols = stringList(step.params.columns, step.params.column);
        if (cols.length > 0) {
          const distinctCols = cols.map((c) => `"${c}"`).join(', ');
          sql += `-- Deduplicate on: ${cols.join(', ')}\n`;
          sql += `CREATE OR REPLACE VIEW ${currentTable}_dedup AS\n`;
          sql += `SELECT DISTINCT ON (${distinctCols}) * FROM ${currentTable};\n\n`;
          currentTable = `${currentTable}_dedup`;
        }
        break;
      }
      case 'aggregate': {
        const groupBy = stringList(step.params.groupBy);
        const aggFuncs = stringList(step.params.aggregations);
        if (groupBy.length > 0 || aggFuncs.length > 0) {
          const groupCols = groupBy.map((c) => `"${c}"`).join(', ');
          const aggCols = aggFuncs.map((f) => f).join(',\n  ');
          sql += `-- Aggregate\n`;
          sql += `CREATE OR REPLACE VIEW ${currentTable}_agg AS\n`;
          sql += `SELECT\n  ${groupCols}${groupBy.length > 0 && aggFuncs.length > 0 ? ',\n  ' : ''}${aggCols}\nFROM ${currentTable}\n`;
          if (groupBy.length > 0) {
            sql += `GROUP BY ${groupCols}`;
          }
          sql += ';\n\n';
          currentTable = `${currentTable}_agg`;
        }
        break;
      }
      default:
        sql += `-- ${step.name}: ${JSON.stringify(step.params)}\n\n`;
    }
  }

  sql += `SELECT *\nFROM ${currentTable}\nLIMIT 1000;`;
  return sql;
}

function generatePolarsPython(_columns: ColumnInfo[], steps: TransformStep[], tableName: string): string {
  let code = `import polars as pl\n\n`;
  code += `# Load data\n`;
  code += `df = pl.read_parquet("${tableName}.parquet")\n\n`;

  for (const step of steps) {
    switch (step.name) {
      case 'rename_column': {
        const oldName = step.params.oldName as string;
        const newName = step.params.newName as string;
        if (oldName && newName) {
          code += `# Rename column: ${oldName} -> ${newName}\n`;
          code += `df = df.rename({\"${oldName}\": \"${newName}\"})\n\n`;
        }
        break;
      }
      case 'drop_column': {
        const col = step.params.column as string;
        if (col) {
          code += `# Drop column: ${col}\n`;
          code += `df = df.drop(\"${col}\")\n\n`;
        }
        break;
      }
      case 'add_column': {
        const newName = step.params.name as string;
        const expression = step.params.expression as string;
        if (newName && expression) {
          code += `# Add column: ${newName}\n`;
          code += `df = df.with_columns(pl.lit(${expression}).alias(\"${newName}\"))\n\n`;
        }
        break;
      }
      case 'filter_rows': {
        const condition = step.params.condition as string;
        if (condition) {
          code += `# Filter rows\n`;
          code += `df = df.filter(pl.col(\"${condition}\"))\n\n`;
        }
        break;
      }
      case 'sort_rows': {
        const col = step.params.column as string;
        const direction = (step.params.direction as string) || 'asc';
        if (col) {
          code += `# Sort by: ${col} ${direction}\n`;
          code += `df = df.sort(\"${col}\", descending=${direction === 'desc' ? 'True' : 'False'})\n\n`;
        }
        break;
      }
      case 'fill_nulls': {
        const col = step.params.column as string;
        const value = step.params.value as string;
        if (col && value) {
          code += `# Fill nulls in: ${col}\n`;
          code += `df = df.with_columns(pl.col(\"${col}\").fill_null(${value}))\n\n`;
        }
        break;
      }
      case 'cast_type': {
        const col = step.params.column as string;
        const newType = step.params.targetType as string;
        if (col && newType) {
          code += `# Cast column: ${col} to ${newType}\n`;
          code += `df = df.with_columns(pl.col(\"${col}\").cast(pl.${newType}))\n\n`;
        }
        break;
      }
      case 'deduplicate': {
        const cols = stringList(step.params.columns, step.params.column);
        if (cols.length > 0) {
          code += `# Deduplicate on: ${cols.join(', ')}\n`;
          code += `df = df.unique(subset=[${cols.map((c) => `"${c}"`).join(', ')}])\n\n`;
        }
        break;
      }
      case 'aggregate': {
        const groupBy = stringList(step.params.groupBy);
        const aggFuncs = stringList(step.params.aggregations);
        if (groupBy.length > 0 || aggFuncs.length > 0) {
          code += `# Aggregate\n`;
          code += `df = df.group_by([${groupBy.map((c) => `"${c}"`).join(', ')}]).agg([\n`;
          aggFuncs.forEach((f) => {
            code += `    ${f},\n`;
          });
          code += `])\n\n`;
        }
        break;
      }
      default:
        code += `# ${step.name}: ${JSON.stringify(step.params)}\n\n`;
    }
  }

  code += `# Preview result\n`;
  code += `print(df.head(1000))\n`;
  return code;
}

export const CodePreview: React.FC<CodePreviewProps> = React.memo(
  ({ transformSteps, columns, tableName, generatedCode }) => {
    const [copied, setCopied] = useState(false);
    const [language, setLanguage] = useState<Language>('sql');

    const code = useMemo(() => {
      if (generatedCode) {
        return language === 'sql' ? generatedCode.sql : generatedCode.polarsPython;
      }
      if (language === 'sql') {
        return generateDuckDBSQL(columns, transformSteps, tableName);
      }
      return generatePolarsPython(columns, transformSteps, tableName);
    }, [language, columns, transformSteps, tableName, generatedCode]);

    const highlightedTokens = useMemo(() => {
      return language === 'sql' ? highlightSQL(code) : highlightPython(code);
    }, [code, language]);

    const handleCopy = useCallback(async () => {
      try {
        await navigator.clipboard.writeText(code);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (err) {
        console.error('Copy failed:', err);
      }
    }, [code]);

    return (
      <div className="code-preview-panel">
        <div className="code-preview-header">
          <div className="code-tabs">
            <button
              className={`code-tab ${language === 'sql' ? 'active' : ''}`}
              onClick={() => setLanguage('sql')}
            >
              SQL (DuckDB)
            </button>
            <button
              className={`code-tab ${language === 'python' ? 'active' : ''}`}
              onClick={() => setLanguage('python')}
            >
              Python export (Polars)
            </button>
          </div>
          <button
            className={`copy-btn ${copied ? 'copied' : ''}`}
            onClick={handleCopy}
            title={copied ? 'Copied!' : 'Copy to clipboard'}
          >
            {copied ? (
              <>
                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z"/>
                </svg>
                <span>Copied!</span>
              </>
            ) : (
              <>
                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 010 1.5h-1.5a.25.25 0 00-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 00.25-.25v-1.5a.75.75 0 011.5 0v1.5A1.75 1.75 0 019.25 16h-7.5A1.75 1.75 0 010 14.25v-7.5z"/>
                  <path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0114.25 11h-7.5A1.75 1.75 0 015 9.25v-7.5zm1.75-.25a.25.25 0 00-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 00.25-.25v-7.5a.25.25 0 00-.25-.25h-7.5z"/>
                </svg>
                <span>Copy</span>
              </>
            )}
          </button>
        </div>
        <div className="code-preview-content">
          <pre className="code-block">
            <code>
              {highlightedTokens.map((token, idx) => (
                <span key={idx} className={`token-${token.type}`}>
                  {token.text}
                </span>
              ))}
            </code>
          </pre>
        </div>
      </div>
    );
  }
);

CodePreview.displayName = 'CodePreview';
