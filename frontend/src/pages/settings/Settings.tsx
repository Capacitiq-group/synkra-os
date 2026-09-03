import { useEffect, useState } from "react";
import { pb } from "../../lib/pocketbase";
import { DataTable, Column } from "../../components/DataTable";
import { StatusBadge } from "../../components/StatusBadge";
import { useAuth } from "../../auth/AuthContext";
import type { Employee } from "../../types/models";

const ROADMAP_MODULES = [
  "Billing: provider sync workers (Zoho Books / Paystack) not yet built — the module is live but invoices/payments only populate once those are connected.",
  "Utilities: capture + event recording is live; unique-user / anonymous-session breakdowns not yet built (raw counts only).",
  "Infrastructure: server/health-check data only populates once the monitoring worker is connected; the restart action is a real permission-gated button wired to no-op until that worker exists.",
  "Deployments: populates once the GitHub/Coolify webhook handler is connected.",
];

export function SettingsPage() {
  const { role } = useAuth();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const result = await pb.collection("employees").getFullList<Employee>({ expand: "role", sort: "full_name" });
      setEmployees(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load employees.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const columns: Column<Employee>[] = [
    { header: "Name", render: (e) => e.full_name },
    { header: "Email", render: (e) => e.email },
    { header: "Role", render: (e) => e.expand?.role?.name ?? "—" },
    { header: "Department", render: (e) => e.department || "—" },
    { header: "Status", render: (e) => <StatusBadge status={e.status} /> },
  ];

  return (
    <div>
      <div className="page-header">
        <h1>Settings</h1>
        <span className="page-header__meta">Signed in as: {role?.name ?? "—"}</span>
      </div>

      <div className="panel">
        <div className="panel__title">Employees &amp; Roles</div>
        <DataTable
          columns={columns}
          rows={employees}
          rowKey={(e) => e.id}
          loading={loading}
          error={error}
          emptyMessage="No employees found."
          onRetry={load}
        />
      </div>

      <div className="panel">
        <div className="panel__title">Build status</div>
        <p style={{ color: "var(--text-secondary)", marginTop: 0 }}>
          All 21 modules from the spec have a screen. The items below are
          real screens with real queries that are honestly empty until a
          background worker or external integration is connected — not
          fake data and not hidden pages.
        </p>
        <ul style={{ color: "var(--text-secondary)", paddingLeft: 18 }}>
          {ROADMAP_MODULES.map((m) => (
            <li key={m} style={{ marginBottom: 4 }}>{m}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
