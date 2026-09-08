/// <reference path="../pb_data/types.d.ts" />

// AGENCY PLATFORM ADAPTER
//
// Per ARCHITECTURE.md: there is ONE dedicated Agency PocketBase instance,
// separate from both this Synkra OS database and Flow's. The Client
// Portal (built, separate repo) already reads/writes it directly. Synkra
// OS is the "Admin Panel" role that document describes as "not built" —
// this file is that role, talking to the SAME instance with its own
// credentials, per that document's Section 5: "The Admin Panel needs its
// own separate credentials on this same instance... Do not have the
// Admin Panel authenticate as agency_client_users."
//
// Every route below implements EXACTLY the Create/Read/Update/Delete
// column for "Admin Panel" in that document's Section 3 collection
// reference — not more, not less. Where the document says Admin Panel
// cannot do something (e.g. create agency_payments — only the Client
// Portal's checkout route and the Paystack webhook touch that collection),
// no route exists here for it.
//
// Local/remote dispatch logic, provisioning, and invite-email HTML now
// live in ./agency_platform_lib.js — required from inside each handler
// body below, per PocketBase's handler-scope isolation (see shared.js).

routerAdd("GET", "/api/agency-platform/status", (e) => {
  const shared = require(`${__hooks}/shared.js`);
  shared.requirePermission(e, "agency.view");
  const row = shared.tryFindFirst(e.app, "integration_status", "integration_key = 'agency_platform'", {});
  return e.json(200, row || { integration_key: "agency_platform", status: "not_configured" });
});

// ---- Channel A: reads (Admin Panel = "All", per every row in the doc's table) ----

routerAdd("GET", "/api/agency-platform/clients", (e) => {
  const shared = require(`${__hooks}/shared.js`);
  const agencyLib = require(`${__hooks}/agency_platform_lib.js`);

  shared.requirePermission(e, "agency.view");
  const q = e.request.url.query().get("q") || "";
  const filterParam = q ? `&filter=${encodeURIComponent(`company_name~"${q}" || contact_email~"${q}"`)}` : "";
  const result = agencyLib.withAgencyPlatformStatusTracking(e, () =>
    agencyLib.agencyPlatformRequest("GET", `/api/collections/clients/records?perPage=50${filterParam}`)
  );
  return e.json(200, { items: result.items || [] });
});

// Registers a scoped read route — called at file-load time (same phase as
// routerAdd calls directly), not from within another handler's body, so
// this part is fine to keep as a plain top-level function. The actual
// registered callback (the (e) => {...} passed to routerAdd inside here)
// still needs its own require() calls, same as every other handler.
function scopedReadRoute(path, flowCollectionPath, permission) {
  routerAdd("GET", path, (e) => {
    const shared = require(`${__hooks}/shared.js`);
    const agencyLib = require(`${__hooks}/agency_platform_lib.js`);

    shared.requirePermission(e, permission);
    const clientId = e.request.pathValue("id");
    const filterParam = `?filter=${encodeURIComponent(`client_id="${clientId}" || agency_client_id="${clientId}"`)}&perPage=100`;
    const result = agencyLib.withAgencyPlatformStatusTracking(e, () =>
      agencyLib.agencyPlatformRequest("GET", `/api/collections/${flowCollectionPath}/records${filterParam}`)
    );
    return e.json(200, { items: result.items || [] });
  });
}
scopedReadRoute("/api/agency-platform/clients/{id}/services", "agency_client_services", "agency.view");
scopedReadRoute("/api/agency-platform/clients/{id}/intake-forms", "intake_forms", "agency.view");
scopedReadRoute("/api/agency-platform/clients/{id}/onboarding-notes", "onboarding_notes", "agency.view");
scopedReadRoute("/api/agency-platform/clients/{id}/implementation-reports", "implementation_reports", "agency.view");
scopedReadRoute("/api/agency-platform/clients/{id}/payments", "agency_payments", "agency.view");

