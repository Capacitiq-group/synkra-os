/// <reference path="../pb_data/types.d.ts" />

// FLOW INTEGRATION ADAPTER — rewritten against Flow's ACTUAL schema per the
// "How the Admin Platform Should Talk to Flow" handover report. Two
// channels, per that document, kept deliberately separate:
//
//   Channel A — reads. Flow's own PocketBase REST API
//   (https://pb.synkra.co.za/api/collections/<name>/records), hit with a
//   dedicated service-account token (FLOW_API_KEY) — NOT the credential a
//   human uses to log into Flow's PocketBase admin UI. Everything in this
//   file that only reads data uses this channel.
//
//   Channel B — actions (suspend, reactivate, impersonate, magic-link).
//   Per the handover doc: "almost none of the administrative account
//   control actions... have a backend endpoint built for them yet" in
//   synkra-core. So these routes are honest 501 stubs naming the exact
//   synkra-core endpoint that needs to be built (see the doc's Section 4
//   recommended build order) — NOT implemented by writing to Flow's
//   PocketBase directly, which the doc explicitly warns against (no audit
//   trail, no guarantee the rest of Flow reacts correctly to the state
//   change).
//
// Real collection names confirmed by the handover doc: users, workspaces,
// workspace_members, workspace_invitations, billing_subscriptions,
// billing_payments, billing_checkouts, billing_customers,
// execution_credits, execution_pack_purchases, addon_credits,
// addon_purchases, integrations, notifications, pending_approvals,
// student_verifications. Field-level detail is only confirmed for `users`
// (the doc gives the full field list) — fields on the billing_*/workspace_*
// collections are not yet confirmed, so normalizeFlowWorkspace/
// normalizeFlowBillingRecord below stay conservative (pass the raw record
// through, translate only what's certain) rather than guessing field names
// the way the previous revision of this file incorrectly did for the
// whole schema.
//
// IMPORTANT — customer identity is workspace-centric, not user-centric,
// per the doc. This adapter does NOT force Flow's data into Synkra OS's
// own `customers` collection concept. It exposes Flow users AND Flow
// workspaces as separate views, matching how Flow itself is structured,
// rather than inventing a unification the doc explicitly warned against.
//
// IMPORTANT — Flow uses magic-link, passwordless auth. There is no
// password to reset. "Resend verification" as a concept does not apply;
// the real equivalent is manually issuing a new magic link, which is
// listed below as a Channel B action pending a synkra-core endpoint.
//
// IMPORTANT — plan limits (what a tier is entitled to) are NOT stored in
// Flow's database at all; they live in code in synkra-client-hub. This
// adapter never fabricates a "% of limit used" number — it surfaces raw
// usage counters only, until synkra-core ships GET /admin/plans.

function flowConfigured() {
  return !!$os.getenv("FLOW_API_BASE");
}

// Passes through the real `users` fields from the handover doc's field
// list, unmodified. No invented fields, no computed "% of plan used".
function normalizeFlowUser(raw) {
  return {
    flow_user_id: raw.id,
    email: raw.email,
    tier: raw.tier,
    user_type: raw.user_type,
    billing_period_start: raw.billing_period_start,
    trial_ends_at: raw.trial_ends_at,
    business_name: raw.business_name,
    business_industry: raw.business_industry,
    business_address: raw.business_address,
    phone: raw.phone,
    usage: {
      executions_used_this_month: raw.executions_used_this_month,
      ai_ops_used_this_month: raw.ai_ops_used_this_month,
      emails_used_this_month: raw.emails_used_this_month,
      sms_used_this_month: raw.sms_used_this_month,
      whatsapp_used_this_month: raw.whatsapp_used_this_month,
      voice_minutes_used_this_month: raw.voice_minutes_used_this_month,
      storage_used_mb: raw.storage_used_mb,
      addon_storage_gb: raw.addon_storage_gb,
    },
    credits: {
      credit_emails: raw.credit_emails,
      credit_emails_used: raw.credit_emails_used,
      credit_workflows: raw.credit_workflows,
      credit_workflows_used: raw.credit_workflows_used,
    },
    student_verified: raw.student_verified,
    student_verification_status: raw.student_verification_status,
    onboarding_completed: raw.onboarding_completed,
    is_tester: raw.is_tester,
    // NOT a real field yet — see handover doc Section 3: there is no
    // account_status distinct from a subscription simply lapsing. Left
    // undefined on purpose rather than inferring one.
    account_status: undefined,
    raw,
  };
}

// Workspace field names are NOT confirmed by the handover doc (only the
// collection's existence is) — this stays a thin, honest pass-through
// rather than a guessed mapping.
function normalizeFlowWorkspace(raw) {
  return {
    flow_workspace_id: raw.id,
    name: raw.name || raw.title || null,
    raw,
  };
}

function flowRequest(path, queryString) {
  const base = $os.getenv("FLOW_API_BASE");
  const apiKey = $os.getenv("FLOW_API_KEY");
  const url = `${base}${path}${queryString ? `?${queryString}` : ""}`;
  const res = $http.send({
    url,
    method: "GET",
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
  });
  if (res.statusCode === 401 || res.statusCode === 403) {
    const err = new Error(`Flow authentication failed (status ${res.statusCode}). Confirm FLOW_API_KEY is a valid, non-expired token for a dedicated service account (per the handover doc — not a human admin's credential).`);
    err.authFailure = true;
    throw err;
  }
  if (res.statusCode >= 400) {
    throw new Error(`Flow request failed (status ${res.statusCode})`);
  }
  return res.json;
}

