import { useEffect, useState } from "react";
import { pb } from "../../lib/pocketbase";
import { StatusBadge } from "../../components/StatusBadge";
import { ConfirmActionDialog } from "../../components/ConfirmActionDialog";
import { SourceTag } from "../../lib/integrations";
import { useAuth } from "../../auth/AuthContext";

interface AgencyClient {
  id: string;
  company_name: string;
  contact_name?: string;
  contact_email?: string;
  status?: string;
  billing_mode?: string;
}

interface AgencyService {
  id: string;
  service_slug?: string;
  tier?: string;
  status?: string;
  onboarding_status?: string;
  monthly_price?: number;
  setup_price?: number;
}

interface RawRecord {
  id: string;
  [key: string]: unknown;
}

type ConnectionState = "loading" | "connected" | "not_configured" | "unavailable";

export function AgencyPlatformPage() {
  const { hasPermission } = useAuth();
  const [connectionState, setConnectionState] = useState<ConnectionState>("loading");
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [clients, setClients] = useState<AgencyClient[]>([]);
  const [selectedClient, setSelectedClient] = useState<AgencyClient | null>(null);
  const [services, setServices] = useState<AgencyService[]>([]);
  const [intakeForms, setIntakeForms] = useState<RawRecord[]>([]);
  const [onboardingNotes, setOnboardingNotes] = useState<RawRecord[]>([]);
  const [reports, setReports] = useState<RawRecord[]>([]);
  const [showNoteDialog, setShowNoteDialog] = useState(false);

  async function loadClients() {
    setConnectionState("loading");
    setErrorDetail(null);
    try {
      const res = await pb.send<{ items: AgencyClient[] }>("/api/agency-platform/clients", { method: "GET" });
      setClients(res.items || []);
      setConnectionState("connected");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Agency Platform is unavailable.";
      setErrorDetail(message);
      setConnectionState(message.includes("AGENCY_PLATFORM_PB") ? "not_configured" : "unavailable");
    }
  }

  useEffect(() => {
    loadClients();
  }, []);

  async function openClient(client: AgencyClient) {
    setSelectedClient(client);
    const [servicesRes, intakeRes, notesRes, reportsRes] = await Promise.all([
      pb.send<{ items: AgencyService[] }>(`/api/agency-platform/clients/${client.id}/services`, { method: "GET" }),
      pb.send<{ items: RawRecord[] }>(`/api/agency-platform/clients/${client.id}/intake-forms`, { method: "GET" }),
      pb.send<{ items: RawRecord[] }>(`/api/agency-platform/clients/${client.id}/onboarding-notes`, { method: "GET" }),
      pb.send<{ items: RawRecord[] }>(`/api/agency-platform/clients/${client.id}/implementation-reports`, { method: "GET" }),
    ]);
    setServices(servicesRes.items || []);
    setIntakeForms(intakeRes.items || []);
    setOnboardingNotes(notesRes.items || []);
    setReports(reportsRes.items || []);
  }

  async function addOnboardingNote(notes: string) {
    if (!selectedClient) return;
    await pb.send("/api/agency-platform/onboarding-notes", {
      method: "POST",
      body: { client_id: selectedClient.id, notes, call_held_at: new Date().toISOString() },
    });
    await openClient(selectedClient);
  }

  if (connectionState === "loading") {
    return <div className="loading-state">Checking Agency Platform connection…</div>;
  }

  if (connectionState !== "connected") {
    return (
      <div>
        <div className="page-header">
          <h1>Agency Platform</h1>
          <SourceTag source="Agency Platform (dedicated PocketBase)" />
        </div>
        <div className="panel" style={{ borderColor: connectionState === "not_configured" ? "var(--border-color)" : "var(--status-error)" }}>
          <div className="panel__title">
            {connectionState === "not_configured" ? "Agency Platform is not configured" : "Agency Platform is unavailable"}
          </div>
          <p style={{ color: "var(--text-secondary)" }}>
            {connectionState === "not_configured"
              ? "Set AGENCY_PLATFORM_PB_BASE_URL and AGENCY_PLATFORM_PB_TOKEN to connect. This is the dedicated PocketBase instance the Client Portal already writes to — Synkra OS acts as the Admin Panel role against it, per ARCHITECTURE.md."
              : errorDetail}
          </p>
          <button className="btn" onClick={loadClients}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <h1>Agency Platform</h1>
        <SourceTag source="Agency Platform (dedicated PocketBase)" />
      </div>

      <div className="panel">
        <div className="panel__title">Clients ({clients.length})</div>
        <table className="data-table">
          <thead><tr><th>Company</th><th>Contact</th><th>Email</th><th>Status</th><th>Billing mode</th></tr></thead>
          <tbody>
            {clients.map((c) => (
              <tr key={c.id} onClick={() => openClient(c)} style={{ cursor: "pointer" }}>
                <td>{c.company_name}</td>
                <td>{c.contact_name || "—"}</td>
                <td>{c.contact_email || "—"}</td>
                <td>{c.status ? <StatusBadge status={c.status} /> : "—"}</td>
                <td>{c.billing_mode || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedClient && (
        <>
          <div className="panel">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div className="panel__title" style={{ margin: 0 }}>{selectedClient.company_name} — Services</div>
              {hasPermission("agency.manage") && (
                <button className="btn" onClick={() => setShowNoteDialog(true)}>Add onboarding note</button>
              )}
            </div>
            {services.length === 0 ? (
              <div className="empty-state">No services on record.</div>
            ) : (
              <table className="data-table">
                <thead><tr><th>Service</th><th>Tier</th><th>Status</th><th>Onboarding status</th><th>Monthly</th><th>Setup</th></tr></thead>
                <tbody>
                  {services.map((s) => (
                    <tr key={s.id}>
                      <td>{s.service_slug || "—"}</td>
                      <td>{s.tier || "—"}</td>
                      <td>{s.status ? <StatusBadge status={s.status} /> : "—"}</td>
                      <td>{s.onboarding_status ? <StatusBadge status={s.onboarding_status} /> : "—"}</td>
                      <td>{s.monthly_price != null ? s.monthly_price : "—"}</td>
                      <td>{s.setup_price != null ? s.setup_price : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="panel">
            <div className="panel__title">Intake forms ({intakeForms.length})</div>
            {intakeForms.length === 0 ? (
              <div className="empty-state">No intake forms submitted yet.</div>
            ) : (
              <table className="data-table">
                <thead><tr><th>Service</th><th>Plan tier</th><th>Submitted</th></tr></thead>
                <tbody>
                  {intakeForms.map((f) => (
                    <tr key={f.id}>
                      <td>{String(f.service ?? "—")}</td>
                      <td>{String(f.plan_tier ?? "—")}</td>
                      <td>{f.submitted_at ? new Date(String(f.submitted_at)).toLocaleString() : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="panel">
            <div className="panel__title">Onboarding notes ({onboardingNotes.length})</div>
            {onboardingNotes.length === 0 ? (
              <div className="empty-state">No onboarding call notes logged yet.</div>
            ) : (
              <table className="data-table">
                <thead><tr><th>Call held</th><th>Notes</th></tr></thead>
                <tbody>
                  {onboardingNotes.map((n) => (
                    <tr key={n.id}>
                      <td>{n.call_held_at ? new Date(String(n.call_held_at)).toLocaleString() : "—"}</td>
                      <td>{String(n.notes ?? "—")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="panel">
            <div className="panel__title">Implementation reports ({reports.length})</div>
            {reports.length === 0 ? (
              <div className="empty-state">No implementation reports yet — written by the AI Implementation Agent once that project exists and is connected.</div>
            ) : (
              <table className="data-table">
                <thead><tr><th>Service</th><th>Status</th><th>Started</th><th>Completed</th></tr></thead>
                <tbody>
                  {reports.map((r) => (
                    <tr key={r.id}>
                      <td>{String(r.service ?? "—")}</td>
                      <td><StatusBadge status={String(r.status ?? "unknown")} /></td>
                      <td>{r.started_at ? new Date(String(r.started_at)).toLocaleString() : "—"}</td>
                      <td>{r.completed_at ? new Date(String(r.completed_at)).toLocaleString() : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {showNoteDialog && (
        <ConfirmActionDialog
          title="Add onboarding call note"
          description="Logs a note against this client's onboarding call — Admin Panel is the only creator of these per ARCHITECTURE.md."
          confirmLabel="Add note"
          onConfirm={addOnboardingNote}
          onClose={() => setShowNoteDialog(false)}
        />
      )}

      <p style={{ color: "var(--text-muted)", fontSize: 11, marginTop: 8 }}>
        Known gaps carried over from ARCHITECTURE.md: the pause/cancel
        scheduled job, the renewal job, and usage-credit consumption
        (decrementing remaining) are not built anywhere yet — this page
        reads/writes what already exists, it doesn't paper over what
        doesn't.
      </p>
    </div>
  );
}