routerAdd("GET", "/api/agency-platform/services/{id}/usage-events", (e) => {
  const shared = require(`${__hooks}/shared.js`);
  const agencyLib = require(`${__hooks}/agency_platform_lib.js`);

  shared.requirePermission(e, "agency.view");
  const serviceId = e.request.pathValue("id");
  const result = agencyLib.withAgencyPlatformStatusTracking(e, () =>
    agencyLib.agencyPlatformRequest("GET", `/api/collections/agency_usage_events/records?filter=${encodeURIComponent(`agency_client_service_id="${serviceId}"`)}&perPage=200&sort=-occurred_at`)
  );
  return e.json(200, { items: result.items || [] });
});

routerAdd("GET", "/api/agency-platform/services/{id}/usage-credits", (e) => {
  const shared = require(`${__hooks}/shared.js`);
  const agencyLib = require(`${__hooks}/agency_platform_lib.js`);

  shared.requirePermission(e, "agency.view");
  const serviceId = e.request.pathValue("id");
  const result = agencyLib.withAgencyPlatformStatusTracking(e, () =>
    agencyLib.agencyPlatformRequest("GET", `/api/collections/agency_usage_credits/records?filter=${encodeURIComponent(`agency_client_service_id="${serviceId}"`)}&perPage=100`)
  );
  return e.json(200, { items: result.items || [] });
});

routerAdd("GET", "/api/agency-platform/invites", (e) => {
  const shared = require(`${__hooks}/shared.js`);
  const agencyLib = require(`${__hooks}/agency_platform_lib.js`);

  shared.requirePermission(e, "agency.view");
  const result = agencyLib.withAgencyPlatformStatusTracking(e, () =>
    agencyLib.agencyPlatformRequest("GET", "/api/collections/agency_invites/records?perPage=100&sort=-created")
  );
  return e.json(200, { items: result.items || [] });
});

// ---- Channel B: writes — exactly what the doc's table grants Admin Panel ----

routerAdd("POST", "/api/agency-platform/clients", (e) => {
  const shared = require(`${__hooks}/shared.js`);
  const agencyLib = require(`${__hooks}/agency_platform_lib.js`);

  const employee = shared.requirePermission(e, "agency.manage");
  const data = e.requestInfo().body;
  const result = agencyLib.withAgencyPlatformStatusTracking(e, () =>
    agencyLib.agencyPlatformRequest("POST", "/api/collections/clients/records", data)
  );
  shared.writeAuditLog(e.app, {
    actorEmployeeId: employee.id,
    action: "agency_platform.client_created",
    affectedCollection: "clients",
    affectedRecordId: result.id,
  });
  return e.json(200, result);
});

routerAdd("POST", "/api/agency-platform/clients/{id}/update", (e) => {
  const shared = require(`${__hooks}/shared.js`);
  const agencyLib = require(`${__hooks}/agency_platform_lib.js`);

  const employee = shared.requirePermission(e, "agency.manage");
  const clientId = e.request.pathValue("id");
  const data = e.requestInfo().body;
  const result = agencyLib.withAgencyPlatformStatusTracking(e, () =>
    agencyLib.agencyPlatformRequest("PATCH", `/api/collections/clients/records/${clientId}`, data)
  );
  shared.writeAuditLog(e.app, {
    actorEmployeeId: employee.id,
    action: "agency_platform.client_updated",
    affectedCollection: "clients",
    affectedRecordId: clientId,
    newValue: data,
  });
  return e.json(200, result);
});

// Onboarding-status / tier / pricing / admin overrides on a service.
routerAdd("POST", "/api/agency-platform/services/{id}/update", (e) => {
  const shared = require(`${__hooks}/shared.js`);
  const agencyLib = require(`${__hooks}/agency_platform_lib.js`);

  const employee = shared.requirePermission(e, "agency.manage");
  const serviceId = e.request.pathValue("id");
  const data = e.requestInfo().body;
  const result = agencyLib.withAgencyPlatformStatusTracking(e, () =>
    agencyLib.agencyPlatformRequest("PATCH", `/api/collections/agency_client_services/records/${serviceId}`, data)
  );
  shared.writeAuditLog(e.app, {
    actorEmployeeId: employee.id,
    action: "agency_platform.service_updated",
    affectedCollection: "agency_client_services",
    affectedRecordId: serviceId,
    newValue: data,
  });
  return e.json(200, result);
});

