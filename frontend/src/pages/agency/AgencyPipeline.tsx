import { useEffect, useState } from "react";
import { pb } from "../../lib/pocketbase";
import { StatusBadge } from "../../components/StatusBadge";
import { ConfirmActionDialog } from "../../components/ConfirmActionDialog";
import { useAuth } from "../../auth/AuthContext";

interface AgencyLead {
  id: string;
  company_name: string;
  contact_name?: string;
  stage: string;
  service_slug?: string;
  tier?: string;
  quoted_amount_cents?: number;
  invoice?: string;
  manual_review_required?: boolean;
  manual_review_cleared_by?: string;
  expand?: { invoice?: { status: string } };
}

interface ServicePricing {
  service_slug: string;
  tier: string;
  monthly_price_rand: number;
  setup_price_rand: number;
  included_allowance_note?: string;
}

// Synkra's real service catalog, from the live website's Services section
// — not invented. Matches agency_leads.service_slug's enum values exactly.
const SERVICES = [
  { value: "ai_voice_agent", label: "AI Voice Agent" },
  { value: "speed_to_lead", label: "Speed to Lead" },
  { value: "lead_reactivation", label: "Lead Reactivation" },
  { value: "custom_ai_systems", label: "Custom AI Systems" },
];

const TIERS = [
  { value: "standard", label: "Standard" },
  { value: "growth", label: "Growth" },
  { value: "advanced", label: "Advanced" },
];

function formatRand(amount?: number | null): string {
  if (amount == null) return "—";
  return `R${amount.toLocaleString()}`;
}

const STAGE_ORDER = [
  "lead", "discovery", "qualification", "quotation", "invoiced", "paid",
  "onboarding", "information_collection", "onboarding_complete",
  "implementation", "ai_implementation", "internal_testing", "qa_qc",
  "client_testing", "deployment", "handover", "retainer",
];

const POST_PAYMENT_STAGES = new Set(STAGE_ORDER.slice(STAGE_ORDER.indexOf("onboarding")));

