import { useEffect, useState } from "react";
import { pb } from "../../lib/pocketbase";
import { DataTable, Column } from "../../components/DataTable";
import { ConfirmActionDialog } from "../../components/ConfirmActionDialog";
import { SourceTag } from "../../lib/integrations";
import { useAuth } from "../../auth/AuthContext";

interface DailyMetrics {
  companies_discovered: number;
  contacts_found: number;
  contacts_verified: number;
  initial_emails_sent: number;
  followups_sent: number;
  replies: number;
  meetings_booked: number;
  deals_won: number;
}

interface CurrentPeriod {
  label: string;
  initial_emails_target: number;
  initial_emails_sent: number;
  new_clients_target?: number;
  new_clients: number;
}

interface SuppressionRow {
  id: string;
  email_normalized: string;
  reason: string;
  notes?: string;
  created: string;
}

function ProgressBar({ current, target }: { current: number; target: number }) {
  const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
  return (
    <div style={{ background: "var(--charcoal-medium)", border: "1px solid var(--border-color)", height: 8, width: "100%" }}>
      <div style={{ background: "var(--lime)", height: "100%", width: `${pct}%` }} />
    </div>
  );
}

export function AcquisitionEnginePage() {
  const { hasPermission } = useAuth();
  const [daily, setDaily] = useState<DailyMetrics | null>(null);
  const [period, setPeriod] = useState<CurrentPeriod | null>(null);
  const [suppression, setSuppression] = useState<SuppressionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showSuppress, setShowSuppress] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [dashboardRes, suppressionRes] = await Promise.all([
        pb.send<{ daily: DailyMetrics; current_period: CurrentPeriod | null }>("/api/acquisition/dashboard", { method: "GET" }),
        pb.collection("suppression_list").getList<SuppressionRow>(1, 50, { sort: "-created" }),
      ]);
      setDaily(dashboardRes.daily);
      setPeriod(dashboardRes.current_period);
      setSuppression(suppressionRes.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load acquisition data.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function addSuppression(reason: string) {
    // ConfirmActionDialog only collects one free-text field; reuse it for
    // email, expect "email | reason" isn't ideal — instead prompt for email
    // via the notes field convention below.
    const [email, notes] = reason.split("|").map((s) => s.trim());
    await pb.send("/api/acquisition/suppression/add", { method: "POST", body: { email, reason: "manual", notes } });
    await load();
  }

  const suppressionColumns: Column<SuppressionRow>[] = [
    { header: "Email", render: (s) => s.email_normalized },
    { header: "Reason", render: (s) => s.reason.replace(/_/g, " ") },
    { header: "Notes", render: (s) => s.notes || "—" },
    { header: "Added", render: (s) => new Date(s.created).toLocaleDateString() },
  ];

  if (loading) return <div className="loading-state">Loading acquisition engine data…</div>;
  if (error) {
    return (
      <div className="error-state">
        {error}
        <div style={{ marginTop: 10 }}><button className="btn" onClick={load}>Retry</button></div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <h1>Acquisition Engine</h1>
        <SourceTag source="Synkra OS (CRM) — fed by a separate Python/AI worker project" />
      </div>

      <div className="panel" style={{ borderColor: "var(--border-color)" }}>
        <div className="panel__title">About this module</div>
        <p style={{ color: "var(--text-secondary)", marginTop: 0 }}>
          This is the CRM/state layer only. Discovery, research, and outreach
          generation are handled by a separate Python + AI-agent project
          (per the architecture spec) that calls into
          <code style={{ margin: "0 4px" }}>/api/acquisition/*</code>
          once <code>ACQUISITION_WORKER_API_KEY</code> is configured. Until
          that project exists and is connected, the numbers below will
          genuinely be zero — that's an accurate reflection of "nothing has
          run yet," not a broken dashboard.
        </p>
      </div>

      {period && (
        <div className="panel">
          <div className="panel__title">{period.label} target</div>
          <div style={{ marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
              <span>Initial emails</span>
              <span>{period.initial_emails_sent} / {period.initial_emails_target}</span>
            </div>
            <ProgressBar current={period.initial_emails_sent} target={period.initial_emails_target} />
          </div>
          {period.new_clients_target != null && (
            <div className="kpi-row">
              <div className="kpi">
                <div className="kpi__value">{period.new_clients} / {period.new_clients_target}</div>
                <div className="kpi__label">New clients this period</div>
              </div>
            </div>
          )}
        </div>
      )}

      {daily && (
        <div className="panel">
          <div className="panel__title">Today</div>
          <div className="kpi-row">
            <div className="kpi"><div className="kpi__value">{daily.companies_discovered}</div><div className="kpi__label">Companies discovered</div></div>
            <div className="kpi"><div className="kpi__value">{daily.contacts_found}</div><div className="kpi__label">Contacts found</div></div>
            <div className="kpi"><div className="kpi__value">{daily.contacts_verified}</div><div className="kpi__label">Contacts verified</div></div>
            <div className="kpi"><div className="kpi__value kpi__value--ok">{daily.initial_emails_sent}</div><div className="kpi__label">Initial emails sent</div></div>
            <div className="kpi"><div className="kpi__value">{daily.followups_sent}</div><div className="kpi__label">Follow-ups sent</div></div>
            <div className="kpi"><div className="kpi__value">{daily.replies}</div><div className="kpi__label">Replies</div></div>
            <div className="kpi"><div className="kpi__value">{daily.meetings_booked}</div><div className="kpi__label">Meetings booked</div></div>
            <div className="kpi"><div className="kpi__value kpi__value--ok">{daily.deals_won}</div><div className="kpi__label">Deals won</div></div>
          </div>
        </div>
      )}

      <div className="panel">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div className="panel__title" style={{ margin: 0 }}>Suppression list ({suppression.length})</div>
          {hasPermission("acquisition.manage") && (
            <button className="btn" onClick={() => setShowSuppress(true)}>Add suppression</button>
          )}
        </div>
        <p style={{ color: "var(--text-muted)", fontSize: 11 }}>
          Checked before every send, automatically, by the campaign event
          route — this is not just a reporting list.
        </p>
        <DataTable
          columns={suppressionColumns}
          rows={suppression}
          rowKey={(s) => s.id}
          loading={false}
          error={null}
          emptyMessage="No suppressions yet."
        />
      </div>

      {showSuppress && (
        <ConfirmActionDialog
          title="Add manual suppression"
          description="Enter as: email | optional notes"
          confirmLabel="Add"
          onConfirm={addSuppression}
          onClose={() => setShowSuppress(false)}
        />
      )}
    </div>
  );
}
