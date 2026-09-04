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
// CANONICAL CORRECTION (see SYNKRA-ARCHITECTURE.md): the "Agency Platform"
// PocketBase and this Synkra OS PocketBase are the SAME instance — this
// container. So these routes no longer make an authenticated HTTP call to
// a remote instance; they run against the local database directly.
// AGENCY_PLATFORM_PB_BASE_URL / AGENCY_PLATFORM_PB_TOKEN are therefore
// RETIRED and no longer required. If AGENCY_PLATFORM_PB_BASE_URL is still
// set (pointing at a genuinely remote instance during a migration), the
// old remote path is still honoured so nothing hard-cuts.
//
// RESOLVED: service_slug, tier names, and pricing are now real, confirmed
// values from AGENCY-SERVICES-DOCUMENTATION.md — see
// pb_migrations/1735500019_agency_service_pricing.js for the seeded rate
// card. Remaining gap: a lead whose quote was negotiated outside the
// standard rate card (or where service/tier weren't set) still gets
// monthly_price/setup_price left null rather than guessed — that's
// intentional, not an oversight.

function agencyPlatformConfigured() {
  // Local mode is always "configured" — the data lives in this instance.
  return true;
}

function agencyPlatformRemote() {
  return !!$os.getenv("AGENCY_PLATFORM_PB_BASE_URL") && !!$os.getenv("AGENCY_PLATFORM_PB_TOKEN");
}

function recordToPlain(record) {
  try {
    return JSON.parse(JSON.stringify(record));
  } catch (err) {
    return { id: record.id };
  }
}

// Executes the same /api/collections/... shapes the routes below already
// speak, but against the local database instead of over HTTP.
function agencyPlatformLocalRequest(app, method, path, body) {
  const parts = path.split("?");
  const rawPath = parts[0];
  const rawQuery = parts[1] || "";
  const match = rawPath.match(/^\/api\/collections\/([A-Za-z0-9_]+)\/records(?:\/([A-Za-z0-9_-]+))?$/);
  if (!match) {
    throw new Error(`Unsupported local request path: ${rawPath}`);
  }
  const collectionName = match[1];
  const recordId = match[2];

  const query = {};
  rawQuery.split("&").forEach((pair) => {
    if (!pair) return;
    const idx = pair.indexOf("=");
    const key = idx === -1 ? pair : pair.slice(0, idx);
    const value = idx === -1 ? "" : decodeURIComponent(pair.slice(idx + 1).replace(/\+/g, " "));
    query[key] = value;
  });

  if (method === "GET" && recordId) {
    return recordToPlain(app.findRecordById(collectionName, recordId));
  }

  if (method === "GET") {
    const perPage = parseInt(query.perPage || "50", 10);
    const sort = query.sort || "-created";
    const filter = query.filter || "";
    const records = app.findRecordsByFilter(collectionName, filter, sort, perPage, 0);
    return { items: records.map(recordToPlain), totalItems: records.length };
  }

  if (method === "POST") {
    const collection = app.findCollectionByNameOrId(collectionName);
    const record = new Record(collection);
    Object.keys(body || {}).forEach((key) => {
      if (key === "password" || key === "passwordConfirm") return;
      record.set(key, body[key]);
    });
    if (body && body.password) record.setPassword(body.password);
    app.save(record);
    return recordToPlain(record);
  }

  if (method === "PATCH") {
    const record = app.findRecordById(collectionName, recordId);
    Object.keys(body || {}).forEach((key) => {
      if (key === "password" || key === "passwordConfirm") return;
      record.set(key, body[key]);
    });
    if (body && body.password) record.setPassword(body.password);
    app.save(record);
    return recordToPlain(record);
  }

  if (method === "DELETE") {
    const record = app.findRecordById(collectionName, recordId);
    app.delete(record);
    return { success: true };
  }

  throw new Error(`Unsupported local request method: ${method}`);
}

