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
// Configure via AGENCY_PLATFORM_PB_BASE_URL and AGENCY_PLATFORM_PB_TOKEN
// (a pre-issued bearer token for a dedicated, non-superuser service
// account on that instance, per the document's own recommendation — NOT
// the Client Portal's POCKETBASE_ADMIN_EMAIL/PASSWORD pair).
//
// RESOLVED: service_slug, tier names, and pricing are now real, confirmed
// values from AGENCY-SERVICES-DOCUMENTATION.md — see
// pb_migrations/1735500019_agency_service_pricing.js for the seeded rate
// card. Remaining gap: a lead whose quote was negotiated outside the
// standard rate card (or where service/tier weren't set) still gets
// monthly_price/setup_price left null rather than guessed — that's
// intentional, not an oversight.

function agencyPlatformConfigured() {
  return !!$os.getenv("AGENCY_PLATFORM_PB_BASE_URL") && !!$os.getenv("AGENCY_PLATFORM_PB_TOKEN");
}

function agencyPlatformRequest(method, path, body) {
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

function withAgencyPlatformStatusTracking(e, fn) {
  if (!agencyPlatformConfigured()) {
    recordIntegrationStatus(e.app, "agency_platform", "not_configured");
    throw new ApiError(501, "AGENCY_PLATFORM_PB_BASE_URL / AGENCY_PLATFORM_PB_TOKEN are not configured.");
  }
  try {
    const result = fn();
    recordIntegrationStatus(e.app, "agency_platform", "connected");
    return result;
  } catch (err) {
    recordIntegrationStatus(e.app, "agency_platform", err.authFailure ? "authentication_failed" : "unavailable", err.message);
    throw new ApiError(502, `Agency Platform is unavailable: ${err.message}`);
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

routerAdd("POST", "/api/agency-platform/invites", (e) => {
  const employee = requirePermission(e, "agency.manage");
  const data = e.requestInfo().body;
  const result = withAgencyPlatformStatusTracking(e, () =>
    agencyPlatformRequest("POST", "/api/collections/agency_invites/records", data)
  );
  writeAuditLog(e.app, {
    actorEmployeeId: employee.id,
    action: "agency_platform.invite_created",
    affectedCollection: "agency_invites",
    affectedRecordId: result.id,
  });
  return e.json(200, result);
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
