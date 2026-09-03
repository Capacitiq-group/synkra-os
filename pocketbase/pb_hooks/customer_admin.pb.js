/// <reference path="../pb_data/types.d.ts" />

// Dangerous customer actions go through dedicated routes rather than a
// plain PATCH to /api/collections/customers/records/:id, so that:
//   1. the permission check is explicit and specific (not just "can edit"),
//   2. a `reason` is mandatory and gets written to the audit log,
//   3. the mutation and its audit log write are atomic (see runAudited),
//   4. the frontend can require a confirmation step before ever calling this.
routerAdd("POST", "/api/customers/{id}/suspend", (e) => {
  const employee = requirePermission(e, "customers.edit");
  const data = e.requestInfo().body;
  const reason = (data && data.reason) || "";
  if (!reason) {
    throw new ApiError(400, "A reason is required to suspend an account.");
  }

  const customer = findOrNotFound(e.app, "customers", e.request.pathValue("id"), "Customer");
  const previousStatus = customer.get("account_status");

  runAudited(
    e.app,
    (txApp) => {
      customer.set("account_status", "suspended");
      txApp.save(customer);
    },
    {
      actorEmployeeId: employee.id,
      action: "customer.suspend",
      affectedCollection: "customers",
      affectedRecordId: customer.id,
      affectedCustomerId: customer.id,
      previousValue: { account_status: previousStatus },
      newValue: { account_status: "suspended" },
      reason,
      ipAddress: e.request.header.get("X-Forwarded-For") || undefined,
    }
  );

  return e.json(200, {
    success: true,
    account_status: "suspended",
    note: "This updates Synkra OS's own record only. It does NOT block the customer's login or usage in Flow/Chat — that requires a synkra-core enforcement endpoint (POST /admin/users/{id}/suspend) which does not exist yet per the Flow handover doc.",
  });
});

routerAdd("POST", "/api/customers/{id}/reactivate", (e) => {
  const employee = requirePermission(e, "customers.edit");
  const data = e.requestInfo().body;
  const reason = (data && data.reason) || "";

  const customer = findOrNotFound(e.app, "customers", e.request.pathValue("id"), "Customer");
  const previousStatus = customer.get("account_status");

  runAudited(
    e.app,
    (txApp) => {
      customer.set("account_status", "active");
      txApp.save(customer);
    },
    {
      actorEmployeeId: employee.id,
      action: "customer.reactivate",
      affectedCollection: "customers",
      affectedRecordId: customer.id,
      affectedCustomerId: customer.id,
      previousValue: { account_status: previousStatus },
      newValue: { account_status: "active" },
      reason,
    }
  );

  return e.json(200, { success: true, account_status: "active" });
});

// Resend verification / trigger password reset are boundary calls into the
// *product's* own auth system, not this platform's — Synkra OS does not
// own those user tables.
//
// CORRECTED per the Flow handover doc: Flow uses magic-link, passwordless
// authentication. There is no password to reset, and "resend verification"
// isn't a real Flow concept — the actual equivalent is issuing a new
// magic link. Neither of these has a synkra-core endpoint yet (see the
// handover doc's Section 4 recommended build order). These routes always
// refuse — they do NOT fall back to writing a false "success" audit entry
// just because FLOW_API_BASE happens to be set for read access, since a
// read credential says nothing about whether the write endpoint exists.
routerAdd("POST", "/api/customers/{id}/resend-verification", (e) => {
  requirePermission(e, "customers.edit");
  findOrNotFound(e.app, "customers", e.request.pathValue("id"), "Customer");
  throw new ApiError(
    501,
    "There is no 'resend verification' action in synkra-core yet. Flow uses passwordless magic-link auth — the real equivalent is POST /admin/users/{id}/magic-link, which does not exist yet (see the Flow handover doc, Section 4)."
  );
});

routerAdd("POST", "/api/customers/{id}/trigger-password-reset", (e) => {
  requirePermission(e, "customers.edit");
  findOrNotFound(e.app, "customers", e.request.pathValue("id"), "Customer");
  throw new ApiError(
    501,
    "Flow has no password to reset (passwordless magic-link auth) — this action does not apply to Flow customers. If a future product uses password auth, its own synkra-core endpoint would need to exist before this route can do anything real."
  );
});
