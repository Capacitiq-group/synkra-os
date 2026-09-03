import { useEffect, useState } from "react";
import { pb } from "../../lib/pocketbase";
import { StatusBadge } from "../../components/StatusBadge";
import { ConfirmActionDialog } from "../../components/ConfirmActionDialog";

interface Lead {
  id: string;
  lead_code: string;
  name: string;
  company?: string;
  email?: string;
  source: string;
  status: string;
  priority?: string;
  lead_type?: string;
  next_follow_up_at?: string;
  conversion_status?: string;
}

const PIPELINE = ["new", "contacted", "qualified", "discovery", "proposal", "negotiation", "won", "lost", "nurture"];

const SOURCES = [
  "qr_code_generator", "link_shortener", "business_contact_page", "inquiry_form",
  "file_compressor", "file_converter", "csv_cleaner", "background_remover",
  "invoice_generator", "quotation_generator", "referral", "partner", "other_utility", "manual", "other",
];

function generateLeadCode(): string {
  return `LEAD-${Date.now().toString(36).toUpperCase()}`;
}

function NewLeadForm({ onCreated, onClose }: { onCreated: () => void; onClose: () => void }) {
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [source, setSource] = useState(SOURCES[SOURCES.length - 1]);
  const [leadType, setLeadType] = useState("product");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await pb.collection("leads").create({
        lead_code: generateLeadCode(),
        name: name.trim(),
        company: company.trim() || undefined,
        email: email.trim() || undefined,
        source,
        lead_type: leadType,
        status: "new",
        conversion_status: "not_converted",
      });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create lead.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>New lead</h2>
        <div className="field-row"><label>Name</label><input className="field-input" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="field-row"><label>Company</label><input className="field-input" value={company} onChange={(e) => setCompany(e.target.value)} /></div>
        <div className="field-row"><label>Email</label><input className="field-input" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div className="field-row">
          <label>Source</label>
          <select className="field-input" value={source} onChange={(e) => setSource(e.target.value)}>
            {SOURCES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
          </select>
        </div>
        <div className="field-row">
          <label>Lead type</label>
          <select className="field-input" value={leadType} onChange={(e) => setLeadType(e.target.value)}>
            <option value="product">Product</option>
            <option value="agency">Agency</option>
            <option value="partnership">Partnership</option>
            <option value="other">Other</option>
          </select>
        </div>
        {error && <div className="error-state" style={{ padding: "8px 0" }}>{error}</div>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
          <button className="btn" onClick={onClose} disabled={submitting}>Cancel</button>
          <button className="btn btn--primary" onClick={handleSubmit} disabled={submitting}>
            {submitting ? "Creating…" : "Create lead"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [followUpTarget, setFollowUpTarget] = useState<Lead | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const result = await pb.collection("leads").getFullList<Lead>({ sort: "-created" });
      setLeads(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load leads.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function advanceStatus(lead: Lead, nextStatus: string) {
    setSavingId(lead.id);
    try {
      await pb.collection("leads").update(lead.id, { status: nextStatus });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update lead.");
    } finally {
      setSavingId(null);
    }
  }

  async function scheduleFollowUp(notes: string) {
    if (!followUpTarget) return;
    const dueAt = new Date();
    dueAt.setDate(dueAt.getDate() + 1); // default: tomorrow; adjustable on the Follow-ups page
    await pb.collection("follow_ups").create({
      lead: followUpTarget.id,
      due_at: dueAt.toISOString(),
      follow_up_type: "email",
      status: "pending",
      priority: "medium",
      notes,
    });
    await pb.collection("leads").update(followUpTarget.id, { next_follow_up_at: dueAt.toISOString() });
    await load();
  }

  if (loading) return <div className="loading-state">Loading leads…</div>;
  if (error) {
    return (
      <div className="error-state">
        {error}
        <div style={{ marginTop: 10 }}><button className="btn" onClick={load}>Retry</button></div>
      </div>
    );
  }

  const grouped = PIPELINE.map((status) => ({ status, items: leads.filter((l) => l.status === status) }));

  return (
    <div>
      <div className="page-header">
        <h1>Leads</h1>
        <span className="page-header__meta">{leads.length} total</span>
      </div>

      <div style={{ marginBottom: 14 }}>
        <button className="btn btn--primary" onClick={() => setShowCreate(true)}>New lead</button>
      </div>

      {grouped.filter((g) => g.items.length > 0).length === 0 ? (
        <div className="empty-state">No leads yet.</div>
      ) : (
        grouped
          .filter((g) => g.items.length > 0)
          .map(({ status, items }) => (
            <div className="panel" key={status}>
              <div className="panel__title">{status.replace(/_/g, " ")} ({items.length})</div>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Name</th><th>Company</th><th>Source</th><th>Type</th>
                    <th>Next follow-up</th><th>Conversion</th><th>Advance</th><th>Follow-up</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((lead) => {
                    const idx = PIPELINE.indexOf(lead.status);
                    const nextStatus = idx < PIPELINE.length - 1 && lead.status !== "won" && lead.status !== "lost" ? PIPELINE[idx + 1] : null;
                    return (
                      <tr key={lead.id}>
                        <td>{lead.name}</td>
                        <td>{lead.company || "—"}</td>
                        <td>{lead.source.replace(/_/g, " ")}</td>
                        <td>{lead.lead_type || "—"}</td>
                        <td>{lead.next_follow_up_at ? new Date(lead.next_follow_up_at).toLocaleDateString() : "—"}</td>
                        <td>{lead.conversion_status ? <StatusBadge status={lead.conversion_status} /> : "—"}</td>
                        <td>
                          {nextStatus ? (
                            <button className="btn" disabled={savingId === lead.id} onClick={() => advanceStatus(lead, nextStatus)}>
                              {nextStatus.replace(/_/g, " ")}
                            </button>
                          ) : "—"}
                        </td>
                        <td>
                          <button className="btn" onClick={() => setFollowUpTarget(lead)}>Schedule</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))
      )}

      {showCreate && <NewLeadForm onCreated={load} onClose={() => setShowCreate(false)} />}
      {followUpTarget && (
        <ConfirmActionDialog
          title={`Schedule follow-up for ${followUpTarget.name}`}
          description="Creates a pending follow-up due tomorrow — adjust the exact date on the Follow-ups page."
          confirmLabel="Schedule"
          requireReason={false}
          onConfirm={scheduleFollowUp}
          onClose={() => setFollowUpTarget(null)}
        />
      )}
    </div>
  );
}
