#!/usr/bin/env python3
"""
QuackWrangler Polars Sidecar Bridge

This script runs as a child process managed by the VS Code extension.
It reads JSON commands from stdin and returns JSON responses to stdout.
Supports efficient data transfer via Arrow IPC (feather) format.

Commands:
  - load_file: Load a file (parquet, csv, json) into memory
  - query: Execute an expression against the current DataFrame
  - transform: Apply a transformation operation
  - export: Export the current DataFrame to a file
  - get_schema: Get column names and types
  - get_stats: Get summary statistics
  - ping: Health check
  - quit: Shutdown the sidecar
"""

import json
import os
import sys
import traceback
from pathlib import Path

try:
    import polars as pl
except ImportError:
    print(
        json.dumps(
            {
                "success": False,
                "error": (
                    f"Polars cannot be imported by {sys.executable}. "
                    "Run `uv sync` in the QuackWrangler repository or configure "
                    "quackwrangler.polars.pythonPath."
                ),
            }
        ),
        flush=True,
    )
    sys.exit(1)

try:
    import pyarrow.feather as feather

    HAS_PYARROW = True
except ImportError:
    HAS_PYARROW = False


# Global state
_current_df: pl.DataFrame | None = None
_source_df: pl.DataFrame | None = None


def load_file(params: dict) -> dict:
    """Load a file into a Polars DataFrame."""
    global _current_df, _source_df
    file_path = params.get("filePath")
    if not file_path:
        return {"success": False, "error": "filePath is required"}

    if not os.path.exists(file_path):
        return {"success": False, "error": f"File not found: {file_path}"}

    try:
        ext = Path(file_path).suffix.lower()
        if ext == ".parquet":
            _current_df = pl.read_parquet(file_path)
        elif ext in (".csv", ".tsv"):
            separator = "\t" if ext == ".tsv" else ","
            _current_df = pl.read_csv(file_path, separator=separator)
        elif ext in (".json", ".jsonl"):
            _current_df = pl.read_ndjson(file_path) if ext == ".jsonl" else pl.read_json(file_path)
        elif ext in (".xlsx", ".xls"):
            try:
                _current_df = pl.read_excel(file_path)
            except Exception:
                return {
                    "success": False,
                    "error": "Excel support requires openpyxl: pip install openpyxl",
                }
        else:
            return {"success": False, "error": f"Unsupported file type: {ext}"}

        schema = _current_df.schema
        _source_df = _current_df.clone()
        return {
            "success": True,
            "schema": {name: str(dtype) for name, dtype in schema.items()},
            "rowCount": _current_df.height,
            "columnCount": _current_df.width,
            "filePath": file_path,
        }
    except Exception as e:
        return {"success": False, "error": str(e), "traceback": traceback.format_exc()}


def query(params: dict) -> dict:
    """Execute a SQL or expression query against the current DataFrame."""
    global _current_df
    if _current_df is None:
        return {"success": False, "error": "No data loaded. Call load_file first."}

    sql = params.get("sql", "")
    if not sql:
        return {"success": False, "error": "sql parameter is required"}

    try:
        result_df = _current_df.sql(sql)
        return _serialize_result(result_df)
    except Exception as e:
        return {"success": False, "error": str(e), "traceback": traceback.format_exc()}


def transform(params: dict) -> dict:
    """Apply a transformation to the current DataFrame."""
    global _current_df
    if _current_df is None:
        return {"success": False, "error": "No data loaded. Call load_file first."}

    operation = params.get("operation", "")
    if not operation:
        return {"success": False, "error": "operation parameter is required"}

    return {"success": False, "error": "Free-form transforms are disabled; use apply_pipeline"}


