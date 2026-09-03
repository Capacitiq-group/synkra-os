import { useEffect, useState } from "react";
import { pb } from "../../lib/pocketbase";
import { DataTable, Column } from "../../components/DataTable";
import { StatusBadge } from "../../components/StatusBadge";
import { SourceTag } from "../../lib/integrations";
import { useAuth } from "../../auth/AuthContext";

interface EmailTemplate {
  id: string;
  name: string;
  purpose?: string;
  subject: string;
  status: string;
  version?: number;
}

interface EmailEvent {
  id: string;
  direction: string;
  recipient: string;
  sender?: string;
  subject?: string;
  status: string;
  failure_reason?: string;
  sent_at?: string;
  delivered_at?: string;
}

export function EmailPage() {
  const { hasPermission } = useAuth();
  const [tab, setTab] = useState<"activity" | "templates">("activity");
  const [events, setEvents] = useState<EmailEvent[]>([]);
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [eventsRes, templatesRes] = await Promise.all([
        pb.collection("email_events").getList<EmailEvent>(1, 100, { sort: "-created" }),
        pb.collection("email_templates").getFullList<EmailTemplate>({ sort: "name" }),
      ]);
      setEvents(eventsRes.items);
      setTemplates(templatesRes);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load email data.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const eventColumns: Column<EmailEvent>[] = [
    { header: "Direction", render: (e) => e.direction },
    { header: "Recipient", render: (e) => e.recipient },
    { header: "Subject", render: (e) => e.subject || "—" },
    { header: "Status", render: (e) => <StatusBadge status={e.status} /> },
    { header: "Failure reason", render: (e) => e.failure_reason || "—" },
    { header: "Sent", render: (e) => (e.sent_at ? new Date(e.sent_at).toLocaleString() : "—") },
    { header: "Delivered", render: (e) => (e.delivered_at ? new Date(e.delivered_at).toLocaleString() : "—") },
  ];

  const templateColumns: Column<EmailTemplate>[] = [
    { header: "Name", render: (t) => t.name },
    { header: "Purpose", render: (t) => t.purpose?.replace(/_/g, " ") ?? "—" },
    { header: "Subject", render: (t) => t.subject },
    { header: "Status", render: (t) => <StatusBadge status={t.status} /> },
    { header: "Version", render: (t) => t.version ?? 1 },
  ];

  return (
    <div>
      <div className="page-header">
        <h1>Email</h1>
        <SourceTag source="Resend" />
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <button className={`btn ${tab === "activity" ? "btn--primary" : ""}`} onClick={() => setTab("activity")}>Activity</button>
        <button className={`btn ${tab === "templates" ? "btn--primary" : ""}`} onClick={() => setTab("templates")}>Templates</button>
      </div>

      {tab === "activity" ? (
        <DataTable
          columns={eventColumns}
          rows={events}
          rowKey={(e) => e.id}
          loading={loading}
          error={error}
          emptyMessage="No email activity recorded yet. Emails sent via /api/email/send, and delivery/bounce updates from the Resend webhook, will appear here."
          onRetry={load}
        />
      ) : (
        <DataTable
          columns={templateColumns}
          rows={templates}
          rowKey={(t) => t.id}
          loading={loading}
          error={error}
          emptyMessage={hasPermission("email.manage") ? "No templates yet." : "No templates yet, or you may not have email.manage to create one."}
          onRetry={load}
        />
      )}

      <p style={{ color: "var(--text-muted)", fontSize: 11, marginTop: 8 }}>
        Resend is the system of record for delivery — this table mirrors
        its events via webhook and does not duplicate Resend's own
        dashboard.
      </p>
    </div>
  );
}
