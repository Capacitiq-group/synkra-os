/// <reference path="../pb_data/types.d.ts" />

const IMPERSONATION_MAX_MINUTES = 30;

routerAdd("POST", "/api/impersonation/start", (e) => {
  const employee = requirePermission(e, "customers.impersonate");
  const data = e.requestInfo().body;
  const customerId = data && data.customer_id;
  const reason = (data && data.reason) || "";

  if (!customerId) throw new ApiError(400, "customer_id is required.");
  if (!reason) throw new ApiError(400, "A reason is required to start a support session.");

  // Only one active impersonation session per employee at a time.
  // findFirstRecordByFilter THROWS (does not return null/undefined) when
  // nothing matches — that's the expected, common case here, so it must be
  // caught rather than treated as a truthy/falsy result.
  let existing = null;
  try {
    existing = e.app.findFirstRecordByFilter(
      "impersonation_sessions",
      "employee = {:employee} && status = 'active'",
      { employee: employee.id }
    );
  } catch (err) {
    existing = null;
  }
  if (existing) {
    throw new ApiError(409, "You already have an active support session. End it before starting another.");
  }

  const customer = findOrNotFound(e.app, "customers", customerId, "Customer");

  const startedAt = new Date();
  const expiresAt = new Date(startedAt.getTime() + IMPERSONATION_MAX_MINUTES * 60 * 1000);

  const collection = e.app.findCollectionByNameOrId("impersonation_sessions");
  const session = new Record(collection);
  session.set("employee", employee.id);
  session.set("customer", customer.id);
  session.set("reason", reason);
  session.set("started_at", startedAt.toISOString());
  session.set("expires_at", expiresAt.toISOString());
  session.set("status", "active");

  runAudited(
    e.app,
    (txApp) => {
      txApp.save(session);
    },
    {
      actorEmployeeId: employee.id,
      action: "customer.impersonation_start",
      affectedCollection: "customers",
      affectedRecordId: customer.id,
      affectedCustomerId: customer.id,
      reason,
      newValue: { session_id: session.id, expires_at: expiresAt.toISOString() },
    }
  );

  // The frontend uses this token to show a persistent "SUPPORT MODE —
  // viewing as {customer}, expires in Xm" banner and to scope subsequent
  // read-only customer-data requests. It never grants access to the
  // customer's own login, password, or secrets — impersonation here means
  // "view this customer's operational data as they would see it," not
  // "log in as them."
  return e.json(200, {
    session_id: session.id,
    customer_id: customer.id,
    expires_at: expiresAt.toISOString(),
  });
});

routerAdd("POST", "/api/impersonation/{id}/end", (e) => {
  const authRecord = e.auth;
  if (!authRecord) throw new ApiError(401, "Authentication required.");
  const employeeId = authRecord.get("employee");

  const session = findOrNotFound(e.app, "impersonation_sessions", e.request.pathValue("id"), "Session");
  if (session.get("employee") !== employeeId) {
    throw new ApiError(403, "This is not your support session.");
  }
  if (session.get("status") !== "active") {
    return e.json(200, { success: true, status: session.get("status") });
  }

  runAudited(
    e.app,
    (txApp) => {
      session.set("status", "ended_manually");
      session.set("ended_at", new Date().toISOString());
      txApp.save(session);
    },
    {
      actorEmployeeId: employeeId,
      action: "customer.impersonation_end",
      affectedCollection: "customers",
      affectedRecordId: session.get("customer"),
      affectedCustomerId: session.get("customer"),
    }
  );

  return e.json(200, { success: true, status: "ended_manually" });
});

// Background sweep: expire any session past its hard cutoff even if the
// operator never clicks "end session" (closed laptop, crashed tab, etc.).
// Runs every minute — cheap query, and this is a security control so it
// must not depend on client behaviour.
cronAdd("expire_impersonation_sessions", "* * * * *", () => {
  const nowIso = new Date().toISOString();
  const expired = $app.findRecordsByFilter(
    "impersonation_sessions",
    "status = 'active' && expires_at <= {:now}",
    "-expires_at",
    200,
    0,
    { now: nowIso }
  );
  for (const session of expired) {
    session.set("status", "expired");
    session.set("ended_at", nowIso);
    $app.save(session);
  }
});
