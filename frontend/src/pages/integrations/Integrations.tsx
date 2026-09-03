import { useIntegrationStatuses, IntegrationStatusBadge } from "../../lib/integrations";

export function IntegrationsPage() {
  const { statuses, loading } = useIntegrationStatuses();
  const rows = Object.values(statuses).sort((a, b) => a.display_name.localeCompare(b.display_name));

  return (
    <div>
      <div className="page-header">
        <h1>Integrations</h1>
        <span className="page-header__meta">External systems Synkra OS depends on</span>
      </div>

      {loading ? (
        <div className="loading-state">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="empty-state">
          No integration status rows found — this list is seeded by the initial
          PocketBase migration and updated on every adapter call.
        </div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>System</th>
              <th>Status</th>
              <th>Last checked</th>
              <th>Last successful</th>
              <th>Last error</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.integration_key}>
                <td>{row.display_name}</td>
                <td><IntegrationStatusBadge status={row.status} /></td>
                <td>{row.last_checked_at ? new Date(row.last_checked_at).toLocaleString() : "Never"}</td>
                <td>{row.last_successful_at ? new Date(row.last_successful_at).toLocaleString() : "Never"}</td>
                <td>{row.last_error || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p style={{ color: "var(--text-muted)", fontSize: 11, marginTop: 12 }}>
        A status here only changes when that integration is actually called
        (viewing Flow, sending an email, etc.) — this reflects the most
        recent real attempt, not a live poll of every system right now.
      </p>
    </div>
  );
}
