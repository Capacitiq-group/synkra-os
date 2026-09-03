import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { pb } from "../../lib/pocketbase";
import { useAuth } from "../../auth/AuthContext";
import { StatusBadge } from "../../components/StatusBadge";
import { ConfirmActionDialog } from "../../components/ConfirmActionDialog";
import type { Customer, Subscription, Invoice, SupportTicket, AuditLog } from "../../types/models";

interface Conversation {
  id: string;
  channel?: string;
  author_is_customer?: boolean;
  body: string;
  sent_at: string;
  expand?: { author_employee?: { full_name: string } };
}

interface AgencyLead {
  id: string;
  company_name: string;
  stage: string;
  quoted_amount_cents?: number;
}

interface Customer360Data {
  customer: Customer;
  subscriptions: Subscription[];
  invoices: Invoice[];
  tickets: SupportTicket[];
  conversations: Conversation[];
  agencyLeads: AgencyLead[];
  activity: AuditLog[];
}

function formatCurrency(cents: number, currency = "USD"): string {
  return `${currency} ${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

export function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { hasPermission } = useAuth();
  const [data, setData] = useState<Customer360Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [partialErrors, setPartialErrors] = useState<string[]>([]);
  const [activeDialog, setActiveDialog] = useState<"suspend" | "reactivate" | "impersonate" | null>(null);
  const [impersonationBanner, setImpersonationBanner] = useState<{ expiresAt: string; sessionId: string } | null>(null);

  async function load() {
    if (!id) return;
    setLoading(true);
    setError(null);
    const errs: string[] = [];

    // Fetched independently: a permission gap on one related collection
    // (e.g. no agency.view) shouldn't take down the whole 360 view — it
    // should just show that one section's own error state.
    async function safeFetch<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
      try {
        return await fn();
      } catch (err) {
        errs.push(`${label}: ${err instanceof Error ? err.message : "failed to load"}`);
        return fallback;
      }
    }

    try {
      const customer = await pb.collection("customers").getOne<Customer>(id, { expand: "organisation,assigned_staff" });
      const [subscriptions, invoices, tickets, conversations, agencyLeads, activity] = await Promise.all([
        safeFetch("Subscriptions", () => pb.collection("subscriptions").getFullList<Subscription>({ filter: `customer = "${id}"`, expand: "product" }), []),
        safeFetch("Invoices", () => pb.collection("invoices").getFullList<Invoice>({ filter: `customer = "${id}"`, sort: "-issued_at" }), []),
        safeFetch("Support tickets", () => pb.collection("support_tickets").getFullList<SupportTicket>({ filter: `customer = "${id}"`, sort: "-opened_at" }), []),
        safeFetch("Communications", () => pb.collection("conversations").getFullList<Conversation>({ filter: `customer = "${id}"`, sort: "-sent_at", expand: "author_employee" }), []),
        safeFetch("Agency relationship", () => pb.collection("agency_leads").getFullList<AgencyLead>({ filter: `customer = "${id}"` }), []),
        safeFetch("Activity", () => pb.collection("audit_logs").getFullList<AuditLog>({ filter: `affected_customer = "${id}"`, sort: "-occurred_at", expand: "actor_employee" }), []),
      ]);
      setData({ customer, subscriptions, invoices, tickets, conversations, agencyLeads, activity });
      setPartialErrors(errs);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load customer record.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function handleSuspend(reason: string) {
    await pb.send(`/api/customers/${id}/suspend`, { method: "POST", body: { reason } });
    await load();
  }

  async function handleReactivate(reason: string) {
    await pb.send(`/api/customers/${id}/reactivate`, { method: "POST", body: { reason } });
    await load();
  }

  async function handleImpersonate(reason: string) {
    const res = await pb.send<{ session_id: string; expires_at: string }>("/api/impersonation/start", {
      method: "POST",
      body: { customer_id: id, reason },
    });
    setImpersonationBanner({ expiresAt: res.expires_at, sessionId: res.session_id });
  }

  async function endImpersonation() {
    if (!impersonationBanner) return;
    await pb.send(`/api/impersonation/${impersonationBanner.sessionId}/end`, { method: "POST" });
    setImpersonationBanner(null);
  }

  if (loading) return <div className="loading-state">Loading customer record…</div>;
  if (error) {
    return (
      <div className="error-state">
        {error}
        <div style={{ marginTop: 10 }}>
          <button className="btn" onClick={load}>Retry</button>
        </div>
      </div>
    );
  }
  if (!data) return <div className="empty-state">Customer not found.</div>;

  const { customer, subscriptions, invoices, tickets, conversations, agencyLeads, activity } = data;
  const canEdit = hasPermission("customers.edit");
  const canImpersonate = hasPermission("customers.impersonate");

  return (
    <div>
      {impersonationBanner && (
        <div className="support-mode-banner">
          <span>
            SUPPORT MODE — viewing as {customer.name} · expires{" "}
            {new Date(impersonationBanner.expiresAt).toLocaleTimeString()}
          </span>
          <button className="btn" onClick={endImpersonation} style={{ padding: "0 8px" }}>
            End session
          </button>
        </div>
      )}

      <div className="page-header">
        <h1>{customer.name}</h1>
        <span className="page-header__meta">
          {customer.customer_code} · <StatusBadge status={customer.account_status} />
        </span>
      </div>

      {partialErrors.length > 0 && (
        <div className="panel" style={{ borderColor: "var(--status-warn)" }}>
          <div className="panel__title" style={{ color: "var(--status-warn)" }}>Some sections couldn't load</div>
          {partialErrors.map((e) => <div key={e}>{e}</div>)}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {canEdit && customer.account_status !== "suspended" && (
          <button className="btn btn--danger" onClick={() => setActiveDialog("suspend")}>
            Suspend account
          </button>
        )}
        {canEdit && customer.account_status === "suspended" && (
          <button className="btn btn--primary" onClick={() => setActiveDialog("reactivate")}>
            Reactivate account
          </button>
        )}
        {canImpersonate && !impersonationBanner && (
          <button className="btn" onClick={() => setActiveDialog("impersonate")}>
            View as customer
          </button>
        )}
      </div>

      <div className="panel">
        <div className="panel__title">Identity</div>
        <table className="data-table">
          <tbody>
            <tr><td style={{ color: "var(--text-muted)", width: 140 }}>Email</td><td>{customer.email}</td></tr>
            <tr><td style={{ color: "var(--text-muted)" }}>Phone</td><td>{customer.phone || "—"}</td></tr>
            <tr><td style={{ color: "var(--text-muted)" }}>Country</td><td>{customer.country || "—"}</td></tr>
            <tr><td style={{ color: "var(--text-muted)" }}>Company</td><td>{customer.expand?.organisation?.name ?? "—"}</td></tr>
            <tr><td style={{ color: "var(--text-muted)" }}>Type</td><td>{customer.customer_type.replace(/_/g, " ")}</td></tr>
            <tr><td style={{ color: "var(--text-muted)" }}>Assigned staff</td><td>{customer.expand?.assigned_staff?.full_name ?? "Unassigned"}</td></tr>
            <tr><td style={{ color: "var(--text-muted)" }}>Signup date</td><td>{customer.signup_date?.slice(0, 10) ?? "—"}</td></tr>
          </tbody>
        </table>
      </div>

      <div className="panel">
        <div className="panel__title">Subscriptions ({subscriptions.length})</div>
        {subscriptions.length === 0 ? (
          <div className="empty-state">No subscriptions.</div>
        ) : (
          <table className="data-table">
            <thead><tr><th>Code</th><th>Product</th><th>Plan</th><th>Status</th><th>MRR</th></tr></thead>
            <tbody>
              {subscriptions.map((s) => (
                <tr key={s.id}>
                  <td>{s.subscription_code}</td>
                  <td>{(s.expand?.product as { name?: string } | undefined)?.name ?? "—"}</td>
                  <td>{s.plan_name || "—"}</td>
                  <td><StatusBadge status={s.status} /></td>
                  <td>{formatCurrency(s.mrr_cents, s.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel">
        <div className="panel__title">Invoices ({invoices.length})</div>
        {invoices.length === 0 ? (
          <div className="empty-state">No invoices.</div>
        ) : (
          <table className="data-table">
            <thead><tr><th>Number</th><th>Amount</th><th>Status</th><th>Issued</th></tr></thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id}>
                  <td>{inv.invoice_number}</td>
                  <td>{formatCurrency(inv.amount_cents, inv.currency)}</td>
                  <td><StatusBadge status={inv.status} /></td>
                  <td>{inv.issued_at?.slice(0, 10) ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel">
        <div className="panel__title">Support history ({tickets.length})</div>
        {tickets.length === 0 ? (
          <div className="empty-state">No support tickets.</div>
        ) : (
          <table className="data-table">
            <thead><tr><th>Ticket</th><th>Subject</th><th>Priority</th><th>Status</th><th>Opened</th></tr></thead>
            <tbody>
              {tickets.map((t) => (
                <tr key={t.id}>
                  <td>{t.ticket_number}</td>
                  <td>{t.subject}</td>
                  <td><StatusBadge status={t.priority} /></td>
                  <td><StatusBadge status={t.status} /></td>
                  <td>{t.opened_at.slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel">
        <div className="panel__title">Communications ({conversations.length})</div>
        {conversations.length === 0 ? (
          <div className="empty-state">No logged communications.</div>
        ) : (
          <table className="data-table">
            <thead><tr><th>When</th><th>Channel</th><th>From</th><th>Message</th></tr></thead>
            <tbody>
              {conversations.map((c) => (
                <tr key={c.id}>
                  <td>{new Date(c.sent_at).toLocaleString()}</td>
                  <td>{c.channel ?? "—"}</td>
                  <td>{c.author_is_customer ? customer.name : c.expand?.author_employee?.full_name ?? "Staff"}</td>
                  <td>{stripHtml(c.body).slice(0, 140)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel">
        <div className="panel__title">Agency relationship ({agencyLeads.length})</div>
        {agencyLeads.length === 0 ? (
          <div className="empty-state">Not an agency customer.</div>
        ) : (
          <table className="data-table">
            <thead><tr><th>Engagement</th><th>Stage</th><th>Quoted</th></tr></thead>
            <tbody>
              {agencyLeads.map((a) => (
                <tr key={a.id}>
                  <td>{a.company_name}</td>
                  <td><StatusBadge status={a.stage} /></td>
                  <td>{a.quoted_amount_cents ? formatCurrency(a.quoted_amount_cents) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel">
        <div className="panel__title">External system references</div>
        <table className="data-table">
          <tbody>
            <tr><td style={{ color: "var(--text-muted)", width: 140 }}>Flow account</td><td>{customer.flow_account_id || "Not linked"}</td></tr>
            <tr><td style={{ color: "var(--text-muted)" }}>Chat account</td><td>{customer.chat_account_id || "Not linked"}</td></tr>
            <tr><td style={{ color: "var(--text-muted)" }}>Zoho contact</td><td>{customer.zoho_contact_id || "Not linked"}</td></tr>
          </tbody>
        </table>
        <p style={{ color: "var(--text-muted)", fontSize: 11, marginTop: 8 }}>
          These are reference IDs only, for cross-checking in the systems of
          record — Synkra OS does not duplicate Flow/Chat/Zoho as a source
          of truth. Usage metrics from Flow/Chat are not modeled here yet
          (no usage-ingestion pipeline exists); this section will show
          "usage" once one is built rather than displaying invented numbers.
        </p>
      </div>

      <div className="panel">
        <div className="panel__title">Activity ({activity.length})</div>
        {activity.length === 0 ? (
          <div className="empty-state">No administrative actions recorded for this customer.</div>
        ) : (
          <table className="data-table">
            <thead><tr><th>When</th><th>Action</th><th>By</th><th>Reason</th></tr></thead>
            <tbody>
              {activity.map((a) => (
                <tr key={a.id}>
                  <td>{new Date(a.occurred_at).toLocaleString()}</td>
                  <td>{a.action}</td>
                  <td>{a.expand?.actor_employee?.full_name ?? "—"}</td>
                  <td>{a.reason || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel">
        <div className="panel__title">Notes</div>
        <div style={{ whiteSpace: "pre-wrap", color: customer.notes ? "var(--off-white)" : "var(--text-muted)" }}>
          {customer.notes || "No notes on file."}
        </div>
      </div>

      {activeDialog === "suspend" && (
        <ConfirmActionDialog
          title="Suspend account"
          description={`This marks ${customer.name}'s account as suspended in Synkra OS's own records and is logged. It does NOT block their login or usage in Flow/Chat — real enforcement there requires a synkra-core endpoint that doesn't exist yet.`}
          confirmLabel="Suspend"
          danger
          onConfirm={handleSuspend}
          onClose={() => setActiveDialog(null)}
        />
      )}
      {activeDialog === "reactivate" && (
        <ConfirmActionDialog
          title="Reactivate account"
          description={`This will reactivate ${customer.name}'s account.`}
          confirmLabel="Reactivate"
          requireReason={false}
          onConfirm={handleReactivate}
          onClose={() => setActiveDialog(null)}
        />
      )}
      {activeDialog === "impersonate" && (
        <ConfirmActionDialog
          title="View as customer"
          description="Starts a temporary, fully audited Synkra OS support session (max 30 minutes, auto-expires) — it scopes what you view in this app, it does NOT log you into Flow/Chat as this customer. Real cross-product impersonation would need its own synkra-core endpoint, which doesn't exist yet. You will not gain access to passwords or secrets."
          confirmLabel="Start session"
          onConfirm={handleImpersonate}
          onClose={() => setActiveDialog(null)}
        />
      )}
    </div>
  );
}
