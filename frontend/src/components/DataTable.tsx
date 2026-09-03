import { ReactNode } from "react";

export interface Column<T> {
  header: string;
  render: (row: T) => ReactNode;
  width?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  loading: boolean;
  error: string | null;
  emptyMessage?: string;
  onRowClick?: (row: T) => void;
  onRetry?: () => void;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading,
  error,
  emptyMessage = "No records found.",
  onRowClick,
  onRetry,
}: DataTableProps<T>) {
  if (loading) {
    return <div className="loading-state">Loading…</div>;
  }
  if (error) {
    return (
      <div className="error-state">
        {error}
        {onRetry && (
          <div style={{ marginTop: 10 }}>
            <button className="btn" onClick={onRetry}>
              Retry
            </button>
          </div>
        )}
      </div>
    );
  }
  if (rows.length === 0) {
    return <div className="empty-state">{emptyMessage}</div>;
  }

  return (
    <table className="data-table">
      <thead>
        <tr>
          {columns.map((col) => (
            <th key={col.header} style={{ width: col.width }}>
              {col.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={rowKey(row)} onClick={() => onRowClick?.(row)}>
            {columns.map((col) => (
              <td key={col.header}>{col.render(row)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
