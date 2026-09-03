import { useEffect, useState } from "react";
import { pb } from "../../lib/pocketbase";
import { DataTable, Column } from "../../components/DataTable";
import { StatusBadge } from "../../components/StatusBadge";
import { useAuth } from "../../auth/AuthContext";
import { useIntegrationStatuses, IntegrationStatusBadge, SourceTag } from "../../lib/integrations";

interface Server {
  id: string;
  name: string;
  host?: string;
  role?: string;
  cpu_pct?: number;
  ram_pct?: number;
  disk_pct?: number;
  status: string;
  last_checked_at?: string;
}

interface HealthCheck {
  id: string;
  target: string;
  endpoint?: string;
  status: string;
  response_ms?: number;
  checked_at: string;
  detail?: string;
}

export function InfrastructurePage() {
  const { hasPermission } = useAuth();
  const { statuses } = useIntegrationStatuses();
  const [servers, setServers] = useState<Server[]>([]);
  const [checks, setChecks] = useState<HealthCheck[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [serverList, healthList] = await Promise.all([
        pb.collection("servers").getFullList<Server>({ sort: "name" }),
        pb.collection("health_checks").getList<HealthCheck>(1, 50, { sort: "-checked_at" }),
      ]);
      setServers(serverList);
      setChecks(healthList.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load infrastructure data.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function syncNow() {
    setSyncing(true);
    setSyncError(null);
    try {
      await pb.send("/api/infrastructure/sync-coolify", { method: "POST" });
      await load();
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : "Sync failed.");
    } finally {
      setSyncing(false);
    }
  }

  const coolifyStatus = statuses["coolify"]?.status;
  const canRestart = hasPermission("infrastructure.restart");

  const serverColumns: Column<Server>[] = [
    { header: "Name", render: (s) => s.name },
    { header: "Role", render: (s) => s.role ?? "—" },
    { header: "Status", render: (s) => <StatusBadge status={s.status} /> },
    { header: "CPU", render: (s) => (s.cpu_pct != null ? `${s.cpu_pct}%` : "—") },
    { header: "RAM", render: (s) => (s.ram_pct != null ? `${s.ram_pct}%` : "—") },
    { header: "Disk", render: (s) => (s.disk_pct != null ? `${s.disk_pct}%` : "—") },
    { header: "Last checked", render: (s) => (s.last_checked_at ? new Date(s.last_checked_at).toLocaleString() : "—") },
    {
      header: "Action",
      render: () =>
        canRestart ? (
          <button
            className="btn"
            disabled
            title="Coolify's API doesn't expose a generic restart-by-status action wired here yet — this button is intentionally inert rather than pretending to trigger one."
          >
            Restart
          </button>
        ) : (
          "—"
        ),
    },
  ];

  const checkColumns: Column<HealthCheck>[] = [
    { header: "Target", render: (c) => c.target },
    { header: "Status", render: (c) => <StatusBadge status={c.status} /> },
    { header: "Detail", render: (c) => c.detail ?? "—" },
    { header: "Checked", render: (c) => new Date(c.checked_at).toLocaleString() },
  ];

  return (
    <div>
      <div className="page-header">
        <h1>Infrastructure</h1>
        <span className="page-header__meta">{servers.length} servers reporting</span>
      </div>

      <div className="panel">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div className="panel__title" style={{ margin: 0 }}>
            Coolify {coolifyStatus && <IntegrationStatusBadge status={coolifyStatus} />}
          </div>
          <button className="btn" onClick={syncNow} disabled={syncing}>
            {syncing ? "Syncing…" : "Sync now"}
          </button>
        </div>
        {syncError && <div className="error-state" style={{ padding: "8px 0" }}>{syncError}</div>}
        <p style={{ color: "var(--text-muted)", fontSize: 11, marginBottom: 0 }}>
          Servers and per-resource status sync from Coolify's real API
          (<code>/servers</code>, <code>/servers/{"{uuid}"}/resources</code>) —
          this works the same regardless of whether a resource is
          PocketBase, PostgreSQL, or anything else Docker-based. CPU/RAM/disk
          percentages only populate if Coolify's Sentinel agent is enabled
          for that server — Coolify's own docs note Sentinel metrics don't
          work for Docker Compose or Service-Template deployments, so a
          blank figure here means "not available," not "zero load."
        </p>
      </div>

      <div className="panel">
        <div className="panel__title">Servers <SourceTag source="Coolify" /></div>
        <DataTable
          columns={serverColumns}
          rows={servers}
          rowKey={(s) => s.id}
          loading={loading}
          error={error}
          emptyMessage="No servers reporting yet — set COOLIFY_API_BASE / COOLIFY_API_TOKEN and click Sync now."
          onRetry={load}
        />
      </div>

      <div className="panel">
        <div className="panel__title">Recent resource status <SourceTag source="Coolify" /></div>
        <DataTable
          columns={checkColumns}
          rows={checks}
          rowKey={(c) => c.id}
          loading={loading}
          error={error}
          emptyMessage="No status checks recorded yet."
        />
      </div>
    </div>
  );
}
