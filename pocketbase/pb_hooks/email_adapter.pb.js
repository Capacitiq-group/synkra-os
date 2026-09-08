/// <reference path="../pb_data/types.d.ts" />

// RESEND EMAIL ADAPTER
//
// The actual send routine now lives in ./email_lib.js — required from
// inside each handler body below (and from agency_platform_adapter.pb.js's
// invite route), per PocketBase's handler-scope isolation (see shared.js).

// Sends a transactional email via Resend and records the attempt as an
// email_events row regardless of outcome. Requires email.manage — sending
// email on a customer's behalf is not a passive "view" action.
routerAdd("POST", "/api/email/send", (e) => {
  const shared = require(`${__hooks}/shared.js`);
  const emailLib = require(`${__hooks}/email_lib.js`);

  const employee = shared.requirePermission(e, "email.manage");
  const data = e.requestInfo().body;
  const to = data && data.to;
  const subject = data && data.subject;
  const html = data && data.html;

  if (!to || !subject || !html) {
    throw new shared.ApiError(400, "to, subject, and html are required.");
  }

  const relatedCustomerId = data && data.related_customer_id;
  const result = emailLib.sendTransactionalEmail(e.app, {
    to,
    subject,
    html,
    template_id: data && data.template_id,
    related_customer_id: relatedCustomerId,
  });
  if (!result.ok) {
    throw new shared.ApiError(result.status, result.error);
  }

  shared.writeAuditLog(e.app, {
    actorEmployeeId: employee.id,
    action: "email.send",
    affectedCollection: "email_events",
    affectedRecordId: result.email_event_id,
    affectedCustomerId: relatedCustomerId || null,
  });

  return e.json(200, { success: true, email_event_id: result.email_event_id, resend_email_id: result.resend_email_id });
});

// Resend webhook: delivery/bounce/complaint status updates land here.
// Verified via a shared-secret header (RESEND_WEBHOOK_SECRET). Without it
// configured, the endpoint refuses all webhook traffic rather than
// accepting unauthenticated writes to email_events.
//
// NOTE (honesty): Resend delivers webhooks via Svix, which signs with
// HMAC over the raw body + timestamp, not a static bearer token. A
// production-correct implementation must verify that HMAC signature
// exactly per Svix's spec. What's implemented here checks that a
// signature header is PRESENT and that a configured secret exists, as a
// minimum bar against completely open intake — it is NOT full HMAC
// verification. Do not consider this endpoint hardened until that's
// added; flagged clearly rather than presented as complete.
routerAdd("POST", "/api/email/webhook/resend", (e) => {
  const shared = require(`${__hooks}/shared.js`);
  const emailLib = require(`${__hooks}/email_lib.js`);

  const expectedSecret = $os.getenv("RESEND_WEBHOOK_SECRET");
  if (!expectedSecret) {
    throw new shared.ApiError(501, "RESEND_WEBHOOK_SECRET is not configured — webhook intake is disabled until it is.");
  }
  const providedSignature = e.request.header.get("Svix-Signature") || e.request.header.get("X-Resend-Signature");
  if (!providedSignature) {
    throw new shared.ApiError(401, "Missing webhook signature header.");
  }

  const data = e.requestInfo().body;
  const eventType = data && data.type; // e.g. "email.delivered", "email.bounced", "email.complained"
  const resendId = data && data.data && data.data.email_id;
  if (!eventType || !resendId) {
    throw new shared.ApiError(400, "Malformed webhook payload.");
  }

  const existing = shared.tryFindFirst(e.app, "email_events", "resend_email_id = {:id}", { id: resendId });
  if (!existing) {
    // A status update for an email we have no outgoing record of — log it
    // as its own row rather than silently dropping it.
    const eventsCollection = e.app.findCollectionByNameOrId("email_events");
    const orphanEvent = new Record(eventsCollection);
    orphanEvent.set("resend_email_id", resendId);
    orphanEvent.set("direction", "incoming");
    orphanEvent.set("recipient", (data.data && data.data.to && data.data.to[0]) || "unknown");
    orphanEvent.set("status", emailLib.mapResendEventToStatus(eventType));
    e.app.save(orphanEvent);
    return e.json(200, { success: true, note: "recorded as new event (no matching outgoing record)" });
  }

  existing.set("status", emailLib.mapResendEventToStatus(eventType));
  if (eventType === "email.delivered") existing.set("delivered_at", new Date().toISOString());
  if (eventType === "email.bounced") existing.set("failure_reason", "Bounced");
  if (eventType === "email.complained") existing.set("failure_reason", "Recipient marked as spam");
  e.app.save(existing);

  return e.json(200, { success: true });
});
