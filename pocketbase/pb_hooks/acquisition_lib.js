// pb_hooks/acquisition_lib.js
//
// Plain CommonJS module (NOT *.pb.js). Required from inside
// acquisition.pb.js's routerAdd handler bodies — see shared.js for the
// full explanation of why (PocketBase handler-scope isolation).
//
// Per the spec's architecture, Python bots + AI research agents are a
// SEPARATE project — they are not part of this codebase. Configure
// ACQUISITION_WORKER_API_KEY once that project exists. Until then, every
// worker-auth-gated route returns 501, matching the same "honest
// boundary, no fake data" pattern used for the AI worker and Flow/Chat.

function requireAcquisitionWorkerAuth(e) {
  const shared = require(`${__hooks}/shared.js`);
  const expected = $os.getenv("ACQUISITION_WORKER_API_KEY");
  if (!expected) {
    throw new shared.ApiError(501, "ACQUISITION_WORKER_API_KEY is not configured — the acquisition engine's Python/AI worker project is not connected yet.");
  }
  const provided = e.request.header.get("Authorization");
  if (provided !== `Bearer ${expected}`) {
    throw new shared.ApiError(401, "Invalid or missing acquisition worker credentials.");
  }
}

function normalizeDomain(input) {
  return String(input || "")
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "")
    .trim();
}

function logAcquisitionEvent(app, eventType, { companyId, contactId, campaignId, detail }) {
  const collection = app.findCollectionByNameOrId("acquisition_events");
  const event = new Record(collection);
  event.set("event_type", eventType);
  if (companyId) event.set("company", companyId);
  if (contactId) event.set("contact", contactId);
  if (campaignId) event.set("campaign", campaignId);
  if (detail !== undefined) event.set("detail", detail);
  event.set("occurred_at", new Date().toISOString());
  app.save(event);
}

function addToSuppressionList(app, contact, reason) {
  const shared = require(`${__hooks}/shared.js`);
  const email = contact.get("business_email");
  if (!email) return;
  const emailNormalized = String(email).toLowerCase().trim();
  const existing = shared.tryFindFirst(app, "suppression_list", "email_normalized = {:email}", { email: emailNormalized });
  if (existing) return;
  const collection = app.findCollectionByNameOrId("suppression_list");
  const row = new Record(collection);
  row.set("email_normalized", emailNormalized);
  row.set("reason", reason);
  app.save(row);
  logAcquisitionEvent(app, "suppression_added", { detail: { email: emailNormalized, reason } });
}

// Campaign event state-machine constants — see the switch statement in
// acquisition.pb.js's POST /api/acquisition/campaigns/{id}/event handler.
const STOP_EVENTS = new Set(["email_bounced", "deal_lost"]);
const AUTO_SUPPRESS_ON = {
  email_bounced: "hard_bounce",
};

module.exports = {
  requireAcquisitionWorkerAuth,
  normalizeDomain,
  logAcquisitionEvent,
  addToSuppressionList,
  STOP_EVENTS,
  AUTO_SUPPRESS_ON,
};
