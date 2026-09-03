import { useEffect, useState } from "react";
import { pb } from "../../lib/pocketbase";
import { DataTable, Column } from "../../components/DataTable";
import type { AuditLog } from "../../types/models";

export function AuditLogsPage() {
  const [actionFilter, setActionFilter] = useState("");
  const [rows, setRows] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const filter = actionFilter.trim() ? `action ~ "${actionFilter.trim()}"` : "";
      const result = await pb.collection("audit_logs").getList<AuditLog>(1, 100, {
        filter,
        sort: "-occurred_at",
        expand: "actor_employee,affected_customer",
      });
      setRows(result.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load audit logs. You may not have the audit.view permission.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timeout = setTimeout(load, 250);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionFilter]);

  const columns: Column<AuditLog>[] = [
    { header: "When", render: (l) => new Date(l.occurred_at).toLocaleString(), width: "170px" },
    { header: "Actor", render: (l) => l.expand?.actor_employee?.full_name ?? "—" },
    { header: "Action", render: (l) => l.action },
    { header: "Affected customer", render: (l) => l.expand?.affected_customer?.name ?? "—" },
    { header: "Reason", render: (l) => l.reason || "—" },
  ];

  return (
    <div>
      <div className="page-header">
        <h1>Audit Logs</h1>
        <span className="page-header__meta">{rows.length} shown</span>
      </div>
      <div style={{ marginBottom: 14 }}>
        <input
          className="search-input"
          style={{ width: 300 }}
          placeholder="Filter by action (e.g. billing.refund)"
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
        />
      </div>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(l) => l.id}
        loading={loading}
        error={error}
        emptyMessage="No audit records match this filter."
        onRetry={load}
      />
    </div>
  );
}
