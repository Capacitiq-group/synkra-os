import { useEffect, useState } from "react";
import { pb } from "../../lib/pocketbase";
import { DataTable, Column } from "../../components/DataTable";
import { StatusBadge } from "../../components/StatusBadge";

interface FollowUp {
  id: string;
  lead?: string;
  customer?: string;
  assigned_employee?: string;
  due_at: string;
  follow_up_type: string;
  status: string;
  priority?: string;
  notes?: string;
  expand?: {
    lead?: { name: string };
    customer?: { name: string };
    assigned_employee?: { full_name: string };
  };
}

type ViewKey = "due_today" | "overdue" | "upcoming" | "completed" | "unassigned";

const VIEWS: { key: ViewKey; label: string }[] = [
  { key: "overdue", label: "Overdue" },
  { key: "due_today", label: "Due today" },
  { key: "upcoming", label: "Upcoming" },
  { key: "unassigned", label: "Unassigned" },
  { key: "completed", label: "Completed" },
];

export function FollowUpsPage() {
  const [view, setView] = useState<ViewKey>("overdue");
  const [rows, setRows] = useState<FollowUp[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const result = await pb.collection("follow_ups").getFullList<FollowUp>({
        sort: "due_at",
        expand: "lead,customer,assigned_employee",
      });
      setRows(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load follow-ups.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function markCompleted(followUp: FollowUp) {
    setSavingId(followUp.id);
    try {
      await pb.collection("follow_ups").update(followUp.id, {
        status: "completed",
        completed_at: new Date().toISOString(),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update follow-up.");
    } finally {
      setSavingId(null);
    }
  }

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfToday = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000);

  const filtered = rows.filter((f) => {
    const due = new Date(f.due_at);
    switch (view) {
      case "overdue":
        return f.status === "pending" && due < startOfToday;
      case "due_today":
        return f.status === "pending" && due >= startOfToday && due < endOfToday;
      case "upcoming":
        return f.status === "pending" && due >= endOfToday;
      case "unassigned":
        return f.status === "pending" && !f.assigned_employee;
      case "completed":
        return f.status === "completed";
      default:
        return true;
    }
  });

  const columns: Column<FollowUp>[] = [
    { header: "Due", render: (f) => new Date(f.due_at).toLocaleString() },
    { header: "Related to", render: (f) => f.expand?.lead?.name || f.expand?.customer?.name || "—" },
    { header: "Type", render: (f) => f.follow_up_type.replace(/_/g, " ") },
    { header: "Priority", render: (f) => (f.priority ? <StatusBadge status={f.priority} /> : "—") },
    { header: "Assigned", render: (f) => f.expand?.assigned_employee?.full_name ?? "Unassigned" },
    { header: "Notes", render: (f) => f.notes || "—" },
    {
      header: "Action",
      render: (f) =>
        f.status === "pending" ? (
          <button className="btn" disabled={savingId === f.id} onClick={() => markCompleted(f)}>
            {savingId === f.id ? "Working…" : "Mark completed"}
          </button>
        ) : (
          <StatusBadge status={f.status} />
        ),
    },
  ];

  return (
    <div>
      <div className="page-header">
        <h1>Follow-ups</h1>
        <span className="page-header__meta">{filtered.length} shown</span>
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {VIEWS.map((v) => (
          <button key={v.key} className={`btn ${view === v.key ? "btn--primary" : ""}`} onClick={() => setView(v.key)}>
            {v.label}
          </button>
        ))}
      </div>
      <DataTable
        columns={columns}
        rows={filtered}
        rowKey={(f) => f.id}
        loading={loading}
        error={error}
        emptyMessage="Nothing in this view."
        onRetry={load}
      />
    </div>
  );
}
