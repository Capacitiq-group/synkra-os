import { useEffect, useState } from "react";
import { pb } from "../lib/pocketbase";
import { StatusBadge } from "../components/StatusBadge";
import { SourceTag, useIntegrationStatuses } from "../lib/integrations";

interface DashboardData {
  activeCustomers: number;
  newCustomersThisMonth: number;
  activeSubscriptions: number;
  pastDueSubscriptions: number;
  mrrCents: number;
  openTickets: number;
  urgentTickets: number;
  openIncidents: number;
  serversDown: number;
  serversTotal: number;
  newLeads: number;
  overdueFollowUps: number;
  aiJobsRunning: number;
  aiJobsFailed: number;
  aiReviewQueue: number;
}

const emptyData: DashboardData = {
  activeCustomers: 0, newCustomersThisMonth: 0, activeSubscriptions: 0, pastDueSubscriptions: 0,
  mrrCents: 0, openTickets: 0, urgentTickets: 0, openIncidents: 0, serversDown: 0, serversTotal: 0,
  newLeads: 0, overdueFollowUps: 0, aiJobsRunning: 0, aiJobsFailed: 0, aiReviewQueue: 0,
};

function formatCurrency(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export function DashboardPage() {
  const { statuses } = useIntegrationStatuses();
  const [data, setData] = useState<DashboardData>(emptyData);
  const [flowSubscriberCount, setFlowSubscriberCount] = useState<number | "unavailable" | "loading">("loading");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);
      const now = new Date().toISOString();

      const [
        activeCustomers, newCustomers, activeSubs, pastDueSubs,
        openTickets, urgentTickets, openIncidents,
        newLeads, overdueFollowUps, aiRunning, aiFailed, aiReview,
      ] = await Promise.all([
        pb.collection("customers").getList(1, 1, { filter: "account_status = 'active'" }),
        pb.collection("customers").getList(1, 1, { filter: `signup_date >= "${startOfMonth.toISOString().slice(0, 10)}"` }),
        pb.collection("subscriptions").getList(1, 200, { filter: "status = 'active'" }),
        pb.collection("subscriptions").getList(1, 1, { filter: "status = 'past_due'" }),
        pb.collection("support_tickets").getList(1, 1, { filter: "status != 'resolved' && status != 'closed'" }),
        pb.collection("support_tickets").getList(1, 1, { filter: "priority = 'urgent' && status != 'resolved' && status != 'closed'" }),
        pb.collection("incidents").getList(1, 1, { filter: "status != 'resolved' && status != 'closed'" }).catch(() => ({ totalItems: 0 })),
        pb.collection("leads").getList(1, 1, { filter: "status = 'new'" }).catch(() => ({ totalItems: 0 })),
        pb.collection("follow_ups").getList(1, 1, { filter: `status = 'pending' && due_at < "${now}"` }).catch(() => ({ totalItems: 0 })),
        pb.collection("ai_jobs").getList(1, 1, { filter: "status = 'running'" }).catch(() => ({ totalItems: 0 })),
        pb.collection("ai_jobs").getList(1, 1, { filter: "status = 'failed'" }).catch(() => ({ totalItems: 0 })),
        pb.collection("ai_jobs").getList(1, 1, { filter: "status = 'escalated' && human_review_required = true" }).catch(() => ({ totalItems: 0 })),
      ]);

      let serversDown = 0;
      let serversTotal = 0;
      try {
        const servers = await pb.collection("servers").getFullList();
        serversTotal = servers.length;
        serversDown = servers.filter((s) => s.status === "down").length;
      } catch {
        // no infrastructure.view permission or nothing reporting yet
      }

      const mrrCents = activeSubs.items.reduce((sum, s) => sum + (s.mrr_cents as number), 0);

      setData({
        activeCustomers: activeCustomers.totalItems,
        newCustomersThisMonth: newCustomers.totalItems,
        activeSubscriptions: activeSubs.totalItems,
        pastDueSubscriptions: pastDueSubs.totalItems,
        mrrCents,
        openTickets: openTickets.totalItems,
        urgentTickets: urgentTickets.totalItems,
        openIncidents: (openIncidents as { totalItems: number }).totalItems,
        serversDown,
        serversTotal,
        newLeads: (newLeads as { totalItems: number }).totalItems,
        overdueFollowUps: (overdueFollowUps as { totalItems: number }).totalItems,
        aiJobsRunning: (aiRunning as { totalItems: number }).totalItems,
        aiJobsFailed: (aiFailed as { totalItems: number }).totalItems,
        aiReviewQueue: (aiReview as { totalItems: number }).totalItems,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load dashboard data.");
    } finally {
      setLoading(false);
    }
  }

  async function loadFlow() {
    try {
      const res = await pb.send<{ items: { status?: string }[] }>("/api/flow/subscriptions", { method: "GET" });
      setFlowSubscriberCount(res.items.filter((s) => s.status === "active").length);
    } catch {
      setFlowSubscriberCount("unavailable");
    }
  }

  useEffect(() => {
    load();
    loadFlow();
  }, []);

  if (loading) return <div className="loading-state">Loading dashboard…</div>;
  if (error) {
    return (
      <div className="error-state">
        {error}
        <div style={{ marginTop: 10 }}><button className="btn" onClick={load}>Retry</button></div>
      </div>
    );
  }

  const infraOk = data.serversTotal === 0 || data.serversDown === 0;
  const flowStatus = statuses["flow"]?.status;

  return (
    <div>
      <div className="page-header">
        <h1>Executive Dashboard</h1>
        <span className="page-header__meta">
          Is Synkra okay right now?{" "}
          <StatusBadge status={infraOk && data.openIncidents === 0 ? "healthy" : "degraded"} />
        </span>
      </div>

      <div className="panel">
        <div className="panel__title">Business <SourceTag source="Synkra OS" /></div>
        <div className="kpi-row">
          <div className="kpi"><div className="kpi__value">{data.activeCustomers}</div><div className="kpi__label">Active customers</div></div>
          <div className="kpi"><div className="kpi__value">{data.newCustomersThisMonth}</div><div className="kpi__label">New this month</div></div>
          <div className="kpi"><div className="kpi__value">{data.activeSubscriptions}</div><div className="kpi__label">Active subscriptions</div></div>
          <div className="kpi"><div className={`kpi__value ${data.pastDueSubscriptions > 0 ? "kpi__value--warn" : ""}`}>{data.pastDueSubscriptions}</div><div className="kpi__label">Past-due subscriptions</div></div>
          <div className="kpi"><div className="kpi__value">{formatCurrency(data.mrrCents)}</div><div className="kpi__label">MRR (OS-tracked subs)</div></div>
        </div>
      </div>

      <div className="panel">
        <div className="panel__title">Products <SourceTag source="Flow" /></div>
        <div className="kpi-row">
          <div className="kpi">
            {flowSubscriberCount === "loading" ? (
              <div className="kpi__value" style={{ color: "var(--text-muted)" }}>…</div>
            ) : flowSubscriberCount === "unavailable" || flowStatus === "not_configured" ? (
              <div className="kpi__value" style={{ fontSize: 13, color: "var(--text-muted)" }}>
                {flowStatus === "not_configured" ? "Not configured" : "Unavailable"}
              </div>
            ) : (
              <div className="kpi__value kpi__value--ok">{flowSubscriberCount}</div>
            )}
            <div className="kpi__label">Flow active subscribers</div>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel__title">Leads &amp; Follow-ups <SourceTag source="Synkra OS" /></div>
        <div className="kpi-row">
          <div className="kpi"><div className="kpi__value">{data.newLeads}</div><div className="kpi__label">New leads</div></div>
          <div className="kpi"><div className={`kpi__value ${data.overdueFollowUps > 0 ? "kpi__value--error" : "kpi__value--ok"}`}>{data.overdueFollowUps}</div><div className="kpi__label">Overdue follow-ups</div></div>
        </div>
      </div>

      <div className="panel">
        <div className="panel__title">Support <SourceTag source="Synkra OS" /></div>
        <div className="kpi-row">
          <div className="kpi"><div className={`kpi__value ${data.openTickets > 0 ? "kpi__value--warn" : "kpi__value--ok"}`}>{data.openTickets}</div><div className="kpi__label">Open tickets</div></div>
          <div className="kpi"><div className={`kpi__value ${data.urgentTickets > 0 ? "kpi__value--error" : "kpi__value--ok"}`}>{data.urgentTickets}</div><div className="kpi__label">Urgent, unresolved</div></div>
        </div>
      </div>

      <div className="panel">
        <div className="panel__title">AI <SourceTag source="Synkra OS" /></div>
        <div className="kpi-row">
          <div className="kpi"><div className="kpi__value">{data.aiJobsRunning}</div><div className="kpi__label">Jobs running</div></div>
          <div className="kpi"><div className={`kpi__value ${data.aiJobsFailed > 0 ? "kpi__value--error" : "kpi__value--ok"}`}>{data.aiJobsFailed}</div><div className="kpi__label">Failed jobs</div></div>
          <div className="kpi"><div className={`kpi__value ${data.aiReviewQueue > 0 ? "kpi__value--warn" : "kpi__value--ok"}`}>{data.aiReviewQueue}</div><div className="kpi__label">Awaiting human review</div></div>
        </div>
      </div>

      <div className="panel">
        <div className="panel__title">Infrastructure &amp; Incidents <SourceTag source="Synkra OS" /></div>
        <div className="kpi-row">
          <div className="kpi"><div className={`kpi__value ${data.openIncidents > 0 ? "kpi__value--error" : "kpi__value--ok"}`}>{data.openIncidents}</div><div className="kpi__label">Open incidents</div></div>
          <div className="kpi">
            <div className={`kpi__value ${data.serversDown > 0 ? "kpi__value--error" : "kpi__value--ok"}`}>
              {data.serversTotal === 0 ? "—" : `${data.serversTotal - data.serversDown}/${data.serversTotal}`}
            </div>
            <div className="kpi__label">{data.serversTotal === 0 ? "No servers reporting yet" : "Servers healthy"}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
