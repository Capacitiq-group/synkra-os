/// <reference path="../pb_data/types.d.ts" />

// Shared helper: every administrative action funnels through this so the
// audit trail format stays consistent. Called only from server-side hook
// code (never reachable directly from the client — see collection rules
// on `audit_logs`, which block create via the API entirely).
function writeAuditLog(app, {
  actorEmployeeId,
  action,
  affectedCollection,
  affectedRecordId,
  affectedCustomerId,
  previousValue,
  newValue,
  reason,
  ipAddress,
}) {
  const collection = app.findCollectionByNameOrId("audit_logs");
  const record = new Record(collection);
  record.set("actor_employee", actorEmployeeId);
  record.set("action", action);
  if (affectedCollection) record.set("affected_collection", affectedCollection);
  if (affectedRecordId) record.set("affected_record_id", affectedRecordId);
  if (affectedCustomerId) record.set("affected_customer", affectedCustomerId);
  if (previousValue !== undefined) record.set("previous_value", previousValue);
  if (newValue !== undefined) record.set("new_value", newValue);
  if (reason) record.set("reason", reason);
  if (ipAddress) record.set("ip_address", ipAddress);
  record.set("occurred_at", new Date().toISOString());
  app.save(record);
}

// Runs a mutation + its audit log write as a single atomic unit: if either
// fails, both roll back — we never want a suspend/refund/etc. to succeed
// silently without an audit trail, or an audit entry for a change that
// didn't actually happen. `mutate` receives the transactional app instance
// and must perform the record change(s) using it; `auditFields` is passed
// straight to writeAuditLog.
//
// Relies on App.RunInTransaction (PocketBase Go core, available since
// v0.23+, exposed to JSVM as app.runInTransaction). If your PocketBase
// version's JSVM binding differs, replace this with two sequential
// app.save() calls — atomicity is a hardening measure here, not something
// the rest of the code depends on for correctness.
function runAudited(app, mutate, auditFields) {
  app.runInTransaction((txApp) => {
    mutate(txApp);
    writeAuditLog(txApp, auditFields);
  });
}

// Wraps a lookup so a missing record becomes a clean 404 instead of a raw
// "sql: no rows" error leaking to the client.
function findOrNotFound(app, collection, id, label) {
  try {
    return app.findRecordById(collection, id);
  } catch (err) {
    throw new ApiError(404, `${label || "Record"} not found.`);
  }
}

// findFirstRecordByFilter throws (does not return null/undefined) when no
// record matches — that's frequently the expected, common-case outcome
// (e.g. "does a lead with this email already exist?"), so callers that want
// null-on-miss semantics should go through this instead of calling the raw
// method directly.
function tryFindFirst(app, collection, filter, params) {
  try {
    return app.findFirstRecordByFilter(collection, filter, params);
  } catch (err) {
    return null;
  }
}

// Resolve the calling employee + role once; returns null (never throws) if
// there is no valid, active, employee-linked session. Shared by
// requirePermission (throws) and employeeHasPermission (returns boolean) so
// both stay in sync.
function resolveActiveEmployeeAndRole(e) {
  const authRecord = e.auth;
  if (!authRecord) return null;
  const employeeId = authRecord.get("employee");
  if (!employeeId) return null;
  let employee;
  try {
    employee = e.app.findRecordById("employees", employeeId);
  } catch (err) {
    return null;
  }
  if (employee.get("status") !== "active") return null;
  let role;
  try {
    role = e.app.findRecordById("roles", employee.get("role"));
  } catch (err) {
    return null;
  }
  return { employee, role };
}

function roleHasPermission(e, role, permissionKey) {
  if (role.get("is_super_admin")) return true;
  const rolePermissionIds = role.get("permissions") || [];
  return rolePermissionIds.some((permId) => {
    const perm = e.app.findRecordById("permissions", permId);
    return perm && perm.get("key") === permissionKey;
  });
}

// Non-throwing permission check — use this anywhere you need to filter or
// branch behavior by permission (e.g. cross-collection search) rather than
// reject the whole request. Returns false for any invalid/inactive session
// rather than throwing, since "not allowed to see this" and "not logged in"
// should both just mean "omit this."
function employeeHasPermission(e, permissionKey) {
  const resolved = resolveActiveEmployeeAndRole(e);
  if (!resolved) return false;
  return roleHasPermission(e, resolved.role, permissionKey);
}

// Resolve the calling employee record + whether they hold a permission key.
// `is_super_admin` always short-circuits to true. Throws on failure — use
// this for routes that should reject outright rather than degrade.
function requirePermission(e, permissionKey) {
  const authRecord = e.auth;
  if (!authRecord) {
    throw new ApiError(401, "Authentication required.");
  }
  const employeeId = authRecord.get("employee");
  if (!employeeId) {
    throw new ApiError(403, "This login is not linked to an employee record.");
  }
  const employee = findOrNotFound(e.app, "employees", employeeId, "Employee");
  if (employee.get("status") !== "active") {
    throw new ApiError(403, "Employee account is not active.");
  }
  const role = findOrNotFound(e.app, "roles", employee.get("role"), "Role");
  if (!roleHasPermission(e, role, permissionKey)) {
    throw new ApiError(403, `Missing required permission: ${permissionKey}`);
  }
  return employee;
}

// Every adapter (Flow, Chat, Resend, ...) calls this on EVERY attempt —
// success or failure — so integration_status always reflects reality.
// Never called with "connected" unless a real round-trip actually
// succeeded; never silently skipped on failure.
function recordIntegrationStatus(app, integrationKey, status, errorMessage) {
  let row;
  try {
    row = app.findFirstRecordByFilter("integration_status", "integration_key = {:key}", { key: integrationKey });
  } catch (err) {
    return; // row should always exist from the seed migration; don't crash the caller if it's somehow missing
  }
  const nowIso = new Date().toISOString();
  row.set("status", status);
  row.set("last_checked_at", nowIso);
  if (status === "connected") {
    row.set("last_successful_at", nowIso);
    row.set("last_error", "");
  } else if (errorMessage) {
    row.set("last_error", String(errorMessage).slice(0, 500));
  }
  app.save(row);
}
