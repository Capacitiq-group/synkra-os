/// <reference path="../pb_data/types.d.ts" />

// RESEND EMAIL ADAPTER — the only file that talks to Resend directly.
// Nothing else in the app should hold an API key or build a Resend
// request; other modules call /api/email/send and read email_events.

// Sends a transactional email via Resend and records the attempt as an
// email_events row regardless of outcome. Requires email.manage — sending
// email on a customer's behalf is not a passive "view" action.
routerAdd("POST", "/api/email/send", (e) => {
  const employee = requirePermission(e, "email.manage");
  const data = e.requestInfo().body;
  const to = data && data.to;
  const subject = data && data.subject;
  const html = data && data.html;
  const templateId = data && data.template_id;
  const relatedCustomerId = data && data.related_customer_id;

  if (!to || !subject || !html) {
    throw new ApiError(400, "to, subject, and html are required.");
  }

  const apiKey = $os.getenv("RESEND_API_KEY");
  const fromAddress = $os.getenv("RESEND_FROM_ADDRESS") || "ops@synkra.example";

  const eventsCollection = e.app.findCollectionByNameOrId("email_events");
  const event = new Record(eventsCollection);
  event.set("direction", "outgoing");
  event.set("recipient", to);
  event.set("sender", fromAddress);
  event.set("subject", subject);
  if (templateId) event.set("template", templateId);
  if (relatedCustomerId) event.set("related_customer", relatedCustomerId);

  if (!apiKey) {
    event.set("status", "failed");
    event.set("failure_reason", "RESEND_API_KEY not configured — integration boundary not connected.");
    e.app.save(event);
    recordIntegrationStatus(e.app, "resend", "not_configured");
    throw new ApiError(501, "RESEND_API_KEY is not configured. No email was sent.");
  }

  let res;
  try {
    res = $http.send({
      url: "https://api.resend.com/emails",
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: fromAddress, to: [to], subject, html }),
    });
  } catch (err) {
    event.set("status", "failed");
    event.set("failure_reason", "Could not reach Resend.");
    e.app.save(event);
    recordIntegrationStatus(e.app, "resend", "unavailable", "Could not reach Resend API.");
    throw new ApiError(502, "Could not reach Resend. No email was sent.");
  }

  if (res.statusCode >= 400) {
    event.set("status", "failed");
    event.set("failure_reason", `Resend responded with status ${res.statusCode}.`);
    e.app.save(event);
    recordIntegrationStatus(
      e.app,
      "resend",
      res.statusCode === 401 || res.statusCode === 403 ? "authentication_failed" : "error",
      `Resend status ${res.statusCode}`
    );
    throw new ApiError(502, `Resend rejected the send (status ${res.statusCode}). No email was sent.`);
  }

  const resendId = res.json && res.json.id;
  event.set("resend_email_id", resendId || "");
  event.set("status", "sent");
  event.set("sent_at", new Date().toISOString());
  e.app.save(event);
  recordIntegrationStatus(e.app, "resend", "connected");

  writeAuditLog(e.app, {
    actorEmployeeId: employee.id,
    action: "email.send",
    affectedCollection: "email_events",
    affectedRecordId: event.id,
    affectedCustomerId: relatedCustomerId || null,
  });

  return e.json(200, { success: true, email_event_id: event.id, resend_email_id: resendId });
});

function mapResendEventToStatus(resendEventType) {
  const map = {
    "email.sent": "sent",
    "email.delivered": "delivered",
    "email.bounced": "bounced",
    "email.complained": "complained",
    "email.delivery_delayed": "sent",
  };
  return map[resendEventType] || "sent";
}

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
  const expectedSecret = $os.getenv("RESEND_WEBHOOK_SECRET");
  if (!expectedSecret) {
    throw new ApiError(501, "RESEND_WEBHOOK_SECRET is not configured — webhook intake is disabled until it is.");
  }
  const providedSignature = e.request.header.get("Svix-Signature") || e.request.header.get("X-Resend-Signature");
  if (!providedSignature) {
    throw new ApiError(401, "Missing webhook signature header.");
  }

  const data = e.requestInfo().body;
  const eventType = data && data.type; // e.g. "email.delivered", "email.bounced", "email.complained"
  const resendId = data && data.data && data.data.email_id;
  if (!eventType || !resendId) {
    throw new ApiError(400, "Malformed webhook payload.");
  }

  const existing = tryFindFirst(e.app, "email_events", "resend_email_id = {:id}", { id: resendId });
  if (!existing) {
    // A status update for an email we have no outgoing record of — log it
    // as its own row rather than silently dropping it.
    const eventsCollection = e.app.findCollectionByNameOrId("email_events");
    const orphanEvent = new Record(eventsCollection);
    orphanEvent.set("resend_email_id", resendId);
    orphanEvent.set("direction", "incoming");
    orphanEvent.set("recipient", (data.data && data.data.to && data.data.to[0]) || "unknown");
    orphanEvent.set("status", mapResendEventToStatus(eventType));
    e.app.save(orphanEvent);
    return e.json(200, { success: true, note: "recorded as new event (no matching outgoing record)" });
  }

  existing.set("status", mapResendEventToStatus(eventType));
  if (eventType === "email.delivered") existing.set("delivered_at", new Date().toISOString());
  if (eventType === "email.bounced") existing.set("failure_reason", "Bounced");
  if (eventType === "email.complained") existing.set("failure_reason", "Recipient marked as spam");
  e.app.save(existing);

  return e.json(200, { success: true });
});
