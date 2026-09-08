// pb_hooks/agency_platform_lib.js
//
// Plain CommonJS module (NOT *.pb.js). Required from inside
// agency_platform_adapter.pb.js's routerAdd handler bodies, AND from
// agency_transitions.pb.js's onRecordUpdateRequest hook (which calls
// provisionAgencyPlatformClient) — see shared.js for the full explanation
// of why (PocketBase handler-scope isolation).
//
// Per SYNKRA-ARCHITECTURE.md: the "Agency Platform" PocketBase and this
// Synkra OS PocketBase are the SAME instance — this container. So these
// routes run against the local database directly rather than making an
// authenticated HTTP call to a remote instance. AGENCY_PLATFORM_PB_BASE_URL
// / AGENCY_PLATFORM_PB_TOKEN are RETIRED and no longer required. If
// AGENCY_PLATFORM_PB_BASE_URL is still set (pointing at a genuinely remote
// instance during a migration), the old remote path is still honoured so
// nothing hard-cuts.

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

// `e` is the routerAdd event — this stays a per-handler helper (not
// something invoked outside a handler), so it require()s shared.js itself
// rather than expecting the caller to have already loaded it.
function withAgencyPlatformStatusTracking(e, fn) {
  const shared = require(`${__hooks}/shared.js`);
  try {
    const result = fn();
    shared.recordIntegrationStatus(e.app, "agency_platform", "connected");
    return result;
  } catch (err) {
    shared.recordIntegrationStatus(e.app, "agency_platform", err.authFailure ? "authentication_failed" : "unavailable", err.message);
    throw new shared.ApiError(502, `Agency Platform request failed: ${err.message}`);
  }
}

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

// Called from pb_hooks/agency_transitions.pb.js the moment an agency_lead
// crosses NO PAYMENT = NO ONBOARDING into "onboarding". This is what makes
// that gate mean something beyond Synkra OS's own mirror: it's the actual
// creation of the real `clients` + `agency_client_services` rows the
// Client Portal and Admin Panel both read.
//
// Pricing is looked up from the real rate card (agency_service_pricing)
// keyed on the lead's service_slug + tier, in Rand — matching the real
// Agency PocketBase's own amount_rand convention. A lead with no tier set,
// or a custom negotiated deal outside the rate card, gets null prices
// here rather than a guessed number.
function provisionAgencyPlatformClient(app, agencyLead) {
  const shared = require(`${__hooks}/shared.js`);

  if (!agencyPlatformConfigured()) {
    // Don't block the stage transition on this — Synkra OS's own record
    // still updates; provisioning can be retried manually once
    // AGENCY_PLATFORM_PB_BASE_URL/TOKEN are configured.
    shared.recordIntegrationStatus(app, "agency_platform", "not_configured");
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
      const priceRow = shared.tryFindFirst(
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

    shared.recordIntegrationStatus(app, "agency_platform", "connected");
    return { client_id: clientId, service_id: serviceRes.id };
  } catch (err) {
    shared.recordIntegrationStatus(app, "agency_platform", err.authFailure ? "authentication_failed" : "unavailable", err.message);
    // Do not throw — a provisioning failure should not block or corrupt
    // the stage transition that already happened in Synkra OS. It
    // surfaces via integration_status and can be retried from the UI.
    return { skipped: true, reason: err.message };
  }
}

module.exports = {
  agencyPlatformConfigured,
  agencyPlatformRemote,
  recordToPlain,
  agencyPlatformLocalRequest,
  agencyPlatformRemoteRequest,
  agencyPlatformRequest,
  withAgencyPlatformStatusTracking,
  agencyPortalBaseUrl,
  acceptInviteEmailHtml,
  provisionAgencyPlatformClient,
};
  
