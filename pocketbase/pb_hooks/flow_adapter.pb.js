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
// normalizeFlowBillingRecord in ./flow_lib.js stay conservative (pass the
// raw record through, translate only what's certain).
//
// IMPORTANT — customer identity is workspace-centric, not user-centric,
// per the doc. This adapter does NOT force Flow's data into Synkra OS's
// own `customers` collection concept.
//
// IMPORTANT — Flow uses magic-link, passwordless auth. There is no
// password to reset.
//
// IMPORTANT — plan limits are NOT stored in Flow's database; they live in
// code in synkra-client-hub. This adapter never fabricates a "% of limit
// used" number.
//
// All Flow-specific logic (config check, request dispatch, normalizers,
// status tracking) lives in ./flow_lib.js — required from inside each
// handler body below, per PocketBase's handler-scope isolation (see
// shared.js).

routerAdd("GET", "/api/flow/status", (e) => {
  const shared = require(`${__hooks}/shared.js`);
  shared.requirePermission(e, "flow.view");
  const row = shared.tryFindFirst(e.app, "integration_status", "integration_key = 'flow'", {});
  return e.json(200, row || { integration_key: "flow", status: "not_configured" });
});

// ---- Channel A: reads --------------------------------------------------

routerAdd("GET", "/api/flow/users", (e) => {
  const shared = require(`${__hooks}/shared.js`);
  const flowLib = require(`${__hooks}/flow_lib.js`);

  shared.requirePermission(e, "flow.view");
  const q = e.request.url.query().get("q") || "";
  const result = flowLib.withFlowStatusTracking(e, () => {
    const filterParam = q ? `&filter=${encodeURIComponent(`business_name~"${q}" || email~"${q}"`)}` : "";
    return flowLib.flowRequest("/api/collections/users/records", `perPage=50${filterParam}`);
  });
  return e.json(200, { items: (result.items || []).map(flowLib.normalizeFlowUser) });
});

routerAdd("GET", "/api/flow/users/{id}", (e) => {
  const shared = require(`${__hooks}/shared.js`);
  const flowLib = require(`${__hooks}/flow_lib.js`);

  shared.requirePermission(e, "flow.view");
  const userId = e.request.pathValue("id");
  const result = flowLib.withFlowStatusTracking(e, () => flowLib.flowRequest(`/api/collections/users/records/${userId}`));
  return e.json(200, { item: flowLib.normalizeFlowUser(result) });
});

routerAdd("GET", "/api/flow/workspaces", (e) => {
  const shared = require(`${__hooks}/shared.js`);
  const flowLib = require(`${__hooks}/flow_lib.js`);

  shared.requirePermission(e, "flow.view");
  const result = flowLib.withFlowStatusTracking(e, () => flowLib.flowRequest("/api/collections/workspaces/records", "perPage=50"));
  return e.json(200, { items: (result.items || []).map(flowLib.normalizeFlowWorkspace) });
});

// Billing/execution-credit/integration/notification collections: field
// names unconfirmed, so these routes return the raw Flow records
// untranslated (labeled as such) rather than a normalize function that
// would be guessing.
//
// Registers a route at file-load time (same phase as routerAdd calls
// directly) — the actual registered callback below still require()s its
// own dependencies, same as every other handler.
function rawPassthroughRoute(path, flowCollection, permission) {
  routerAdd("GET", path, (e) => {
    const shared = require(`${__hooks}/shared.js`);
    const flowLib = require(`${__hooks}/flow_lib.js`);

    shared.requirePermission(e, permission);
    const ownerId = e.request.url.query().get("owner_id");
    const filterParam = ownerId ? `&filter=${encodeURIComponent(`user="${ownerId}" || workspace="${ownerId}"`)}` : "";
    const result = flowLib.withFlowStatusTracking(e, () => flowLib.flowRequest(`/api/collections/${flowCollection}/records`, `perPage=100${filterParam}`));
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
// synkra-core endpoints do not exist yet. Returning a fake success would
// be worse than refusing.

routerAdd("POST", "/api/flow/users/{id}/suspend", (e) => {
  const shared = require(`${__hooks}/shared.js`);
  const flowLib = require(`${__hooks}/flow_lib.js`);
  shared.requirePermission(e, "customers.edit");
  flowLib.notYetBuiltInSynkraCore("POST /admin/users/{id}/suspend");
});
routerAdd("POST", "/api/flow/users/{id}/reactivate", (e) => {
  const shared = require(`${__hooks}/shared.js`);
  const flowLib = require(`${__hooks}/flow_lib.js`);
  shared.requirePermission(e, "customers.edit");
  flowLib.notYetBuiltInSynkraCore("POST /admin/users/{id}/reactivate");
});
routerAdd("POST", "/api/flow/users/{id}/impersonate", (e) => {
  const shared = require(`${__hooks}/shared.js`);
  const flowLib = require(`${__hooks}/flow_lib.js`);
  shared.requirePermission(e, "customers.impersonate");
  flowLib.notYetBuiltInSynkraCore("POST /admin/users/{id}/impersonate");
});
routerAdd("POST", "/api/flow/users/{id}/magic-link", (e) => {
  const shared = require(`${__hooks}/shared.js`);
  const flowLib = require(`${__hooks}/flow_lib.js`);
  shared.requirePermission(e, "customers.edit");
  flowLib.notYetBuiltInSynkraCore("POST /admin/users/{id}/magic-link (the real equivalent of \"resend verification\" — Flow has no password to reset)");
});