// Onboarding notes: Admin Panel is the ONLY creator (a human is on the
// call, per the doc) — never auto-generated.
routerAdd("POST", "/api/agency-platform/onboarding-notes", (e) => {
  const shared = require(`${__hooks}/shared.js`);
  const agencyLib = require(`${__hooks}/agency_platform_lib.js`);

  const employee = shared.requirePermission(e, "agency.manage");
  const data = e.requestInfo().body;
  data.finalized_by = data.finalized_by || employee.id;
  const result = agencyLib.withAgencyPlatformStatusTracking(e, () =>
    agencyLib.agencyPlatformRequest("POST", "/api/collections/onboarding_notes/records", data)
  );
  shared.writeAuditLog(e.app, {
    actorEmployeeId: employee.id,
    action: "agency_platform.onboarding_note_created",
    affectedCollection: "onboarding_notes",
    affectedRecordId: result.id,
  });
  return e.json(200, result);
});

// QC decision on an implementation report — Admin Panel updates status/
// flags; it never creates or deletes these (the AI Implementation Agent
// is the only creator, per the doc).
routerAdd("POST", "/api/agency-platform/implementation-reports/{id}/qc", (e) => {
  const shared = require(`${__hooks}/shared.js`);
  const agencyLib = require(`${__hooks}/agency_platform_lib.js`);

  const employee = shared.requirePermission(e, "agency.manage");
  const reportId = e.request.pathValue("id");
  const data = e.requestInfo().body; // expected: { status, notes }
  if (!data || !data.status) throw new shared.ApiError(400, "status is required.");
  const result = agencyLib.withAgencyPlatformStatusTracking(e, () =>
    agencyLib.agencyPlatformRequest("PATCH", `/api/collections/implementation_reports/records/${reportId}`, { status: data.status })
  );
  shared.writeAuditLog(e.app, {
    actorEmployeeId: employee.id,
    action: "agency_platform.implementation_qc_decision",
    affectedCollection: "implementation_reports",
    affectedRecordId: reportId,
    newValue: { status: data.status },
    reason: data.notes || undefined,
  });
  return e.json(200, result);
});

routerAdd("POST", "/api/agency-platform/invites", (e) => {
  const shared = require(`${__hooks}/shared.js`);
  const agencyLib = require(`${__hooks}/agency_platform_lib.js`);
  const emailLib = require(`${__hooks}/email_lib.js`);

  const employee = shared.requirePermission(e, "agency.manage");
  const data = e.requestInfo().body || {};

  if (!data.email) throw new shared.ApiError(400, "email is required.");
  // A token is what makes the emailed link work — generate one server-side
  // when the caller didn't supply it, rather than emailing a dead link.
  if (!data.token) data.token = $security.randomString(48);
  if (!data.status) data.status = "pending";
  if (!data.expires_at) data.expires_at = new Date(Date.now() + 14 * 86400000).toISOString();

  const result = agencyLib.withAgencyPlatformStatusTracking(e, () =>
    agencyLib.agencyPlatformRequest("POST", "/api/collections/agency_invites/records", data, e.app)
  );

  const link = `${agencyLib.agencyPortalBaseUrl()}/accept-invite?token=${encodeURIComponent(data.token)}`;
  const emailResult = emailLib.sendTransactionalEmail(e.app, {
    to: data.email,
    subject: "Your Synkra Agency Portal invite",
    html: agencyLib.acceptInviteEmailHtml(data, link),
  });

  shared.writeAuditLog(e.app, {
    actorEmployeeId: employee.id,
    action: "agency_platform.invite_created",
    affectedCollection: "agency_invites",
    affectedRecordId: result.id,
  });

  // The invite row exists either way; the email outcome is reported
  // honestly instead of being swallowed.
  return e.json(200, Object.assign({}, result, {
    accept_url: link,
    email_sent: emailResult.ok,
    email_error: emailResult.ok ? undefined : emailResult.error,
  }));
});

