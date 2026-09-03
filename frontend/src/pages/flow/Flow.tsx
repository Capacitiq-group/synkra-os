import { useEffect, useState } from "react";
import { pb } from "../../lib/pocketbase";
import { SourceTag } from "../../lib/integrations";

interface FlowUser {
  flow_user_id: string;
  email: string;
  tier?: string;
  user_type?: string;
  trial_ends_at?: string;
  business_name?: string;
  usage?: {
    executions_used_this_month?: number;
    ai_ops_used_this_month?: number;
    emails_used_this_month?: number;
    storage_used_mb?: number;
  };
  is_tester?: boolean;
}

interface FlowWorkspace {
  flow_workspace_id: string;
  name?: string;
}

type ConnectionState = "loading" | "connected" | "not_configured" | "unavailable";

export function FlowPage() {
  const [tab, setTab] = useState<"users" | "workspaces">("users");
  const [users, setUsers] = useState<FlowUser[]>([]);
  const [workspaces, setWorkspaces] = useState<FlowWorkspace[]>([]);
  const [connectionState, setConnectionState] = useState<ConnectionState>("loading");
  const [errorDetail, setErrorDetail] = useState<string | null>(null);

  async function load() {
    setConnectionState("loading");
    setErrorDetail(null);
    try {
      const [usersRes, workspacesRes] = await Promise.all([
        pb.send<{ items: FlowUser[] }>("/api/flow/users", { method: "GET" }),
        pb.send<{ items: FlowWorkspace[] }>("/api/flow/workspaces", { method: "GET" }),
      ]);
      setUsers(usersRes.items || []);
      setWorkspaces(workspacesRes.items || []);
      setConnectionState("connected");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Flow is unavailable.";
      setErrorDetail(message);
      setConnectionState(message.includes("FLOW_API_BASE") ? "not_configured" : "unavailable");
    }
  }

  useEffect(() => {
    load();
  }, []);

  if (connectionState === "loading") {
    return <div className="loading-state">Checking Flow connection…</div>;
  }

  if (connectionState !== "connected") {
    return (
      <div>
        <div className="page-header">
          <h1>Flow</h1>
          <SourceTag source="Flow" />
        </div>
        <div className="panel" style={{ borderColor: connectionState === "not_configured" ? "var(--border-color)" : "var(--status-error)" }}>
          <div className="panel__title">
            {connectionState === "not_configured" ? "Flow is not configured" : "Flow is unavailable"}
          </div>
          <p style={{ color: "var(--text-secondary)" }}>
            {connectionState === "not_configured"
              ? "Set FLOW_API_BASE and FLOW_API_KEY (a dedicated read-only service-account token — not a human admin's login) to connect. Nothing below is fake data."
              : errorDetail}
          </p>
          <button className="btn" onClick={load}>Retry</button>
        </div>
      </div>
    );
  }

  const tierCounts = users.reduce<Record<string, number>>((acc, u) => {
    const key = u.tier || "unknown";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  return (
    <div>
      <div className="page-header">
        <h1>Flow</h1>
        <SourceTag source="Flow" />
      </div>

      <div className="panel" style={{ borderColor: "var(--border-color)" }}>
        <p style={{ color: "var(--text-secondary)", marginTop: 0, marginBottom: 0 }}>
          "Customer" in Flow is workspace-centric, not a flat user list — a
          single user can belong to multiple workspaces. Users and
          Workspaces are shown as separate tabs here rather than forced
          into one "customer" concept. Usage figures below are raw counters
          from Flow — plan limits (what a tier is entitled to) live in
          Flow's own code, not its database, so no "% of limit" is shown
          until a <code>GET /admin/plans</code> endpoint exists.
        </p>
      </div>

      <div className="kpi-row">
        <div className="kpi"><div className="kpi__value">{users.length}</div><div className="kpi__label">Flow users</div></div>
        <div className="kpi"><div className="kpi__value">{workspaces.length}</div><div className="kpi__label">Workspaces</div></div>
        {Object.entries(tierCounts).map(([tier, count]) => (
          <div className="kpi" key={tier}>
            <div className="kpi__value">{count}</div>
            <div className="kpi__label">Tier: {tier}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <button className={`btn ${tab === "users" ? "btn--primary" : ""}`} onClick={() => setTab("users")}>Users</button>
        <button className={`btn ${tab === "workspaces" ? "btn--primary" : ""}`} onClick={() => setTab("workspaces")}>Workspaces</button>
      </div>

      {tab === "users" ? (
        users.length === 0 ? (
          <div className="empty-state">No Flow users returned.</div>
        ) : (
          <table className="data-table">
            <thead><tr><th>Business</th><th>Email</th><th>Tier</th><th>Type</th><th>Trial ends</th><th>Executions/mo</th><th>AI ops/mo</th></tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.flow_user_id}>
                  <td>{u.business_name || "—"}</td>
                  <td>{u.email}</td>
                  <td>{u.tier || "—"}</td>
                  <td>{u.user_type || "—"}{u.is_tester ? " (tester)" : ""}</td>
                  <td>{u.trial_ends_at ? new Date(u.trial_ends_at).toLocaleDateString() : "—"}</td>
                  <td>{u.usage?.executions_used_this_month ?? "—"}</td>
                  <td>{u.usage?.ai_ops_used_this_month ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      ) : workspaces.length === 0 ? (
        <div className="empty-state">No Flow workspaces returned.</div>
      ) : (
        <table className="data-table">
          <thead><tr><th>Name</th><th>Flow workspace ID</th></tr></thead>
          <tbody>
            {workspaces.map((w) => (
              <tr key={w.flow_workspace_id}>
                <td>{w.name || "—"}</td>
                <td style={{ color: "var(--text-muted)" }}>{w.flow_workspace_id}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
