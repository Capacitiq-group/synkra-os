import { useEffect, useState } from "react";
import { pb } from "../../lib/pocketbase";
import { DataTable, Column } from "../../components/DataTable";

interface Utility {
  id: string;
  name: string;
  category?: string;
  slug: string;
}

interface UtilityStats {
  utilityId: string;
  name: string;
  category?: string;
  totalUses: number;
  successful: number;
  failed: number;
  avgProcessingMs: number | null;
  errorRatePct: number;
}

export function UtilitiesPage() {
  const [rows, setRows] = useState<UtilityStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const utilities = await pb.collection("utilities").getFullList<Utility>({ sort: "name" });
      const stats = await Promise.all(
        utilities.map(async (u): Promise<UtilityStats> => {
          const events = await pb.collection("utility_events").getFullList<{
            outcome: string;
            processing_ms?: number;
          }>({ filter: `utility = "${u.id}"` });
          const successful = events.filter((e) => e.outcome === "success").length;
          const failed = events.filter((e) => e.outcome === "failure").length;
          const withTiming = events.filter((e) => typeof e.processing_ms === "number");
          const avgProcessingMs = withTiming.length
            ? Math.round(withTiming.reduce((sum, e) => sum + (e.processing_ms || 0), 0) / withTiming.length)
            : null;
          const total = successful + failed;
          return {
            utilityId: u.id,
            name: u.name,
            category: u.category,
            totalUses: total,
            successful,
            failed,
            avgProcessingMs,
            errorRatePct: total > 0 ? Math.round((failed / total) * 1000) / 10 : 0,
          };
        })
      );
      setRows(stats);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load utility analytics.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const columns: Column<UtilityStats>[] = [
    { header: "Utility", render: (u) => u.name },
    { header: "Category", render: (u) => u.category ?? "—" },
    { header: "Total uses", render: (u) => u.totalUses },
    { header: "Successful", render: (u) => u.successful },
    { header: "Failed", render: (u) => u.failed },
    { header: "Error rate", render: (u) => `${u.errorRatePct}%` },
    { header: "Avg. processing", render: (u) => (u.avgProcessingMs != null ? `${u.avgProcessingMs}ms` : "—") },
  ];

  return (
    <div>
      <div className="page-header">
        <h1>Utilities</h1>
        <span className="page-header__meta">{rows.length} tracked</span>
      </div>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(u) => u.utilityId}
        loading={loading}
        error={error}
        emptyMessage="No utilities configured yet. Add rows to the `utilities` collection to start tracking usage."
        onRetry={load}
      />
      <p style={{ color: "var(--text-muted)", fontSize: 11, marginTop: 8 }}>
        Figures are computed live from utility_events — nothing here is
        estimated or cached. Anonymous-session and unique-user breakdowns
        require a dedicated aggregation query and are not yet built (see
        README, Known gaps).
      </p>
    </div>
  );
}