function withFlowStatusTracking(e, fn) {
  if (!flowConfigured()) {
    recordIntegrationStatus(e.app, "flow", "not_configured");
    throw new ApiError(501, "FLOW_API_BASE is not configured.");
  }
  try {
    const result = fn();
    recordIntegrationStatus(e.app, "flow", "connected");
    return result;
  } catch (err) {
    recordIntegrationStatus(e.app, "flow", err.authFailure ? "authentication_failed" : "unavailable", err.message);
    throw new ApiError(502, `Flow is unavailable: ${err.message}`);
  }
}

routerAdd("GET", "/api/flow/status", (e) => {
  requirePermission(e, "flow.view");
  const row = tryFindFirst(e.app, "integration_status", "integration_key = 'flow'", {});
  return e.json(200, row || { integration_key: "flow", status: "not_configured" });
});

// ---- Channel A: reads --------------------------------------------------

routerAdd("GET", "/api/flow/users", (e) => {
  requirePermission(e, "flow.view");
  const q = e.request.url.query().get("q") || "";
  const result = withFlowStatusTracking(e, () => {
    const filterParam = q ? `&filter=${encodeURIComponent(`business_name~"${q}" || email~"${q}"`)}` : "";
    return flowRequest("/api/collections/users/records", `perPage=50${filterParam}`);
  });
  return e.json(200, { items: (result.items || []).map(normalizeFlowUser) });
});

routerAdd("GET", "/api/flow/users/{id}", (e) => {
  requirePermission(e, "flow.view");
  const userId = e.request.pathValue("id");
  const result = withFlowStatusTracking(e, () => flowRequest(`/api/collections/users/records/${userId}`));
  return e.json(200, { item: normalizeFlowUser(result) });
});

routerAdd("GET", "/api/flow/workspaces", (e) => {
  requirePermission(e, "flow.view");
  const result = withFlowStatusTracking(e, () => flowRequest("/api/collections/workspaces/records", "perPage=50"));
  return e.json(200, { items: (result.items || []).map(normalizeFlowWorkspace) });
});

// Billing/execution-credit/integration/notification collections: field
// names unconfirmed, so these routes return the raw Flow records
// untranslated (labeled as such) rather than a normalize function that
// would be guessing. Update the normalize step once field names are
// confirmed against Flow's actual schema export.
function rawPassthroughRoute(path, flowCollection, permission) {
  routerAdd("GET", path, (e) => {
    requirePermission(e, permission);
    const ownerId = e.request.url.query().get("owner_id");
    const filterParam = ownerId ? `&filter=${encodeURIComponent(`user="${ownerId}" || workspace="${ownerId}"`)}` : "";
    const result = withFlowStatusTracking(e, () => flowRequest(`/api/collections/${flowCollection}/records`, `perPage=100${filterParam}`));
    return e.json(200, { items: result.items || [], note: "raw Flow records — field mapping not yet confirmed, see flow_adapter.pb.js" });
  });
}
rawPassthroughRoute("/api/flow/billing-subscriptions", "billing_subscriptions", "flow.view");
rawPassthroughRoute("/api/flow/billing-payments", "billing_payments", "flow.view");
rawPassthroughRoute("/api/flow/execution-credits", "execution_credits", "flow.view");
rawPassthroughRoute("/api/flow/integrations", "integrations", "flow.view");
rawPassthroughRoute("/api/flow/pending-approvals", "pending_approvals", "flow.view");
rawPassthroughRoute("/api/flow/student-verifications", "student_verifications", "flow.view");

// ---- Channel B: actions — honestly not built yet -------------------------
// Per the handover doc's Section 4 recommended build order, these
// synkra-core endpoints do not exist yet. Returning a fake success (or
// writing directly to Flow's PocketBase, which the doc explicitly warns
// against) would be worse than refusing — it would look like account
// suspension works from Synkra OS while doing nothing, or bypass Flow's
// own audit trail entirely.
function notYetBuiltInSynkraCore(endpointName) {
  throw new ApiError(
    501,
    `${endpointName} does not exist in synkra-core yet (see the Flow handover doc, Section 4: recommended build order). This route intentionally refuses rather than writing to Flow's PocketBase directly or faking success.`
  );
}

routerAdd("POST", "/api/flow/users/{id}/suspend", (e) => {
  requirePermission(e, "customers.edit");
  notYetBuiltInSynkraCore("POST /admin/users/{id}/suspend");
});
routerAdd("POST", "/api/flow/users/{id}/reactivate", (e) => {
  requirePermission(e, "customers.edit");
  notYetBuiltInSynkraCore("POST /admin/users/{id}/reactivate");
});
routerAdd("POST", "/api/flow/users/{id}/impersonate", (e) => {
  requirePermission(e, "customers.impersonate");
  notYetBuiltInSynkraCore("POST /admin/users/{id}/impersonate");
});
routerAdd("POST", "/api/flow/users/{id}/magic-link", (e) => {
  requirePermission(e, "customers.edit");
  notYetBuiltInSynkraCore("POST /admin/users/{id}/magic-link (the real equivalent of \"resend verification\" — Flow has no password to reset)");
});
