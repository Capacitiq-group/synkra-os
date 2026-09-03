import { useEffect, useState } from "react";
import { pb } from "../../lib/pocketbase";
import { DataTable, Column } from "../../components/DataTable";
import { StatusBadge } from "../../components/StatusBadge";

interface Incident {
  id: string;
  title: string;
  product?: string;
  service?: string;
  severity: string;
  status: string;
  detected_at: string;
  resolved_at?: string;
  affected_customers?: string[];
}

export function IncidentsPage() {
  const [rows, setRows] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const result = await pb.collection("incidents").getList<Incident>(1, 100, { sort: "-detected_at" });
      setRows(result.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load incidents.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const columns: Column<Incident>[] = [
    { header: "Title", render: (i) => i.title },
    { header: "Product", render: (i) => i.product ?? "—" },
    { header: "Service", render: (i) => i.service ?? "—" },
    { header: "Severity", render: (i) => <StatusBadge status={i.severity} /> },
    { header: "Status", render: (i) => <StatusBadge status={i.status} /> },
    { header: "Affected customers", render: (i) => i.affected_customers?.length ?? 0 },
    { header: "Detected", render: (i) => new Date(i.detected_at).toLocaleString() },
    { header: "Resolved", render: (i) => (i.resolved_at ? new Date(i.resolved_at).toLocaleString() : "—") },
  ];

  return (
    <div>
      <div className="page-header">
        <h1>Incidents</h1>
        <span className="page-header__meta">{rows.length} shown</span>
      </div>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(i) => i.id}
        loading={loading}
        error={error}
        emptyMessage="No incidents recorded."
        onRetry={load}
      />
    </div>
  );
}