// Server-side invite acceptance. Previously the browser did these three
// writes itself with elevated permissions (and against a collection name
// that doesn't exist — `agency_clients`; the real one is `clients`).
// Public by design: the invite token IS the credential.
routerAdd("POST", "/api/agency-platform/invites/accept", (e) => {
  const shared = require(`${__hooks}/shared.js`);
  const agencyLib = require(`${__hooks}/agency_platform_lib.js`);

  const data = e.requestInfo().body || {};
  const token = data.token;
  const password = data.password;

  if (!token) throw new shared.ApiError(400, "token is required.");
  if (!password || String(password).length < 8) {
    throw new shared.ApiError(400, "password must be at least 8 characters.");
  }

  const invite = shared.tryFindFirst(e.app, "agency_invites", "token = {:token}", { token });
  if (!invite) throw new shared.ApiError(404, "This invite link isn't valid.");
  if (invite.get("status") === "accepted") throw new shared.ApiError(409, "This invite has already been used.");
  const expiresAt = invite.get("expires_at");
  if (invite.get("status") === "expired" || (expiresAt && new Date(expiresAt) < new Date())) {
    throw new shared.ApiError(410, "This invite has expired.");
  }

  const email = invite.get("email");
  const companyName = invite.get("company_name") || email;

  // 1. find-or-create the company (`clients`, not `agency_clients`).
  let client = shared.tryFindFirst(e.app, "clients", "company_name = {:name}", { name: companyName });
  if (!client) {
    const clientsCollection = e.app.findCollectionByNameOrId("clients");
    client = new Record(clientsCollection);
    client.set("company_name", companyName);
    client.set("contact_email", email);
    client.set("billing_mode", "manual");
    client.set("status", "active");
    e.app.save(client);
  }

  // 2. the portal login itself.
  if (shared.tryFindFirst(e.app, "agency_client_users", "email = {:email}", { email })) {
    throw new shared.ApiError(409, "An account already exists for this email. Log in instead.");
  }
  const usersCollection = e.app.findCollectionByNameOrId("agency_client_users");
  const user = new Record(usersCollection);
  user.set("email", email);
  user.setPassword(String(password));
  user.set("agency_client_id", client.id);
  user.set("role", "owner");
  user.set("invited_at", invite.get("created"));
  user.set("invite_accepted_at", new Date().toISOString());
  user.set("verified", true);
  user.set("emailVisibility", true);
  e.app.save(user);

  // 3. exactly the services named on the invite — nothing more, so the
  // client only ever sees what they were sold.
  let slugs = invite.get("service_slugs") || [];
  if (typeof slugs === "string") {
    try { slugs = JSON.parse(slugs); } catch (err) { slugs = []; }
  }
  const servicesCollection = e.app.findCollectionByNameOrId("agency_client_services");
  const createdServiceIds = [];
  (slugs || []).forEach((slug) => {
    const svc = new Record(servicesCollection);
    svc.set("agency_client_id", client.id);
    svc.set("service_slug", slug);
    svc.set("status", "active");
    svc.set("onboarding_status", "paid");
    svc.set("pending_change", "none");
    svc.set("current_period_start", new Date().toISOString());
    svc.set("current_period_end", new Date(Date.now() + 30 * 86400000).toISOString());
    e.app.save(svc);
    createdServiceIds.push(svc.id);
  });

  invite.set("status", "accepted");
  e.app.save(invite);

  // Return a real session so the portal can log the user straight in
  // without a second round-trip holding their password.
  const authToken = user.newAuthToken();
  return e.json(200, {
    token: authToken,
    record: agencyLib.recordToPlain(user),
    client_id: client.id,
    service_ids: createdServiceIds,
  });
});

// Manual usage-credit grant/adjustment — the one collection where the
// doc grants Admin Panel both create and update.
routerAdd("POST", "/api/agency-platform/usage-credits/grant", (e) => {
  const shared = require(`${__hooks}/shared.js`);
  const agencyLib = require(`${__hooks}/agency_platform_lib.js`);

  const employee = shared.requirePermission(e, "agency.manage");
  const data = e.requestInfo().body;
  const result = agencyLib.withAgencyPlatformStatusTracking(e, () =>
    agencyLib.agencyPlatformRequest("POST", "/api/collections/agency_usage_credits/records", data)
  );
  shared.writeAuditLog(e.app, {
    actorEmployeeId: employee.id,
    action: "agency_platform.usage_credit_granted",
    affectedCollection: "agency_usage_credits",
    affectedRecordId: result.id,
    newValue: data,
  });
  return e.json(200, result);
});
