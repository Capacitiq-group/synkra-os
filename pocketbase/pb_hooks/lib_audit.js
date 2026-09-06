/// <reference path="../pb_data/types.d.ts" />

function ApiError(status, message, data) {
  if (status === 401 && typeof UnauthorizedError !== "undefined") {
    return new UnauthorizedError(message, data);
  }
  if (status === 403 && typeof ForbiddenError !== "undefined") {
    return new ForbiddenError(message, data);
  }
  if (status === 404 && typeof NotFoundError !== "undefined") {
    return new NotFoundError(message, data);
  }
  if (typeof BadRequestError !== "undefined") {
    const err = new BadRequestError(message, data);
    err.status = status;
    return err;
  }
  const err = new Error(message);
  err.status = status;
  return err;
}

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

function runAudited(app, mutate, auditFields) {
  app.runInTransaction((txApp) => {
    mutate(txApp);
    writeAuditLog(txApp, auditFields);
  });
}

function findOrNotFound(app, collection, id, label) {
  try {
    return app.findRecordById(collection, id);
  } catch (err) {
    throw new ApiError(404, `${label || "Record"} not found.`);
  }
}

function tryFindFirst(app, collection, filter, params) {
  try {
    return app.findFirstRecordByFilter(collection, filter, params);
  } catch (err) {
    return null;
  }
}

function getAuthRecord(e) {
  if (e.auth) return e.auth;
  try {
    const header = e.request.header.get("Authorization") || e.request.header.get("authorization") || "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : header.trim();
    if (token) {
      return e.app.findAuthRecordByToken(token, "auth");
    }
  } catch (err) {}
  return null;
}

function resolveActiveEmployeeAndRole(e) {
  const authRecord = getAuthRecord(e);
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
    try {
      const perm = e.app.findRecordById("permissions", permId);
      return perm && perm.get("key") === permissionKey;
    } catch (err) {
      return false;
    }
  });
}

function employeeHasPermission(e, permissionKey) {
  const resolved = resolveActiveEmployeeAndRole(e);
  if (!resolved) return false;
  return roleHasPermission(e, resolved.role, permissionKey);
}

function requirePermission(e, permissionKey) {
  const authRecord = getAuthRecord(e);
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

function recordIntegrationStatus(app, integrationKey, status, errorMessage) {
  let row;
  try {
    row = app.findFirstRecordByFilter("integration_status", "integration_key = {:key}", { key: integrationKey });
  } catch (err) {
    return;
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

module.exports = {
  ApiError,
  writeAuditLog,
  runAudited,
  findOrNotFound,
  tryFindFirst,
  resolveActiveEmployeeAndRole,
  roleHasPermission,
  employeeHasPermission,
  requirePermission,
  recordIntegrationStatus,
};
