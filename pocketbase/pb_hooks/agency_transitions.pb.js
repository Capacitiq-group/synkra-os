/// <reference path="../pb_data/types.d.ts" />

// Full agency lifecycle order, used to detect "is this transition moving
// forward past X" without hardcoding pairwise transitions.
const STAGE_ORDER = [
  "lead", "discovery", "qualification", "quotation", "invoiced", "paid",
  "onboarding", "information_collection", "onboarding_complete",
  "implementation", "ai_implementation", "internal_testing", "qa_qc",
  "client_testing", "deployment", "handover", "retainer",
];

// Stages that come at/after onboarding — none of these may be entered
// unless the linked invoice is paid.
const POST_PAYMENT_STAGES = new Set(STAGE_ORDER.slice(STAGE_ORDER.indexOf("onboarding")));

const QUOTATION_INDEX = STAGE_ORDER.indexOf("quotation");

// Standard pricing ceiling: quotes above this amount are outside the
// pricing rules the platform can safely auto-approve. This number is a
// business decision Synkra needs to set (not something inferable from the
// spec text alone) — configure it via AGENCY_STANDARD_PRICING_CEILING_CENTS.
// Until set, this defaults to "no ceiling" (feature effectively off) rather
// than guessing a number that doesn't reflect real Synkra pricing policy.
function getPricingCeilingCents() {
  const raw = $os.getenv("AGENCY_STANDARD_PRICING_CEILING_CENTS");
  const parsed = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

onRecordUpdateRequest("agency_leads").bindFunc((e) => {
  const oldStage = e.record.original().get("stage");
  const newStage = e.record.get("stage");
  const movingForward = STAGE_ORDER.indexOf(newStage) > STAGE_ORDER.indexOf(oldStage);

  // ---- Gate 1: NO PAYMENT = NO ONBOARDING --------------------------------
  if (oldStage !== newStage && POST_PAYMENT_STAGES.has(newStage)) {
    const invoiceId = e.record.get("invoice");
    if (!invoiceId) {
      throw new ApiError(422, "Cannot move into onboarding or later: no invoice is linked to this lead.");
    }
    const invoice = findOrNotFound(e.app, "invoices", invoiceId, "Invoice");
    if (invoice.get("status") !== "paid") {
      throw new ApiError(422, `Cannot move into "${newStage}": linked invoice is "${invoice.get("status")}", not paid. This transition is blocked by policy (NO PAYMENT = NO ONBOARDING), not by a UI restriction — it cannot be bypassed from the client.`);
    }
  }

  // ---- Gate 2: pricing-exception manual review ---------------------------
  // A quote above the standard ceiling must be explicitly reviewed
  // (manual_review_cleared_by set) before the lead can move past
  // "quotation" — the system never silently treats an out-of-policy quote
  // as auto-approved just because someone changed the stage field.
  const ceiling = getPricingCeilingCents();
  const quotedAmount = e.record.get("quoted_amount_cents");
  const movingPastQuotation = STAGE_ORDER.indexOf(newStage) > QUOTATION_INDEX;
  if (movingForward && movingPastQuotation && ceiling != null && quotedAmount > ceiling) {
    const reviewCleared = !!e.record.get("manual_review_cleared_by");
    if (!reviewCleared) {
      // Flag it on a freshly-fetched copy of the stored record — NOT on
      // e.record, which already has this request's (rejected) field
      // changes merged in and would persist the illegal stage change too
      // if saved directly.
      const stored = findOrNotFound(e.app, "agency_leads", e.record.id, "Agency lead");
      stored.set("manual_review_required", true);
      e.app.save(stored);
      throw new ApiError(
        422,
        `This quote ($${(quotedAmount / 100).toLocaleString()}) exceeds the standard pricing ceiling and requires manual review before proceeding. Set manual_review_cleared_by (and manual_review_notes) first — this cannot be bypassed by changing the stage directly.`
      );
    }
  }

  e.next();

  if (oldStage !== newStage) {
    const authRecord = e.auth;
    const employeeId = authRecord ? authRecord.get("employee") : null;
    if (employeeId) {
      writeAuditLog(e.app, {
        actorEmployeeId: employeeId,
        action: "agency_lead.stage_change",
        affectedCollection: "agency_leads",
        affectedRecordId: e.record.id,
        affectedCustomerId: e.record.get("customer") || null,
        previousValue: { stage: oldStage },
        newValue: { stage: newStage },
      });
    }
  }

  // The moment this lead FIRST crosses into "onboarding" (payment already
  // confirmed by Gate 1 above), provision the real client record on the
  // dedicated Agency PocketBase instance — see
  // pb_hooks/agency_platform_adapter.pb.js. Only fires once: guarded by
  // oldStage !== newStage && newStage === "onboarding", not by "any
  // post-payment stage", so re-saving the record later at qa_qc/deployment/
  // etc. doesn't attempt to re-provision.
  if (oldStage !== newStage && newStage === "onboarding") {
    const stored = findOrNotFound(e.app, "agency_leads", e.record.id, "Agency lead");
    const provisionResult = provisionAgencyPlatformClient(e.app, stored);
    if (provisionResult.client_id) {
      stored.set("agency_platform_client_id", provisionResult.client_id);
      stored.set("agency_platform_service_id", provisionResult.service_id);
      e.app.save(stored);
    } else {
      // Not fatal — logged so it's visible without blocking the stage
      // transition that already succeeded. console.warn is PocketBase
      // JSVM's documented logging global; this appears in the server logs.
      console.warn(`Agency Platform provisioning skipped for lead ${stored.id}: ${provisionResult.reason}`);
    }
  }

  // Manual pricing-review clearance is a distinct, auditable decision even
  // when it doesn't happen to coincide with a stage change.
  const reviewWasRequired = e.record.original().get("manual_review_required");
  const reviewClearedBy = e.record.get("manual_review_cleared_by");
  if (reviewWasRequired && reviewClearedBy) {
    const authRecord = e.auth;
    const employeeId = authRecord ? authRecord.get("employee") : null;
    if (employeeId) {
      writeAuditLog(e.app, {
        actorEmployeeId: employeeId,
        action: "agency_lead.pricing_review_cleared",
        affectedCollection: "agency_leads",
        affectedRecordId: e.record.id,
        affectedCustomerId: e.record.get("customer") || null,
        newValue: {
          quoted_amount_cents: e.record.get("quoted_amount_cents"),
          cleared_by: reviewClearedBy,
        },
        reason: e.record.get("manual_review_notes") || undefined,
      });
    }
  }
});
