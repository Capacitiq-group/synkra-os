// pb_hooks/flow_lib.js
//
// Plain CommonJS module (NOT *.pb.js). Required from inside
// flow_adapter.pb.js's routerAdd handler bodies — see shared.js for the
// full explanation of why (PocketBase handler-scope isolation).
//
// See flow_adapter.pb.js's own header comment for the Channel A/B design
// this implements.

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
  const shared = require(`${__hooks}/shared.js`);
  if (!flowConfigured()) {
    shared.recordIntegrationStatus(e.app, "flow", "not_configured");
    throw new shared.ApiError(501, "FLOW_API_BASE is not configured.");
  }
  try {
    const result = fn();
    shared.recordIntegrationStatus(e.app, "flow", "connected");
    return result;
  } catch (err) {
    shared.recordIntegrationStatus(e.app, "flow", err.authFailure ? "authentication_failed" : "unavailable", err.message);
    throw new shared.ApiError(502, `Flow is unavailable: ${err.message}`);
  }
}

// Per the handover doc's Section 4 recommended build order, these
// synkra-core endpoints do not exist yet. Returning a fake success (or
// writing directly to Flow's PocketBase, which the doc explicitly warns
// against) would be worse than refusing.
function notYetBuiltInSynkraCore(endpointName) {
  const shared = require(`${__hooks}/shared.js`);
  throw new shared.ApiError(
    501,
    `${endpointName} does not exist in synkra-core yet (see the Flow handover doc, Section 4: recommended build order). This route intentionally refuses rather than writing to Flow's PocketBase directly or faking success.`
  );
}

module.exports = {
  flowConfigured,
  normalizeFlowUser,
  normalizeFlowWorkspace,
  flowRequest,
  withFlowStatusTracking,
  notYetBuiltInSynkraCore,
};