def apply_pipeline(params: dict) -> dict:
    """Replay structured transforms from the immutable source DataFrame."""
    global _current_df, _source_df
    if _source_df is None:
        return {"success": False, "error": "No data loaded"}
    try:
        df = _source_df.clone()
        for step in params.get("steps", []):
            kind = step.get("type", "")
            values = step.get("params", {})
            if kind in ("filterRows", "filter_rows"):
                condition = values.get("condition", "")
                df = df.sql(f"SELECT * FROM self WHERE {condition}", table_name="self")
            elif kind in ("sortRows", "sort_rows"):
                descending = values.get("direction") == "DESC" or values.get("ascending") is False
                df = df.sort(values["column"], descending=descending, nulls_last=True)
            elif kind in ("dropColumn", "drop_column"):
                columns = values.get("columns") or [values.get("column")]
                df = df.drop([column for column in columns if column])
            elif kind in ("renameColumn", "rename_column"):
                renames = values.get("renames") or {values["oldName"]: values["newName"]}
                df = df.rename(renames)
            elif kind in ("castType", "cast_type"):
                type_map = {
                    "VARCHAR": pl.String,
                    "INTEGER": pl.Int32,
                    "BIGINT": pl.Int64,
                    "DOUBLE": pl.Float64,
                    "BOOLEAN": pl.Boolean,
                    "DATE": pl.Date,
                    "TIMESTAMP": pl.Datetime,
                }
                df = df.with_columns(
                    pl.col(values["column"]).cast(type_map[values["targetType"]], strict=False)
                )
            elif kind in ("fillMissing", "fill_nulls"):
                raw = values.get("value")
                value = (
                    float(raw)
                    if isinstance(raw, str) and raw.replace(".", "", 1).lstrip("-").isdigit()
                    else raw
                )
                df = df.with_columns(pl.col(values["column"]).fill_null(value))
            elif kind == "deduplicate":
                columns = values.get("columns")
                df = df.unique(
                    subset=columns if isinstance(columns, list) else None, maintain_order=True
                )
            else:
                return {
                    "success": False,
                    "error": f"Transform {kind} is not supported by Polars execution",
                }
        _current_df = df
        total_rows = df.height
        offset = max(0, int(params.get("offset", 0)))
        limit = max(1, int(params.get("limit", 100)))
        response = _serialize_result(df.slice(offset, limit))
        response["totalRows"] = total_rows
        response["schema"] = [
            {"name": name, "type": str(dtype), "nullable": True}
            for name, dtype in df.schema.items()
        ]
        return response
    except Exception as e:
        return {"success": False, "error": str(e), "traceback": traceback.format_exc()}


def export(params: dict) -> dict:
    """Export the current DataFrame to a file."""
    global _current_df
    if _current_df is None:
        return {"success": False, "error": "No data loaded. Call load_file first."}

    file_path = params.get("filePath", "")
    file_format = params.get("format", "parquet")

    if not file_path:
        return {"success": False, "error": "filePath is required"}

    try:
        os.makedirs(os.path.dirname(file_path) or ".", exist_ok=True)

        if file_format == "parquet":
            _current_df.write_parquet(file_path)
        elif file_format == "csv":
            _current_df.write_csv(file_path)
        elif file_format == "json":
            _current_df.write_ndjson(file_path)
        elif file_format == "feather" or file_format == "ipc":
            if not HAS_PYARROW:
                return {
                    "success": False,
                    "error": "Arrow IPC export requires pyarrow: pip install pyarrow",
                }
            table = pl.from_arrow(_current_df.to_arrow())
            feather.write_feather(table.to_pandas(), file_path)
        else:
            return {"success": False, "error": f"Unsupported format: {file_format}"}

        return {
            "success": True,
            "filePath": file_path,
            "format": file_format,
            "rowCount": _current_df.height,
        }
    except Exception as e:
        return {"success": False, "error": str(e), "traceback": traceback.format_exc()}


def get_schema(params: dict) -> dict:
    """Get the schema of the current DataFrame."""
    global _current_df
    if _current_df is None:
        # Try loading the file specified
        file_path = params.get("filePath")
        if file_path:
            result = load_file({"filePath": file_path})
            if not result["success"]:
                return result
        else:
            return {"success": False, "error": "No data loaded"}

    schema = _current_df.schema
    columns = []
    for name, dtype in schema.items():
        columns.append(
            {
                "name": name,
                "type": str(dtype),
                "nullable": _current_df.get_column(name).null_count() > 0,
            }
        )

    return {
        "success": True,
        "columns": columns,
        "rowCount": _current_df.height,
        "columnCount": _current_df.width,
    }


