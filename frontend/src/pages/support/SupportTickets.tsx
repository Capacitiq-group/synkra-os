import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { pb } from "../../lib/pocketbase";
import { DataTable, Column } from "../../components/DataTable";
import { StatusBadge } from "../../components/StatusBadge";
import type { SupportTicket, Customer } from "../../types/models";

const STATUS_FILTERS = [
  { value: "", label: "All" },
  { value: "open", label: "Open" },
  { value: "ai_investigating", label: "AI Investigating" },
  { value: "waiting_on_customer", label: "Waiting for Customer" },
  { value: "human_review", label: "Human Review" },
  { value: "in_progress", label: "In Progress" },
  { value: "resolved", label: "Resolved" },
  { value: "closed", label: "Closed" },
];

const CATEGORIES = ["billing", "technical", "account", "feature_request", "other"];
const PRIORITIES = ["low", "medium", "high", "urgent"];

function generateTicketNumber(): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `TKT-${timestamp}-${random}`;
}

function NewTicketForm({ onCreated, onClose }: { onCreated: () => void; onClose: () => void }) {
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerOptions, setCustomerOptions] = useState<Customer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [priority, setPriority] = useState(PRIORITIES[1]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (customerQuery.trim().length < 2 || selectedCustomer) {
      setCustomerOptions([]);
      return;
    }
    const timeout = setTimeout(async () => {
      try {
        const result = await pb.collection("customers").getList<Customer>(1, 5, {
          filter: `name ~ "${customerQuery.trim()}" || email ~ "${customerQuery.trim()}"`,
        });
        setCustomerOptions(result.items);
      } catch {
        setCustomerOptions([]);
      }
    }, 250);
    return () => clearTimeout(timeout);
  }, [customerQuery, selectedCustomer]);

  async function handleSubmit() {
    if (!selectedCustomer) {
      setError("Select a customer first.");
      return;
    }
    if (!subject.trim()) {
      setError("Subject is required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await pb.collection("support_tickets").create({
        ticket_number: generateTicketNumber(),
        customer: selectedCustomer.id,
        subject: subject.trim(),
        category,
        priority,
        status: "open",
        opened_at: new Date().toISOString(),
      });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create ticket.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ width: 440 }} onClick={(e) => e.stopPropagation()}>
        <h2>New support ticket</h2>

        <div className="field-row">
          <label>Customer</label>
          {selectedCustomer ? (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>{selectedCustomer.name} ({selectedCustomer.email})</span>
              <button className="btn" onClick={() => setSelectedCustomer(null)}>Change</button>
            </div>
          ) : (
            <>
              <input
                className="field-input"
                placeholder="Search by name or email…"
                value={customerQuery}
                onChange={(e) => setCustomerQuery(e.target.value)}
              />
              {customerOptions.length > 0 && (
                <div style={{ border: "1px solid var(--border-color)", marginTop: 4 }}>
                  {customerOptions.map((c) => (
                    <div
                      key={c.id}
                      style={{ padding: "6px 8px", cursor: "pointer" }}
                      onClick={() => {
                        setSelectedCustomer(c);
                        setCustomerOptions([]);
                      }}
                    >
                      {c.name} <span style={{ color: "var(--text-muted)" }}>{c.email}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div className="field-row">
          <label>Subject</label>
          <input className="field-input" value={subject} onChange={(e) => setSubject(e.target.value)} />
        </div>

        <div className="field-row">
          <label>Category</label>
          <select className="field-input" value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c.replace(/_/g, " ")}</option>
            ))}
          </select>
        </div>

        <div className="field-row">
          <label>Priority</label>
          <select className="field-input" value={priority} onChange={(e) => setPriority(e.target.value)}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>

        {error && <div className="error-state" style={{ padding: "8px 0" }}>{error}</div>}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
          <button className="btn" onClick={onClose} disabled={submitting}>Cancel</button>
          <button className="btn btn--primary" onClick={handleSubmit} disabled={submitting}>
            {submitting ? "Creating…" : "Create ticket"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function SupportTicketsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [statusFilter, setStatusFilter] = useState("");
  const [rows, setRows] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(searchParams.get("create") === "1");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const filter = statusFilter ? `status = "${statusFilter}"` : "";
      const result = await pb.collection("support_tickets").getList<SupportTicket>(1, 100, {
        filter,
        sort: "-opened_at",
        expand: "customer,assignee",
      });
      setRows(result.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tickets.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  useEffect(() => {
    if (searchParams.get("create") === "1") {
      setShowCreate(true);
      searchParams.delete("create");
      setSearchParams(searchParams, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const columns: Column<SupportTicket>[] = [
    { header: "Ticket", render: (t) => t.ticket_number, width: "100px" },
    { header: "Customer", render: (t) => t.expand?.customer?.name ?? "—" },
    { header: "Subject", render: (t) => t.subject },
    { header: "Priority", render: (t) => <StatusBadge status={t.priority} /> },
    { header: "Status", render: (t) => <StatusBadge status={t.status} /> },
    { header: "AI involved", render: (t) => (t.ai_involved ? "Yes" : "No") },
    { header: "Assignee", render: (t) => t.expand?.assignee?.full_name ?? "Unassigned" },
    { header: "Opened", render: (t) => t.opened_at.slice(0, 10) },
  ];

  return (
    <div>
      <div className="page-header">
        <h1>Support</h1>
        <span className="page-header__meta">{rows.length} shown</span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
        <select className="field-input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          {STATUS_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
        </select>
        <button className="btn btn--primary" onClick={() => setShowCreate(true)}>
          New ticket
        </button>
      </div>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(t) => t.id}
        loading={loading}
        error={error}
        emptyMessage="No tickets match this filter."
        onRetry={load}
      />
      {showCreate && <NewTicketForm onCreated={load} onClose={() => setShowCreate(false)} />}
    </div>
  );
}
