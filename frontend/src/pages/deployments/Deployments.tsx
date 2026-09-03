import { useEffect, useState } from "react";
import { pb } from "../../lib/pocketbase";
import { DataTable, Column } from "../../components/DataTable";
import { StatusBadge } from "../../components/StatusBadge";

interface Deployment {
  id: string;
  repository: string;
  branch?: string;
  commit_sha?: string;
  commit_message?: string;
  status: string;
  environment?: string;
  started_at?: string;
  finished_at?: string;
  coolify_deployment_url?: string;
}

export function DeploymentsPage() {
  const [rows, setRows] = useState<Deployment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const result = await pb.collection("deployments").getList<Deployment>(1, 100, { sort: "-started_at" });
      setRows(result.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load deployments.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const columns: Column<Deployment>[] = [
    { header: "Repository", render: (d) => d.repository },
    { header: "Branch", render: (d) => d.branch ?? "—" },
    { header: "Commit", render: (d) => (d.commit_sha ? d.commit_sha.slice(0, 7) : "—") },
    { header: "Message", render: (d) => d.commit_message ?? "—" },
    { header: "Status", render: (d) => <StatusBadge status={d.status} /> },
    { header: "Started", render: (d) => (d.started_at ? new Date(d.started_at).toLocaleString() : "—") },
    {
      header: "Link",
      render: (d) =>
        d.coolify_deployment_url ? (
          <a href={d.coolify_deployment_url} target="_blank" rel="noreferrer">
            View in Coolify
          </a>
        ) : (
          "—"
        ),
    },
  ];

  return (
    <div>
      <div className="page-header">
        <h1>Deployments</h1>
        <span className="page-header__meta">{rows.length} shown</span>
      </div>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(d) => d.id}
        loading={loading}
        error={error}
        emptyMessage="No deployments recorded yet — this populates once the GitHub/Coolify webhook handler is connected (see README, Known gaps)."
        onRetry={load}
      />
    </div>
  );
}
