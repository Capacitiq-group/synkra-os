import { useEffect, useState } from "react";
import { pb } from "../../lib/pocketbase";
import { DataTable, Column } from "../../components/DataTable";
import { StatusBadge } from "../../components/StatusBadge";

interface Partner {
  id: string;
  company_name: string;
  contact_name?: string;
  contact_email?: string;
  type?: string;
  status: string;
  commission_structure?: string;
}

export function PartnersPage() {
  const [rows, setRows] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const result = await pb.collection("partners").getFullList<Partner>({ sort: "company_name" });
      setRows(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load partners.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const columns: Column<Partner>[] = [
    { header: "Company", render: (p) => p.company_name },
    { header: "Contact", render: (p) => p.contact_name ?? "—" },
    { header: "Email", render: (p) => p.contact_email ?? "—" },
    { header: "Type", render: (p) => p.type ?? "—" },
    { header: "Status", render: (p) => <StatusBadge status={p.status} /> },
    { header: "Commission", render: (p) => p.commission_structure ?? "—" },
  ];

  return (
    <div>
      <div className="page-header">
        <h1>Partners</h1>
        <span className="page-header__meta">{rows.length} shown</span>
      </div>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(p) => p.id}
        loading={loading}
        error={error}
        emptyMessage="No partners recorded yet."
        onRetry={load}
      />
    </div>
  );
}
