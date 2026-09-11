// pb_hooks/shared.js
//
// Plain CommonJS module — deliberately NOT named *.pb.js, so PocketBase does
// NOT auto-load/execute this as a hook file. Every routerAdd/cronAdd/onRecord*
// handler that needs any of these must pull them in with require() INSIDE its
// own handler body, e.g.:
//
//   routerAdd("POST", "/api/whatever", (e) => {
//     const shared = require(`${__hooks}/shared.js`);
//     const employee = shared.requirePermission(e, "some.permission");
//     ...
//   });
//
// Why: PocketBase's JSVM serializes and executes every handler in its own
// isolated context — a handler cannot see functions/variables declared
// outside itself, even in the same file. globalThis assignments from a
// *.pb.js file's top-level code do NOT survive into a later handler
// invocation. This is documented, not a bug we introduced:
// https://pocketbase.io/docs/js-overview/#handlers-scope
//
// require() calls use a shared module registry across handler invocations
// (cheap, cached) — that part IS safe to rely on.

function ApiError(status, message, data) {
  this.status = status || 500;
  this.message = message || "Internal Server Error";
  this.data = data || {};
}
ApiError.prototype = Object.create(Error.prototype);
ApiError.prototype.constructor = ApiError;

// options fields match pb_migrations/1735500006_audit_and_impersonation.js's
// audit_logs schema (camelCase in, snake_case column names out):
//   actorEmployeeId  -> actor_employee   (relation, required on the record
//                       but tolerated missing here for system-initiated writes)
//   action           -> action           (required)
//   affectedCollection -> affected_collection
//   affectedRecordId   -> affected_record_id
//   affectedCustomerId -> affected_customer
//   previousValue    -> previous_value   (json)
//   newValue         -> new_value        (json)
//   reason           -> reason
//   ipAddress        -> ip_address
// occurred_at is required by the schema and is always stamped here — never
// leave it to the caller.
function writeAuditLog(app, options) {
  try {
    const col = app.findCollectionByNameOrId("audit_logs");
    const rec = new Record(col);
    rec.set("action", options.action || "");
    if (options.actorEmployeeId) rec.set("actor_employee", options.actorEmployeeId);
    if (options.affectedCollection) rec.set("affected_collection", options.affectedCollection);
    if (options.affectedRecordId) rec.set("affected_record_id", options.affectedRecordId);
    if (options.affectedCustomerId) rec.set("affected_customer", options.affectedCustomerId);
    if (options.previousValue !== undefined) rec.set("previous_value", options.previousValue);
    if (options.newValue !== undefined) rec.set("new_value", options.newValue);
    if (options.reason) rec.set("reason", options.reason);
    if (options.ipAddress) rec.set("ip_address", options.ipAddress);
    rec.set("occurred_at", new Date().toISOString());
    app.save(rec);
    return rec;
  } catch (err) {
    console.log("[writeAuditLog] Failed to write audit log:", err);
    return null;
  }
}

// Runs a mutation and its audit-log entry inside a single transaction, so
// a dangerous action (refund, suspend, impersonate, AI job review, ...)
// and the audit trail for it either both land or both roll back together.
// Call shape used by every caller in this repo: runAudited(app, fn, options)
function runAudited(app, fn, options) {
  let result;
  app.runInTransaction((txApp) => {
    result = fn(txApp);
    writeAuditLog(txApp, {
      action: options.action,
      actorEmployeeId: options.actorEmployeeId,
      affectedCollection: options.affectedCollection,
      affectedRecordId: options.affectedRecordId || (result && result.id) || "",
      affectedCustomerId: options.affectedCustomerId,
      previousValue: options.previousValue,
      newValue: options.newValue,
      reason: options.reason,
      ipAddress: options.ipAddress,
    });
  });
  return result;
}

function findOrNotFound(app, collectionName, id, label) {
  try {
    return app.findRecordById(collectionName, id);
  } catch (err) {
    throw new ApiError(404, `${label || collectionName} ${id} not found`);
  }
}

function tryFindFirst(app, collectionName, filter, params) {
  try {
    return app.findFirstRecordByFilter(collectionName, filter, params || {});
  } catch (err) {
    return null;
  }
}

function resolveActiveEmployeeAndRole(app, userRecord) {
  if (!userRecord) return null;
  if (userRecord.collection().name === "_superusers") {
    return {
      employee: { id: "superuser", status: "active" },
      role: { id: "super_admin", name: "Super Admin", permissions: ["*"] },
      isSuperuser: true,
    };
  }
  const emp = tryFindFirst(
    app,
    "employees",
    "user = {:uid} && status = 'active'",
    { uid: userRecord.id }
  );
  if (!emp) return null;

  let role = null;
  const roleId = emp.get("role");
  if (roleId) {
    try {
      role = app.findRecordById("roles", roleId);
    } catch (e) {
      role = null;
    }
  }
  return { employee: emp, role: role, isSuperuser: false };
}

function roleHasPermission(app, roleRecord, requiredKey) {
  if (!roleRecord) return false;
  if (roleRecord.id === "super_admin" || roleRecord.name === "Super Admin") {
    return true;
  }
  const perms = roleRecord.get("permissions");
  if (!perms) return false;
  const permList = Array.isArray(perms) ? perms : [perms];
  if (permList.length === 0) return false;

  let targetId = requiredKey;
  try {
    const permRecord = tryFindFirst(app, "permissions", "key = {:key}", { key: requiredKey });
    if (permRecord) {
      targetId = permRecord.id;
    }
  } catch (e) {}

  return permList.indexOf(requiredKey) !== -1 ||
         permList.indexOf(targetId) !== -1 ||
         permList.indexOf("*") !== -1;
}

function employeeHasPermission(app, userRecord, requiredKey) {
  if (!userRecord) return false;
  if (userRecord.collection().name === "_superusers") return true;
  const resolved = resolveActiveEmployeeAndRole(app, userRecord);
  if (!resolved) return false;
  if (resolved.isSuperuser) return true;
  if (!resolved.role) return false;
  return roleHasPermission(app, resolved.role, requiredKey);
}

function requirePermission(e, requiredKey) {
  const auth = e.auth;
  if (!auth) {
    throw new ApiError(401, "Authentication required");
  }
  if (auth.collection().name === "_superusers") {
    return { id: "superuser", status: "active" };
  }
  const resolved = resolveActiveEmployeeAndRole(e.app, auth);
  if (!resolved || !resolved.role || !roleHasPermission(e.app, resolved.role, requiredKey)) {
    throw new ApiError(403, `Permission denied: ${requiredKey}`);
  }
  return resolved.employee;
}

function recordIntegrationStatus(app, key, status, details) {
  try {
    let rec = tryFindFirst(app, "integration_status", "integration_key = {:key}", { key: key });
    if (!rec) {
      const col = app.findCollectionByNameOrId("integration_status");
      rec = new Record(col);
      rec.set("integration_key", key);
    }
    rec.set("status", status);
    const nowIso = new Date().toISOString();
    rec.set("last_checked_at", nowIso);
    if (status === "connected") {
      rec.set("last_successful_at", nowIso);
      rec.set("last_error", "");
    } else if (details !== undefined) {
      rec.set("last_error", typeof details === "string" ? details : JSON.stringify(details));
    }
    app.save(rec);
  } catch (err) {
    console.log("[recordIntegrationStatus] Failed to update integration status for " + key + ":", err);
  }
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

    
