/// <reference path="../pb_data/types.d.ts" />

// COOLIFY INFRASTRUCTURE ADAPTER
//
// All Coolify-specific logic (coolifyConfigured/coolifyRequest/syncCoolifyOnce)
// lives in ./coolify_lib.js, and general cross-file helpers (requirePermission,
// recordIntegrationStatus, ApiError) live in ./shared.js. Both are plain
// CommonJS modules, required from INSIDE each handler body below, not
// referenced from outer scope.
//
// Why: PocketBase's JSVM serializes and executes every routerAdd/cronAdd
// handler in its own isolated context — a handler cannot see functions
// declared outside itself, even in the same file. This is documented:
// https://pocketbase.io/docs/js-overview/#handlers-scope
// (Confirmed against this exact repo's production logs: "ReferenceError:
// requirePermission is not defined" / "ReferenceError: coolifyConfigured is
// not defined" — both were previously outer-scope references.)

routerAdd("POST", "/api/infrastructure/sync-coolify", (e) => {
  const shared = require(`${__hooks}/shared.js`);
  const coolifyLib = require(`${__hooks}/coolify_lib.js`);

  shared.requirePermission(e, "infrastructure.view");
  if (!coolifyLib.coolifyConfigured()) {
    shared.recordIntegrationStatus(e.app, "coolify", "not_configured");
    throw new shared.ApiError(501, "COOLIFY_API_BASE is not configured.");
  }
  try {
    const count = coolifyLib.syncCoolifyOnce(e.app);
    shared.recordIntegrationStatus(e.app, "coolify", "connected");
    return e.json(200, { success: true, servers_synced: count });
  } catch (err) {
    shared.recordIntegrationStatus(e.app, "coolify", err.authFailure ? "authentication_failed" : "unavailable", err.message);
    throw new shared.ApiError(502, `Coolify sync failed: ${err.message}`);
  }
});

// Automatic background sync every 5 minutes — infra status shouldn't
// depend on someone remembering to open the Infrastructure page.
cronAdd("sync_coolify_infrastructure", "*/5 * * * *", () => {
  const shared = require(`${__hooks}/shared.js`);
  const coolifyLib = require(`${__hooks}/coolify_lib.js`);

  if (!coolifyLib.coolifyConfigured()) {
    shared.recordIntegrationStatus($app, "coolify", "not_configured");
    return;
  }
  try {
    coolifyLib.syncCoolifyOnce($app);
    shared.recordIntegrationStatus($app, "coolify", "connected");
  } catch (err) {
    shared.recordIntegrationStatus($app, "coolify", err.authFailure ? "authentication_failed" : "unavailable", err.message);
  }
});