function agencyPlatformRemoteRequest(method, path, body) {
  const base = $os.getenv("AGENCY_PLATFORM_PB_BASE_URL");
  const token = $os.getenv("AGENCY_PLATFORM_PB_TOKEN");
  const res = $http.send({
    url: `${base}${path}`,
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.statusCode === 401 || res.statusCode === 403) {
    const err = new Error(`Agency Platform authentication failed (status ${res.statusCode})`);
    err.authFailure = true;
    throw err;
  }
  if (res.statusCode >= 400) {
    throw new Error(`Agency Platform request failed (status ${res.statusCode}): ${res.raw || ""}`);
  }
  return res.json;
}

// `app` is optional so existing call sites keep working; local mode uses
// the global $app when no app is threaded through.
function agencyPlatformRequest(method, path, body, app) {
  if (agencyPlatformRemote()) return agencyPlatformRemoteRequest(method, path, body);
  return agencyPlatformLocalRequest(app || $app, method, path, body);
}

function withAgencyPlatformStatusTracking(e, fn) {
  try {
    const result = fn();
    recordIntegrationStatus(e.app, "agency_platform", "connected");
    return result;
  } catch (err) {
    recordIntegrationStatus(e.app, "agency_platform", err.authFailure ? "authentication_failed" : "unavailable", err.message);
    throw new ApiError(502, `Agency Platform request failed: ${err.message}`);
  }
}


routerAdd("GET", "/api/agency-platform/status", (e) => {
  requirePermission(e, "agency.view");
  const row = tryFindFirst(e.app, "integration_status", "integration_key = 'agency_platform'", {});
  return e.json(200, row || { integration_key: "agency_platform", status: "not_configured" });
});

// ---- Channel A: reads (Admin Panel = "All", per every row in the doc's table) ----

routerAdd("GET", "/api/agency-platform/clients", (e) => {
  requirePermission(e, "agency.view");
  const q = e.request.url.query().get("q") || "";
  const filterParam = q ? `&filter=${encodeURIComponent(`company_name~"${q}" || contact_email~"${q}"`)}` : "";
  const result = withAgencyPlatformStatusTracking(e, () =>
    agencyPlatformRequest("GET", `/api/collections/clients/records?perPage=50${filterParam}`)
  );
  return e.json(200, { items: result.items || [] });
});

function scopedReadRoute(path, flowCollectionPath, permission) {
  routerAdd("GET", path, (e) => {
    requirePermission(e, permission);
    const clientId = e.request.pathValue("id");
    const filterParam = `?filter=${encodeURIComponent(`client_id="${clientId}" || agency_client_id="${clientId}"`)}&perPage=100`;
    const result = withAgencyPlatformStatusTracking(e, () =>
      agencyPlatformRequest("GET", `/api/collections/${flowCollectionPath}/records${filterParam}`)
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
  requirePermission(e, "agency.view");
  const serviceId = e.request.pathValue("id");
  const result = withAgencyPlatformStatusTracking(e, () =>
    agencyPlatformRequest("GET", `/api/collections/agency_usage_events/records?filter=${encodeURIComponent(`agency_client_service_id="${serviceId}"`)}&perPage=200&sort=-occurred_at`)
  );
  return e.json(200, { items: result.items || [] });
});

routerAdd("GET", "/api/agency-platform/services/{id}/usage-credits", (e) => {
  requirePermission(e, "agency.view");
  const serviceId = e.request.pathValue("id");
  const result = withAgencyPlatformStatusTracking(e, () =>
    agencyPlatformRequest("GET", `/api/collections/agency_usage_credits/records?filter=${encodeURIComponent(`agency_client_service_id="${serviceId}"`)}&perPage=100`)
  );
  return e.json(200, { items: result.items || [] });
});

routerAdd("GET", "/api/agency-platform/invites", (e) => {
  requirePermission(e, "agency.view");
  const result = withAgencyPlatformStatusTracking(e, () =>
    agencyPlatformRequest("GET", "/api/collections/agency_invites/records?perPage=100&sort=-created")
  );
  return e.json(200, { items: result.items || [] });
});

// ---- Channel B: writes — exactly what the doc's table grants Admin Panel ----

routerAdd("POST", "/api/agency-platform/clients", (e) => {
  const employee = requirePermission(e, "agency.manage");
  const data = e.requestInfo().body;
  const result = withAgencyPlatformStatusTracking(e, () =>
    agencyPlatformRequest("POST", "/api/collections/clients/records", data)
  );
  writeAuditLog(e.app, {
    actorEmployeeId: employee.id,
    action: "agency_platform.client_created",
    affectedCollection: "clients",
    affectedRecordId: result.id,
  });
  return e.json(200, result);
});

routerAdd("POST", "/api/agency-platform/clients/{id}/update", (e) => {
  const employee = requirePermission(e, "agency.manage");
  const clientId = e.request.pathValue("id");
  const data = e.requestInfo().body;
  const result = withAgencyPlatformStatusTracking(e, () =>
    agencyPlatformRequest("PATCH", `/api/collections/clients/records/${clientId}`, data)
  );
  writeAuditLog(e.app, {
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
  const employee = requirePermission(e, "agency.manage");
  const serviceId = e.request.pathValue("id");
  const data = e.requestInfo().body;
  const result = withAgencyPlatformStatusTracking(e, () =>
    agencyPlatformRequest("PATCH", `/api/collections/agency_client_services/records/${serviceId}`, data)
  );
  writeAuditLog(e.app, {
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
  const employee = requirePermission(e, "agency.manage");
  const data = e.requestInfo().body;
  data.finalized_by = data.finalized_by || employee.id;
  const result = withAgencyPlatformStatusTracking(e, () =>
    agencyPlatformRequest("POST", "/api/collections/onboarding_notes/records", data)
  );
  writeAuditLog(e.app, {
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
  const employee = requirePermission(e, "agency.manage");
  const reportId = e.request.pathValue("id");
  const data = e.requestInfo().body; // expected: { status, notes }
  if (!data || !data.status) throw new ApiError(400, "status is required.");
  const result = withAgencyPlatformStatusTracking(e, () =>
    agencyPlatformRequest("PATCH", `/api/collections/implementation_reports/records/${reportId}`, { status: data.status })
  );
  writeAuditLog(e.app, {
    actorEmployeeId: employee.id,
    action: "agency_platform.implementation_qc_decision",
    affectedCollection: "implementation_reports",
    affectedRecordId: reportId,
    newValue: { status: data.status },
    reason: data.notes || undefined,
  });
  return e.json(200, result);
});

function agencyPortalBaseUrl() {
  // The Client Portal's own public URL. Optional override; defaults to the
  // real production portal host rather than a placeholder.
  return ($os.getenv("AGENCY_PORTAL_URL") || "https://portal.synkra.co.za").replace(/\/+$/, "");
}

function acceptInviteEmailHtml(invite, link) {
  const company = invite.company_name || "your company";
  return `<!doctype html><html><body style="font-family:system-ui,Arial,sans-serif;background:#0a0a0a;padding:32px;color:#ffffff">
  <div style="max-width:520px;margin:0 auto;background:#0f0f0f;border:1px solid rgba(255,255,255,0.06);border-radius:16px;padding:32px">
    <p style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:rgba(255,255,255,0.4);margin:0">Synkra Agency Portal</p>
    <h1 style="font-size:22px;margin:12px 0 0">You've been invited</h1>
    <p style="color:rgba(255,255,255,0.7);font-size:14px;line-height:1.6">
      An account has been created for ${company}. Click below to set your password and access your portal.
    </p>
    <p style="margin:28px 0">
      <a href="${link}" style="background:#56d722;color:#0a0a0a;padding:12px 20px;border-radius:8px;font-weight:600;text-decoration:none;font-size:14px">Accept your invite</a>
    </p>
    <p style="color:rgba(255,255,255,0.4);font-size:12px;word-break:break-all">If the button doesn't work, paste this link into your browser:<br>${link}</p>
  </div></body></html>`;
}

routerAdd("POST", "/api/agency-platform/invites", (e) => {
  const employee = requirePermission(e, "agency.manage");
  const data = e.requestInfo().body || {};

  if (!data.email) throw new ApiError(400, "email is required.");
  // A token is what makes the emailed link work — generate one server-side
  // when the caller didn't supply it, rather than emailing a dead link.
  if (!data.token) data.token = $security.randomString(48);
  if (!data.status) data.status = "pending";
  if (!data.expires_at) data.expires_at = new Date(Date.now() + 14 * 86400000).toISOString();

  const result = withAgencyPlatformStatusTracking(e, () =>
    agencyPlatformRequest("POST", "/api/collections/agency_invites/records", data, e.app)
  );

  const link = `${agencyPortalBaseUrl()}/accept-invite?token=${encodeURIComponent(data.token)}`;
  const emailResult = sendTransactionalEmail(e.app, {
    to: data.email,
    subject: "Your Synkra Agency Portal invite",
    html: acceptInviteEmailHtml(data, link),
  });

  writeAuditLog(e.app, {
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
  const data = e.requestInfo().body || {};
  const token = data.token;
  const password = data.password;

  if (!token) throw new ApiError(400, "token is required.");
  if (!password || String(password).length < 8) {
    throw new ApiError(400, "password must be at least 8 characters.");
  }

  const invite = tryFindFirst(e.app, "agency_invites", "token = {:token}", { token });
  if (!invite) throw new ApiError(404, "This invite link isn't valid.");
  if (invite.get("status") === "accepted") throw new ApiError(409, "This invite has already been used.");
  const expiresAt = invite.get("expires_at");
  if (invite.get("status") === "expired" || (expiresAt && new Date(expiresAt) < new Date())) {
    throw new ApiError(410, "This invite has expired.");
  }

  const email = invite.get("email");
  const companyName = invite.get("company_name") || email;

  // 1. find-or-create the company (`clients`, not `agency_clients`).
  let client = tryFindFirst(e.app, "clients", "company_name = {:name}", { name: companyName });
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
  if (tryFindFirst(e.app, "agency_client_users", "email = {:email}", { email })) {
    throw new ApiError(409, "An account already exists for this email. Log in instead.");
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
    record: recordToPlain(user),
    client_id: client.id,
    service_ids: createdServiceIds,
  });
});


// Manual usage-credit grant/adjustment — the one collection where the
// doc grants Admin Panel both create and update.
routerAdd("POST", "/api/agency-platform/usage-credits/grant", (e) => {
  const employee = requirePermission(e, "agency.manage");
  const data = e.requestInfo().body;
  const result = withAgencyPlatformStatusTracking(e, () =>
    agencyPlatformRequest("POST", "/api/collections/agency_usage_credits/records", data)
  );
  writeAuditLog(e.app, {
    actorEmployeeId: employee.id,
    action: "agency_platform.usage_credit_granted",
    affectedCollection: "agency_usage_credits",
    affectedRecordId: result.id,
    newValue: data,
  });
  return e.json(200, result);
});

// ---- Bridge: Synkra OS's own payment gate provisions the real client ----
//
// Called from pb_hooks/agency_transitions.pb.js the moment an agency_lead
// crosses NO PAYMENT = NO ONBOARDING into "onboarding". This is what
// makes that gate mean something beyond Synkra OS's own mirror: it's the
// actual creation of the real `clients` + `agency_client_services` rows
// the Client Portal and Admin Panel both read.
//
// Pricing is looked up from the real rate card (agency_service_pricing)
// keyed on the lead's service_slug + tier, in Rand — matching the real
// Agency PocketBase's own amount_rand convention. A lead with no tier
// set, or a custom negotiated deal outside the rate card, gets null
// prices here rather than a guessed number.
function provisionAgencyPlatformClient(app, agencyLead) {
  if (!agencyPlatformConfigured()) {
    // Don't block the stage transition on this — Synkra OS's own record
    // still updates; provisioning can be retried manually once
    // AGENCY_PLATFORM_PB_BASE_URL/TOKEN are configured.
    recordIntegrationStatus(app, "agency_platform", "not_configured");
    return { skipped: true, reason: "AGENCY_PLATFORM_PB_BASE_URL/TOKEN not configured" };
  }

  try {
    let clientId = agencyLead.get("agency_platform_client_id");
    if (!clientId) {
      const clientPayload = {
        company_name: agencyLead.get("company_name"),
        contact_name: agencyLead.get("contact_name") || "",
        contact_email: agencyLead.get("contact_email") || "",
        billing_mode: "manual", // placeholder — confirm against real default policy
        status: "active",
      };
      const clientRes = agencyPlatformRequest("POST", "/api/collections/clients/records", clientPayload);
      clientId = clientRes.id;
    }

    // Real pricing lookup — see pb_migrations/1735500019_agency_service_pricing.js.
    // Rand, not cents: the real Agency PocketBase's own agency_payments
    // collection uses amount_rand, so this matches that system's unit
    // convention at the boundary rather than guessing.
    const serviceSlug = agencyLead.get("service_slug") || "unassigned";
    const tier = agencyLead.get("tier");
    let monthlyPriceRand = null;
    let setupPriceRand = null;
    if (tier && serviceSlug !== "unassigned") {
      const priceRow = tryFindFirst(
        app,
        "agency_service_pricing",
        "service_slug = {:slug} && tier = {:tier}",
        { slug: serviceSlug, tier }
      );
      if (priceRow) {
        monthlyPriceRand = priceRow.get("monthly_price_rand");
        setupPriceRand = priceRow.get("setup_price_rand");
      }
    }

    const servicePayload = {
      agency_client_id: clientId,
      service_slug: serviceSlug,
      tier: tier || null,
      // Real rate card values when service+tier are both set; otherwise
      // left null rather than guessed — a quote negotiated outside the
      // rate card should still show as "confirm manually", not a wrong number.
      monthly_price: monthlyPriceRand,
      setup_price: setupPriceRand,
      status: "active",
      onboarding_status: "paid", // Synkra OS's own gate already confirmed payment before calling this
    };
    const serviceRes = agencyPlatformRequest("POST", "/api/collections/agency_client_services/records", servicePayload);

    recordIntegrationStatus(app, "agency_platform", "connected");
    return { client_id: clientId, service_id: serviceRes.id };
  } catch (err) {
    recordIntegrationStatus(app, "agency_platform", err.authFailure ? "authentication_failed" : "unavailable", err.message);
    // Do not throw — a provisioning failure should not block or corrupt
    // the stage transition that already happened in Synkra OS. It
    // surfaces via integration_status and can be retried from the UI.
    return { skipped: true, reason: err.message };
  }
}