function formatCurrency(cents?: number): string {
  if (!cents) return "—";
  return `R${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export function AgencyPipelinePage() {
  const { hasPermission, employee } = useAuth();
  const [leads, setLeads] = useState<AgencyLead[]>([]);
  const [pricing, setPricing] = useState<ServicePricing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reviewTarget, setReviewTarget] = useState<AgencyLead | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [leadsResult, pricingResult] = await Promise.all([
        pb.collection("agency_leads").getFullList<AgencyLead>({ sort: "-created", expand: "invoice" }),
        pb.collection("agency_service_pricing").getFullList<ServicePricing>(),
      ]);
      setLeads(leadsResult);
      setPricing(pricingResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load agency pipeline.");
    } finally {
      setLoading(false);
    }
  }

  function rateFor(serviceSlug?: string, tier?: string): ServicePricing | undefined {
    if (!serviceSlug || !tier) return undefined;
    return pricing.find((p) => p.service_slug === serviceSlug && p.tier === tier);
  }

  useEffect(() => {
    load();
  }, []);

  async function advanceStage(lead: AgencyLead, nextStage: string) {
    setSavingId(lead.id);
    setActionError(null);
    try {
      await pb.collection("agency_leads").update(lead.id, { stage: nextStage });
      await load();
    } catch (err) {
      // Both the NO PAYMENT = NO ONBOARDING gate and the pricing-exception
      // manual-review gate live server-side
      // (pb_hooks/agency_transitions.pb.js) and reject this update with a
      // 422 and a clear message — surfaced here verbatim, not swallowed.
      setActionError(err instanceof Error ? err.message : "Stage change was rejected.");
      await load(); // refresh so a newly-set manual_review_required flag shows up
    } finally {
      setSavingId(null);
    }
  }

  async function setService(lead: AgencyLead, serviceSlug: string) {
    setSavingId(lead.id);
    setActionError(null);
    try {
      await pb.collection("agency_leads").update(lead.id, { service_slug: serviceSlug });
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to set service.");
    } finally {
      setSavingId(null);
    }
  }

  async function setTier(lead: AgencyLead, tier: string) {
    setSavingId(lead.id);
    setActionError(null);
    try {
      await pb.collection("agency_leads").update(lead.id, { tier });
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to set tier.");
    } finally {
      setSavingId(null);
    }
  }

  async function clearManualReview(notes: string) {
    if (!reviewTarget || !employee) return;
    await pb.collection("agency_leads").update(reviewTarget.id, {
      manual_review_required: false,
      manual_review_cleared_by: employee.id,
      manual_review_notes: notes,
    });
    await load();
  }

  if (loading) return <div className="loading-state">Loading pipeline…</div>;
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

  const grouped = STAGE_ORDER.map((stage) => ({
    stage,
    items: leads.filter((l) => l.stage === stage),
  })).filter((g) => g.items.length > 0);

  return (
    <div>
      <div className="page-header">
        <h1>Agency Operations</h1>
        <span className="page-header__meta">{leads.length} in pipeline</span>
      </div>

      {actionError && (
        <div className="panel" style={{ borderColor: "var(--status-error)" }}>
          <div className="panel__title" style={{ color: "var(--status-error)" }}>Transition blocked</div>
          {actionError}
        </div>
      )}

      {grouped.length === 0 ? (
        <div className="empty-state">No agency leads yet.</div>
      ) : (
        grouped.map(({ stage, items }) => (
          <div className="panel" key={stage}>
            <div className="panel__title">
              {stage.replace(/_/g, " ")} ({items.length})
              {POST_PAYMENT_STAGES.has(stage) && (
                <span style={{ color: "var(--lime)", marginLeft: 8, textTransform: "none", letterSpacing: 0 }}>
                  · post-payment
                </span>
              )}
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Contact</th>
                  <th>Service</th>
                  <th>Tier</th>
                  <th>Rate card</th>
                  <th>Quoted</th>
                  <th>Invoice status</th>
                  <th>Pricing review</th>
                  <th>Advance to</th>
                </tr>
              </thead>
              <tbody>
                {items.map((lead) => {
                  const idx = STAGE_ORDER.indexOf(lead.stage);
                  const nextStage = STAGE_ORDER[idx + 1];
                  const rate = rateFor(lead.service_slug, lead.tier);
                  return (
                    <tr key={lead.id}>
                      <td>{lead.company_name}</td>
                      <td>{lead.contact_name || "—"}</td>
                      <td>
                        {hasPermission("agency.manage") ? (
                          <select
                            className="field-input"
                            value={lead.service_slug || ""}
                            disabled={savingId === lead.id}
                            onChange={(e) => setService(lead, e.target.value)}
                          >
                            <option value="">Unset</option>
                            {SERVICES.map((s) => (
                              <option key={s.value} value={s.value}>{s.label}</option>
                            ))}
                          </select>
                        ) : (
                          SERVICES.find((s) => s.value === lead.service_slug)?.label || "—"
                        )}
                      </td>
                      <td>
                        {hasPermission("agency.manage") ? (
                          <select
                            className="field-input"
                            value={lead.tier || ""}
                            disabled={savingId === lead.id}
                            onChange={(e) => setTier(lead, e.target.value)}
                          >
                            <option value="">Unset</option>
                            {TIERS.map((t) => (
                              <option key={t.value} value={t.value}>{t.label}</option>
                            ))}
                          </select>
                        ) : (
                          TIERS.find((t) => t.value === lead.tier)?.label || "—"
                        )}
                      </td>
                      <td title={rate?.included_allowance_note}>
                        {rate ? `${formatRand(rate.monthly_price_rand)}/mo + ${formatRand(rate.setup_price_rand)} setup` : "—"}
                      </td>
                      <td>{formatCurrency(lead.quoted_amount_cents)}</td>
                      <td>{lead.expand?.invoice ? <StatusBadge status={lead.expand.invoice.status} /> : "No invoice"}</td>
                      <td>
                        {lead.manual_review_required ? (
                          hasPermission("agency.manage") ? (
                            <button className="btn btn--danger" onClick={() => setReviewTarget(lead)}>
                              Clear review
                            </button>
                          ) : (
                            <StatusBadge status="human_review" />
                          )
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        {nextStage ? (
                          <button
                            className="btn"
                            disabled={savingId === lead.id}
                            onClick={() => advanceStage(lead, nextStage)}
                          >
                            {savingId === lead.id ? "Working…" : nextStage.replace(/_/g, " ")}
                          </button>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))
      )}

      {reviewTarget && (
        <ConfirmActionDialog
          title="Clear manual pricing review"
          description={`${reviewTarget.company_name}'s quote (${formatCurrency(reviewTarget.quoted_amount_cents)}) exceeded the standard pricing ceiling. Confirming here records that you reviewed and approved it manually — this is logged.`}
          confirmLabel="Clear review"
          onConfirm={clearManualReview}
          onClose={() => setReviewTarget(null)}
        />
      )}
    </div>
  );
}
