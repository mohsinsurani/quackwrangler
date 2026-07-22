import { TransformOperation } from '../types/index.js';

type TransformFn = (params: Record<string, unknown>) => string;

export class TransformRegistry {
  private transforms: Map<string, TransformFn> = new Map();

  constructor() {
    this.registerBuiltinTransforms();
  }

  registerTransform(name: string, fn: TransformFn): void {
    this.transforms.set(name, fn);
  }

  getTransform(name: string): TransformFn | undefined {
    return this.transforms.get(name);
  }

  listTransforms(): string[] {
    return Array.from(this.transforms.keys());
  }

  applyTransform(operation: TransformOperation): string {
    const fn = this.transforms.get(operation.type);
    if (!fn) {
      throw new Error(`Unknown transform type: ${operation.type}`);
    }
    return fn(operation.params);
  }

  private registerBuiltinTransforms(): void {
    this.registerTransform('dropColumn', (params) => {
      const { columns } = params as { columns: string[] };
      const colList = columns.map(c => `"${c}"`).join(', ');
      return `SELECT * EXCLUDE (${colList}) FROM current_data`;
    });

    this.registerTransform('renameColumn', (params) => {
      const { renames } = params as { renames: Record<string, string> };
      const renameClauses = Object.entries(renames)
        .map(([old, new_]) => `"${old}" AS "${new_}"`)
        .join(', ');
      return `SELECT ${renameClauses} FROM current_data`;
    });

    this.registerTransform('filterRows', (params) => {
      const { condition } = params as { condition: string };
      return `SELECT * FROM current_data WHERE ${condition}`;
    });

    this.registerTransform('sortRows', (params) => {
      const { column, ascending } = params as { column: string; ascending: boolean };
      const direction = ascending ? 'ASC' : 'DESC';
      return `SELECT * FROM current_data ORDER BY "${column}" ${direction}`;
    });

    this.registerTransform('castType', (params) => {
      const { column, targetType } = params as { column: string; targetType: string };
      return `SELECT *, CAST("${column}" AS ${targetType}) AS "${column}_casted" FROM current_data`;
    });

    this.registerTransform('fillMissing', (params) => {
      const { column, value } = params as { column: string; value: string };
      return `SELECT *, COALESCE("${column}", ${value}) AS "${column}_filled" FROM current_data`;
    });

    this.registerTransform('deduplicate', (params) => {
      const { columns } = params as { columns: string[] };
      const colList = columns.map(c => `"${c}"`).join(', ');
      return `SELECT DISTINCT ON (${colList}) * FROM current_data`;
    });

    this.registerTransform('oneHotEncode', (params) => {
      const { column } = params as { column: string };
      return `SELECT *, CASE WHEN "${column}" = '1' THEN 1 ELSE 0 END AS "${column}_encoded" FROM current_data`;
    });

    this.registerTransform('normalize', (params) => {
      const { column } = params as { column: string };
      return `SELECT *, ("${column}" - MIN("${column}") OVER ()) / (MAX("${column}") OVER () - MIN("${column}") OVER ()) AS "${column}_normalized" FROM current_data`;
    });

    this.registerTransform('splitColumn', (params) => {
      const { column, delimiter } = params as { column: string; delimiter: string };
      return `SELECT *, string_split("${column}", '${delimiter}') AS "${column}_parts" FROM current_data`;
    });

    this.registerTransform('mergeColumns', (params) => {
      const { columns, separator, newColumn } = params as { columns: string[]; separator: string; newColumn: string };
      const concatExpr = columns.map(c => `"${c}"`).join(` || '${separator}' || `);
      return `SELECT *, ${concatExpr} AS "${newColumn}" FROM current_data`;
    });
  }
}
