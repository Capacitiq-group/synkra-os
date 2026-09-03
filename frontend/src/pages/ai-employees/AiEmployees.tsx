import { useEffect, useState } from "react";
import { pb } from "../../lib/pocketbase";
import { DataTable, Column } from "../../components/DataTable";
import { StatusBadge } from "../../components/StatusBadge";
import { ConfirmActionDialog } from "../../components/ConfirmActionDialog";
import { useAuth } from "../../auth/AuthContext";

interface AiEmployee {
  id: string;
  name: string;
  function: string;
  model: string;
  status: string;
  permitted_actions?: string[];
  connected_systems?: string[];
  cost_cents_month?: number;
  success_rate_pct?: number;
  escalation_rate_pct?: number;
  avg_execution_ms?: number;
  last_active_at?: string;
}

interface AiJob {
  id: string;
  ai_employee: string;
  task: string;
  status: string;
  human_review_required?: boolean;
  approved?: boolean;
  rejected?: boolean;
  cost_cents?: number;
  error?: string;
  expand?: { ai_employee?: { name: string } };
}

export function AiEmployeesPage() {
  const { hasPermission } = useAuth();
  const [employees, setEmployees] = useState<AiEmployee[]>([]);
  const [jobs, setJobs] = useState<AiJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reviewTarget, setReviewTarget] = useState<{ job: AiJob; decision: "approve" | "reject" } | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [employeesRes, jobsRes] = await Promise.all([
        pb.collection("ai_employees").getFullList<AiEmployee>({ sort: "name" }),
        pb.collection("ai_jobs").getList<AiJob>(1, 100, { sort: "-created", expand: "ai_employee" }),
      ]);
      setEmployees(employeesRes);
      setJobs(jobsRes.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load AI employee data.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function submitReview(notes: string) {
    if (!reviewTarget) return;
    await pb.send(`/api/ai-jobs/${reviewTarget.job.id}/review`, {
      method: "POST",
      body: { decision: reviewTarget.decision, notes },
    });
    await load();
  }

  const employeeColumns: Column<AiEmployee>[] = [
    { header: "Name", render: (a) => a.name },
    { header: "Function", render: (a) => a.function.replace(/_/g, " ") },
    { header: "Model", render: (a) => a.model },
    { header: "Status", render: (a) => <StatusBadge status={a.status} /> },
    { header: "Permitted actions", render: (a) => (a.permitted_actions?.length ? a.permitted_actions.join(", ") : "None granted") },
    { header: "Connected systems", render: (a) => (a.connected_systems?.length ? a.connected_systems.join(", ") : "None") },
    { header: "Success rate", render: (a) => (a.success_rate_pct != null ? `${a.success_rate_pct}%` : "—") },
    { header: "Escalation rate", render: (a) => (a.escalation_rate_pct != null ? `${a.escalation_rate_pct}%` : "—") },
    { header: "Cost / month", render: (a) => (a.cost_cents_month != null ? `$${(a.cost_cents_month / 100).toLocaleString()}` : "—") },
    { header: "Last active", render: (a) => (a.last_active_at ? new Date(a.last_active_at).toLocaleString() : "—") },
  ];

  const reviewQueue = jobs.filter((j) => j.status === "escalated" && j.human_review_required && !j.approved && !j.rejected);

  const jobColumns: Column<AiJob>[] = [
    { header: "AI employee", render: (j) => j.expand?.ai_employee?.name ?? "—" },
    { header: "Task", render: (j) => j.task },
    { header: "Status", render: (j) => <StatusBadge status={j.status} /> },
    { header: "Cost", render: (j) => (j.cost_cents != null ? `$${(j.cost_cents / 100).toFixed(2)}` : "—") },
    { header: "Error", render: (j) => j.error || "—" },
  ];

  const reviewColumns: Column<AiJob>[] = [
    { header: "AI employee", render: (j) => j.expand?.ai_employee?.name ?? "—" },
    { header: "Task", render: (j) => j.task },
    {
      header: "Decision",
      render: (j) =>
        hasPermission("ai.approve") ? (
          <div style={{ display: "flex", gap: 6 }}>
            <button className="btn btn--primary" onClick={() => setReviewTarget({ job: j, decision: "approve" })}>Approve</button>
            <button className="btn btn--danger" onClick={() => setReviewTarget({ job: j, decision: "reject" })}>Reject</button>
          </div>
        ) : (
          <StatusBadge status="human_review" />
        ),
    },
  ];

  return (
    <div>
      <div className="page-header">
        <h1>AI Employees</h1>
        <span className="page-header__meta">{employees.length} configured</span>
      </div>

      <div className="panel">
        <div className="panel__title">
          Human review queue ({reviewQueue.length})
        </div>
        <p style={{ color: "var(--text-muted)", fontSize: 11, marginTop: 0 }}>
          Jobs an AI employee flagged as requiring approval before their
          result takes effect. Approving here only records the decision —
          any actual mutation (a refund, an account change) still goes
          through that module's own permissioned route, never directly
          from AI output.
        </p>
        <DataTable
          columns={reviewColumns}
          rows={reviewQueue}
          rowKey={(j) => j.id}
          loading={loading}
          error={error}
          emptyMessage="Nothing pending review."
        />
      </div>

      <div className="panel">
        <div className="panel__title">Employees</div>
        <DataTable
          columns={employeeColumns}
          rows={employees}
          rowKey={(a) => a.id}
          loading={loading}
          error={error}
          emptyMessage="No AI employees configured yet."
          onRetry={load}
        />
      </div>

      <div className="panel">
        <div className="panel__title">Recent jobs</div>
        <DataTable
          columns={jobColumns}
          rows={jobs}
          rowKey={(j) => j.id}
          loading={loading}
          error={error}
          emptyMessage="No jobs yet — jobs are created via /api/ai-jobs/submit and updated by the Python worker via /api/ai-jobs/:id/result."
        />
      </div>

      {reviewTarget && (
        <ConfirmActionDialog
          title={reviewTarget.decision === "approve" ? "Approve AI job" : "Reject AI job"}
          description={`This records your decision on "${reviewTarget.job.task}". It does not itself execute anything.`}
          confirmLabel={reviewTarget.decision === "approve" ? "Approve" : "Reject"}
          danger={reviewTarget.decision === "reject"}
          requireReason={false}
          onConfirm={submitReview}
          onClose={() => setReviewTarget(null)}
        />
      )}
    </div>
  );
}
