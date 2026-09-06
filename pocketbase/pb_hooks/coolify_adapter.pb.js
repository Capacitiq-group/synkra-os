/// <reference path="../pb_data/types.d.ts" />

const {
  requirePermission,
  recordIntegrationStatus,
  ApiError,
} = require(`${__hooks}/lib_audit.js`);
const {
  coolifyConfigured,
  syncCoolifyOnce,
} = require(`${__hooks}/lib_coolify.js`);

routerAdd("POST", "/api/infrastructure/sync-coolify", (e) => {
  requirePermission(e, "infrastructure.view");
  if (!coolifyConfigured()) {
    recordIntegrationStatus(e.app, "coolify", "not_configured");
    throw new ApiError(501, "COOLIFY_API_BASE is not configured.");
  }
  try {
    const count = syncCoolifyOnce(e.app);
    recordIntegrationStatus(e.app, "coolify", "connected");
    return e.json(200, { success: true, servers_synced: count });
  } catch (err) {
    recordIntegrationStatus(e.app, "coolify", err.authFailure ? "authentication_failed" : "unavailable", err.message);
    throw new ApiError(502, `Coolify sync failed: ${err.message}`);
  }
});

// Automatic background sync every 5 minutes — infra status shouldn't
// depend on someone remembering to open the Infrastructure page.
cronAdd("sync_coolify_infrastructure", "*/5 * * * *", () => {
  const coolify = require(`${__hooks}/lib_coolify.js`);
  const audit = require(`${__hooks}/lib_audit.js`);

  if (!coolify.coolifyConfigured()) {
    audit.recordIntegrationStatus($app, "coolify", "not_configured");
    return;
  }
  try {
    coolify.syncCoolifyOnce($app);
    audit.recordIntegrationStatus($app, "coolify", "connected");
  } catch (err) {
    audit.recordIntegrationStatus($app, "coolify", err.authFailure ? "authentication_failed" : "unavailable", err.message);
  }
});
