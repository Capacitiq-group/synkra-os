/// <reference path="../pb_data/types.d.ts" />

function ApiError(status, message, data) {
  this.status = status || 500;
  this.message = message || "Internal Server Error";
  this.data = data || {};
}
ApiError.prototype = Object.create(Error.prototype);
ApiError.prototype.constructor = ApiError;

function writeAuditLog(app, options) {
  try {
    const col = app.findCollectionByNameOrId("audit_logs");
    const rec = new Record(col);
    rec.set("action", options.action);
    rec.set("entity_type", options.entityType || "");
    rec.set("entity_id", options.entityId || "");
    if (options.actor) {
      rec.set("actor", options.actor.id);
    }
    rec.set("ip_address", options.ip || "");
    rec.set("before_state", options.beforeState ? JSON.stringify(options.beforeState) : null);
    rec.set("after_state", options.afterState ? JSON.stringify(options.afterState) : null);
    rec.set("diff", options.diff ? JSON.stringify(options.diff) : null);
    app.save(rec);
    return rec;
  } catch (err) {
    console.log("[writeAuditLog] Failed to write audit log:", err);
    return null;
  }
}

function runAudited(e, options, fn) {
  const result = fn();
  const actor = e.auth || null;
  const ip = (e.realIP && e.realIP()) || "";
  writeAuditLog(e.app, {
    action: options.action,
    entityType: options.entityType,
    entityId: options.entityId || (result && result.id) || "",
    actor: actor,
    ip: ip,
    beforeState: options.beforeState,
    afterState: options.afterState || result,
    diff: options.diff,
  });
  return result;
}

function findOrNotFound(app, collectionName, id) {
  try {
    return app.findRecordById(collectionName, id);
  } catch (err) {
    throw new ApiError(404, `${collectionName} record ${id} not found`);
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
    return;
  }
  if (auth.get("is_superuser") === true) {
    return;
  }
  if (!employeeHasPermission(e.app, auth, requiredKey)) {
    throw new ApiError(403, `Permission denied: ${requiredKey}`);
  }
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
    if (details !== undefined) {
      rec.set("details", typeof details === "string" ? details : JSON.stringify(details));
    }
    rec.set("last_checked_at", new Date().toISOString());
    app.save(rec);
  } catch (err) {
    console.log("[recordIntegrationStatus] Failed to update integration status for " + key + ":", err);
  }
}

globalThis.ApiError = ApiError;
globalThis.writeAuditLog = writeAuditLog;
globalThis.runAudited = runAudited;
globalThis.findOrNotFound = findOrNotFound;
globalThis.tryFindFirst = tryFindFirst;
globalThis.resolveActiveEmployeeAndRole = resolveActiveEmployeeAndRole;
globalThis.roleHasPermission = roleHasPermission;
globalThis.employeeHasPermission = employeeHasPermission;
globalThis.requirePermission = requirePermission;
globalThis.recordIntegrationStatus = recordIntegrationStatus;
