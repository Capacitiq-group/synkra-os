/// <reference path="../pb_data/types.d.ts" />

// Synkra OS's own liveness/readiness — what Coolify/Docker health checks
// hit. Kept unauthenticated and cheap on purpose.
routerAdd("GET", "/health", (e) => {
  return e.json(200, { status: "ok" });
});

routerAdd("GET", "/ready", (e) => {
  try {
    e.app.findFirstRecordByFilter("roles", "is_super_admin = true");
    return e.json(200, { status: "ready" });
  } catch (err) {
    return e.json(503, { status: "not_ready", detail: "database not migrated/seeded yet" });
  }
});

// One global search across the entities operators actually look up.
//
// IMPORTANT: findRecordsByFilter runs in a superuser context and does NOT
// apply the target collection's listRule — it is a direct, unfiltered
// query. So each entity type below is explicitly gated by
// employeeHasPermission() using the SAME permission key that collection's
// own listRule requires (see pb_migrations/), before it is ever queried.
// A user cannot discover a record through search that they couldn't list
// directly — if you add a new entity type here, you MUST add the matching
// permission check, or it silently becomes an access-control bypass.
routerAdd("GET", "/api/search", (e) => {
  const authRecord = e.auth;
  if (!authRecord) throw new ApiError(401, "Authentication required.");

  const query = e.request.url.query().get("q");
  if (!query || query.trim().length < 2) {
    return e.json(200, { results: [] });
  }
  const q = query.trim();
  const like = `%${q}%`;
  const results = [];

  function pushMatches(collectionName, filter, params, mapFn, requiredPermission) {
    if (requiredPermission && !employeeHasPermission(e, requiredPermission)) return;
    try {
      const records = e.app.findRecordsByFilter(collectionName, filter, "-created", 5, 0, params);
      for (const r of records) results.push(mapFn(r));
    } catch (err) {
      // Missing collection or bad filter shouldn't break the whole search.
    }
  }

  // Permission keys here mirror each collection's own listRule exactly —
  // see the matching migration file for the source of truth.
  pushMatches(
    "customers",
    "name ~ {:q} || email ~ {:q} || organisation.name ~ {:q} || customer_code ~ {:q} || phone ~ {:q}",
    { q: like },
    (r) => ({ type: "customer", id: r.id, label: r.get("name"), sublabel: r.get("email") }),
    "customers.view"
  );
  // subscriptions listRule accepts customers.view OR billing.view — check
  // both, then de-dup below.
  pushMatches(
    "subscriptions",
    "subscription_code ~ {:q}",
    { q: like },
    (r) => ({ type: "subscription", id: r.id, label: r.get("subscription_code") }),
    "customers.view"
  );
  pushMatches(
    "subscriptions",
    "subscription_code ~ {:q}",
    { q: like },
    (r) => ({ type: "subscription", id: r.id, label: r.get("subscription_code") }),
    "billing.view"
  );
  pushMatches(
    "invoices",
    "invoice_number ~ {:q}",
    { q: like },
    (r) => ({ type: "invoice", id: r.id, label: r.get("invoice_number") }),
    "billing.view"
  );
  pushMatches(
    "support_tickets",
    "subject ~ {:q} || ticket_number ~ {:q}",
    { q: like },
    (r) => ({ type: "ticket", id: r.id, label: r.get("subject") }),
    "support.view"
  );
  pushMatches(
    "agency_leads",
    "company_name ~ {:q}",
    { q: like },
    (r) => ({ type: "agency_lead", id: r.id, label: r.get("company_name") }),
    "agency.view"
  );
  pushMatches(
    "partners",
    "company_name ~ {:q}",
    { q: like },
    (r) => ({ type: "partner", id: r.id, label: r.get("company_name") }),
    "partners.view"
  );
  pushMatches(
    "ai_employees",
    "name ~ {:q}",
    { q: like },
    (r) => ({ type: "ai_employee", id: r.id, label: r.get("name") }),
    "ai.view"
  );
  pushMatches(
    "incidents",
    "title ~ {:q}",
    { q: like },
    (r) => ({ type: "incident", id: r.id, label: r.get("title") }),
    "incidents.view"
  );

  // De-duplicate: the two subscription queries above can both match the
  // same record if the caller holds both permissions.
  const seen = new Set();
  const deduped = results.filter((r) => {
    const key = `${r.type}:${r.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return e.json(200, { results: deduped });
});
