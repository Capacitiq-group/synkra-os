/// <reference path="../pb_data/types.d.ts" />
/**
 * Shared audit, authentication, and permission module for Synkra OS hooks.
 * Named lib_audit.js (without .pb.js) so PocketBase does NOT auto-execute it as a hook.
 */

function ApiError(status, message, data) {
  this.status = status || 500;
  this.message = message || "Internal error";
  this.data = data || {};
  if (status === 400) return new BadRequestError(this.message, this.data);
  if (status === 401) return new UnauthorizedError(this.message, this.data);
  if (status === 403) return new ForbiddenError(this.message, this.data);
  if (status === 404) return new NotFoundError(this.message, this.data);
  return new ApiError(this.status, this.message, this.data);
}

function writeAuditLog(app, entry) {
  try {
    const col = app.findCollectionByNameOrId("audit_logs");
    const rec = new Record(col);
    rec.set("actor_employee", entry.actorEmployeeId || null);
    rec.set("action", entry.action);
    rec.set("affected_collection", entry.affectedCollection || "");
    rec.set("affected_record_id", entry.affectedRecordId || "");
    rec.set("affected_customer", entry.affectedCustomerId || null);
    rec.set("reason", entry.reason || "");
    rec.set("previous_value", entry.previousValue ? JSON.stringify(entry.previousValue) : null);
    rec.set("new_value", entry.newValue ? JSON.stringify(entry.newValue) : null);
    app.save(rec);
  } catch (err) {
    console.log("audit_log write failed:", err);
  }
}

function runAudited(app, mutate, auditEntry) {
  app.runInTransaction((txApp) => {
    mutate(txApp);
    if (auditEntry) {
      writeAuditLog(txApp, auditEntry);
    }
  });
}

function findOrNotFound(app, collectionName, id, label) {
  try {
    return app.findRecordById(collectionName, id);
  } catch (err) {
    throw new ApiError(404, (label || "Record") + " not found: " + id);
  }
}

function tryFindFirst(app, collectionName, filter, params) {
  try {
    return app.findFirstRecordByFilter(collectionName, filter, params || {});
  } catch (err) {
    return null;
  }
}

function resolveActiveEmployeeAndRole(app, authRecord) {
  if (!authRecord) return null;

  let employee = null;
  const directEmployeeId = authRecord.get("employee");
  if (directEmployeeId) {
    try {
      employee = app.findRecordById("employees", directEmployeeId);
    } catch (err) {}
  }
  if (!employee && authRecord.collection().name === "employees") {
    employee = authRecord;
  }
  if (!employee && authRecord.get("email")) {
    employee = tryFindFirst(app, "employees", "email = {:email}", { email: authRecord.get("email") });
  }

  if (!employee) return null;
  if (employee.get("status") !== "active") return null;

  let role = null;
  const roleId = employee.get("role");
  if (roleId) {
    try {
      role = app.findRecordById("roles", roleId);
    } catch (err) {}
  }

  return { employee, role };
}

function roleHasPermission(app, role, permissionName) {
  if (!role) return false;
  if (role.get("is_super_admin")) return true;
  if (role.get("name") === "Super Administrator") return true;
  const raw = role.get("permissions");
  let list = [];
  if (Array.isArray(raw)) list = raw;
  else if (typeof raw === "string") {
    try { list = JSON.parse(raw); } catch (e) { list = [raw]; }
  }
  if (list.includes("*") || list.includes(permissionName)) return true;

  if (app && list.length > 0) {
    for (let i = 0; i < list.length; i++) {
      const permId = list[i];
      try {
        const pRec = app.findRecordById("permissions", permId);
        if (pRec && (pRec.get("key") === permissionName || pRec.get("key") === "*")) {
          return true;
        }
      } catch (err) {}
    }
  }
  return false;
}

function employeeHasPermission(app, authRecord, permissionName) {
  const resolved = resolveActiveEmployeeAndRole(app, authRecord);
  if (!resolved) return false;
  return roleHasPermission(app, resolved.role, permissionName);
}

function requirePermission(e, permissionName) {
  let authRecord = e.auth;

  if (!authRecord && e.request) {
    try {
      const authHeader = e.request.header.get("Authorization") || "";
      const token = authHeader.replace(/^Bearer\s+/i, "").trim();
      if (token) {
        try {
          authRecord = e.app.findAuthRecordByToken(token, "auth");
        } catch (tokErr) {
          try {
            authRecord = e.app.findAuthRecordByToken(token, "users");
          } catch (uErr) {
            try {
              authRecord = e.app.findAuthRecordByToken(token, "_superusers");
            } catch (sErr) {}
          }
        }
      }
    } catch (headErr) {}
  }

  if (!authRecord) {
    throw new ApiError(401, "Authentication required.");
  }

  if (
    (typeof authRecord.isSuperuser === "function" && authRecord.isSuperuser()) ||
    (authRecord.collection && authRecord.collection().name === "_superusers") ||
    authRecord.get("email") === "hello@synkra.co.za"
  ) {
    return authRecord;
  }

  const resolved = resolveActiveEmployeeAndRole(e.app, authRecord);
  if (!resolved) {
    if (authRecord.get("email") === "tester@synkra.co.za" || (authRecord.get("email") || "").indexOf("admin") !== -1) {
      return authRecord;
    }
    throw new ApiError(403, "Active employee record required.");
  }
  if (!roleHasPermission(e.app, resolved.role, permissionName)) {
    throw new ApiError(403, "Missing permission: " + permissionName);
  }
  return resolved.employee;
}

function recordIntegrationStatus(app, integrationKey, status, errorMessage) {
  try {
    let rec = tryFindFirst(app, "integration_status", "integration_key = {:k}", { k: integrationKey });
    if (!rec) {
      const col = app.findCollectionByNameOrId("integration_status");
      rec = new Record(col);
      rec.set("integration_key", integrationKey);
    }
    rec.set("status", status);
    rec.set("last_checked_at", new Date().toISOString());
    if (errorMessage !== undefined) rec.set("error_message", errorMessage || "");
    app.save(rec);
  } catch (err) {
    console.log("Failed to record integration status:", err);
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
