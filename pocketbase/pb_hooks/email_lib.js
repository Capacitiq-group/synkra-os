// pb_hooks/email_lib.js
//
// Plain CommonJS module (NOT *.pb.js). The only file that talks to Resend
// directly — required from inside email_adapter.pb.js's own handler AND
// from agency_platform_adapter.pb.js's invite route (which also needs to
// send an email). Nothing else in the app should hold an API key or build
// a Resend request; other modules call /api/email/send and read
// email_events, or require this module directly for a server-side send.

// Core send routine. Returns { ok, email_event_id, resend_email_id,
// status, error } and never throws — callers decide whether a failed send
// should fail their own request.
function sendTransactionalEmail(app, options) {
  const shared = require(`${__hooks}/shared.js`);

  const to = options && options.to;
  const subject = options && options.subject;
  const html = options && options.html;
  const templateId = options && options.template_id;
  const relatedCustomerId = options && options.related_customer_id;

  const apiKey = $os.getenv("RESEND_API_KEY");
  // RESEND_FROM_ADDRESS may carry a display name ("Synkra <hello@x.co.za>").
  // Resend accepts that form, but email_events.sender is an `email` field
  // and rejects it — so store the bare address there.
  const fromAddress = $os.getenv("RESEND_FROM_ADDRESS") || "ops@synkra.example";
  const fromMatch = String(fromAddress).match(/<([^>]+)>/);
  const fromMailbox = (fromMatch ? fromMatch[1] : fromAddress).trim();

  const eventsCollection = app.findCollectionByNameOrId("email_events");
  const event = new Record(eventsCollection);
  event.set("direction", "outgoing");
  event.set("recipient", to);
  event.set("sender", fromMailbox);
  event.set("subject", subject);
  if (templateId) event.set("template", templateId);
  if (relatedCustomerId) event.set("related_customer", relatedCustomerId);

  if (!apiKey) {
    event.set("status", "failed");
    event.set("failure_reason", "RESEND_API_KEY not configured — integration boundary not connected.");
    app.save(event);
    shared.recordIntegrationStatus(app, "resend", "not_configured");
    return { ok: false, status: 501, email_event_id: event.id, error: "RESEND_API_KEY is not configured. No email was sent." };
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
    app.save(event);
    shared.recordIntegrationStatus(app, "resend", "unavailable", "Could not reach Resend API.");
    return { ok: false, status: 502, email_event_id: event.id, error: "Could not reach Resend. No email was sent." };
  }

  if (res.statusCode >= 400) {
    event.set("status", "failed");
    event.set("failure_reason", `Resend responded with status ${res.statusCode}.`);
    app.save(event);
    shared.recordIntegrationStatus(
      app,
      "resend",
      res.statusCode === 401 || res.statusCode === 403 ? "authentication_failed" : "error",
      `Resend status ${res.statusCode}`
    );
    return { ok: false, status: 502, email_event_id: event.id, error: `Resend rejected the send (status ${res.statusCode}). No email was sent.` };
  }

  const resendId = res.json && res.json.id;
  event.set("resend_email_id", resendId || "");
  event.set("status", "sent");
  event.set("sent_at", new Date().toISOString());
  app.save(event);
  shared.recordIntegrationStatus(app, "resend", "connected");

  return { ok: true, status: 200, email_event_id: event.id, resend_email_id: resendId };
}

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

module.exports = { sendTransactionalEmail, mapResendEventToStatus };