def get_stats(params: dict) -> dict:
    """Get summary statistics for the current DataFrame."""
    global _current_df
    if _current_df is None:
        return {"success": False, "error": "No data loaded"}

    try:
        stats = {"rowCount": _current_df.height, "columnCount": _current_df.width, "columns": {}}

        for col_name in _current_df.columns:
            col = _current_df.get_column(col_name)
            col_stats = {
                "type": str(_current_df.schema[col_name]),
                "nullCount": col.null_count(),
                "nullPercentage": round(col.null_count() / max(_current_df.height, 1) * 100, 2),
            }

            # Add numeric stats
            if _current_df.schema[col_name].is_numeric():
                try:
                    col_stats["min"] = col.min()
                    col_stats["max"] = col.max()
                    col_stats["mean"] = col.mean()
                    col_stats["median"] = col.median()
                    col_stats["std"] = col.std()
                except Exception:
                    pass

            # Add string stats
            if _current_df.schema[col_name] == pl.Utf8:
                try:
                    col_stats["minLength"] = col.str.len_bytes().min()
                    col_stats["maxLength"] = col.str.len_bytes().max()
                    col_stats["nUnique"] = col.n_unique()
                except Exception:
                    pass

            stats["columns"][col_name] = col_stats

        return {"success": True, "stats": stats}
    except Exception as e:
        return {"success": False, "error": str(e), "traceback": traceback.format_exc()}


def ping(params: dict) -> dict:
    """Health check."""
    return {
        "success": True,
        "polarsVersion": pl.__version__,
        "hasPyArrow": HAS_PYARROW,
        "pid": os.getpid(),
    }


def quit_sidecar(params: dict) -> dict:
    """Shutdown the sidecar process."""
    return {"success": True, "message": "Shutting down"}


# Command registry
COMMANDS = {
    "load_file": load_file,
    "query": query,
    "transform": transform,
    "apply_pipeline": apply_pipeline,
    "export": export,
    "get_schema": get_schema,
    "get_stats": get_stats,
    "ping": ping,
    "quit": quit_sidecar,
}


def _serialize_result(df: pl.DataFrame) -> dict:
    """Serialize a Polars DataFrame to a JSON-compatible dict."""
    try:
        columns = df.columns
        rows = df.rows()

        # Convert complex types to strings for JSON serialization
        serialized_rows = []
        for row in rows:
            serialized_row = []
            for val in row:
                if val is None:
                    serialized_row.append(None)
                elif isinstance(val, (list, dict)):
                    serialized_row.append(json.dumps(val))
                else:
                    serialized_row.append(val)
            serialized_rows.append(serialized_row)

        return {
            "success": True,
            "columns": columns,
            "rows": serialized_rows,
            "rowCount": len(rows),
            "columnCount": len(columns),
            "dtypes": {col: str(df.schema[col]) for col in columns},
        }
    except Exception as e:
        return {"success": False, "error": f"Failed to serialize result: {e}"}


def main():
    """Main loop: read commands from stdin, write responses to stdout."""
    # Send ready signal
    print(json.dumps({"type": "ready", "pid": os.getpid()}), flush=True)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            command = json.loads(line)
        except json.JSONDecodeError as e:
            response = {"success": False, "error": f"Invalid JSON: {e}"}
            print(json.dumps(response), flush=True)
            continue

        cmd_type = command.get("type", "")
        params = command.get("params", {})
        request_id = command.get("id")

        handler = COMMANDS.get(cmd_type)
        if not handler:
            response = {"success": False, "error": f"Unknown command: {cmd_type}"}
        else:
            response = handler(params)

        if request_id:
            response["id"] = request_id

        print(json.dumps(response), flush=True)

        if cmd_type == "quit":
            break


if __name__ == "__main__":
    main()
