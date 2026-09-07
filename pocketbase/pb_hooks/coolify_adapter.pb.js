/// <reference path="../pb_data/types.d.ts" />

// COOLIFY INFRASTRUCTURE ADAPTER
//
// Grounded in Coolify's real API (confirmed via docs.coolify.io and the
// Coolify server/infrastructure API reference, not guessed):
//   GET /api/v1/servers                     — list servers (VPS)
//   GET /api/v1/servers/{uuid}/resources     — apps/databases/services on
//                                               that server, each with a
//                                               status — works uniformly
//                                               regardless of what's
//                                               deployed (PocketBase,
//                                               PostgreSQL, anything
//                                               Docker-based), which is
//                                               exactly what's needed
//                                               since Synkra runs
//                                               different databases per
//                                               service.
// Auth: Bearer token from Coolify's Keys & Tokens screen.
//
// HONESTY NOTE on metrics: Coolify only reports CPU/RAM/disk numbers when
// its "Sentinel" agent is enabled per-server, and Coolify's own docs state
// metrics collection does NOT work for Docker Compose or Service-Template
// based deployments. This adapter never fabricates a percentage when
// Sentinel data isn't available — cpu_pct/ram_pct/disk_pct are left unset
// rather than defaulted to 0 (0% would look healthy; unset honestly means
// "we don't know").

function coolifyConfigured() {
  return !!$os.getenv("COOLIFY_API_BASE");
}

function coolifyRequest(path) {
  const base = $os.getenv("COOLIFY_API_BASE");
  const token = $os.getenv("COOLIFY_API_TOKEN");
  const res = $http.send({
    url: `${base}/api/v1${path}`,
    method: "GET",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (res.statusCode === 401 || res.statusCode === 403) {
    const err = new Error(`Coolify authentication failed (status ${res.statusCode})`);
    err.authFailure = true;
    throw err;
  }
  if (res.statusCode >= 400) {
    throw new Error(`Coolify request failed (status ${res.statusCode})`);
  }
  return res.json;
}

// Upserts one `servers` row per Coolify server, and one `health_checks`
// row per deployed resource on it (application/database/service) — reuses
// the existing schema rather than adding new collections, since "resource
// status" fits the health_checks shape well enough not to justify one.
function syncCoolifyOnce(app) {
  const serversResult = coolifyRequest("/servers");
  const servers = Array.isArray(serversResult) ? serversResult : serversResult.data || [];
  const nowIso = new Date().toISOString();

  for (const coolifyServer of servers) {
    let serverRecord = tryFindFirst(app, "servers", "host = {:host}", { host: coolifyServer.ip || coolifyServer.uuid });
    if (!serverRecord) {
      const collection = app.findCollectionByNameOrId("servers");
      serverRecord = new Record(collection);
      serverRecord.set("host", coolifyServer.ip || coolifyServer.uuid);
      serverRecord.set("role", "vps");
    }
    serverRecord.set("name", coolifyServer.name || coolifyServer.uuid);
    // Coolify reports reachability/validation, not a health verdict per
    // se — mapped conservatively: unreachable/invalid -> down, otherwise
    // healthy. CPU/RAM/disk are intentionally left untouched (not
    // zeroed) since this adapter doesn't call Sentinel's metrics endpoint.
    const reachable = coolifyServer.settings?.is_reachable !== false && coolifyServer.settings?.is_usable !== false;
    serverRecord.set("status", reachable ? "healthy" : "down");
    serverRecord.set("last_checked_at", nowIso);
    app.save(serverRecord);

    // Per-server resources (apps/databases/services) — this is the part
    // that works the same regardless of database type.
    try {
      const resourcesResult = coolifyRequest(`/servers/${coolifyServer.uuid}/resources`);
      const resources = Array.isArray(resourcesResult) ? resourcesResult : resourcesResult.data || [];
      for (const resource of resources) {
        const healthCollection = app.findCollectionByNameOrId("health_checks");
        const check = new Record(healthCollection);
        check.set("target", resource.name || resource.uuid);
        check.set("status", ["running", "healthy"].includes(resource.status) ? "pass" : "fail");
        check.set("checked_at", nowIso);
        check.set("detail", `type=${resource.type || "unknown"} coolify_status=${resource.status || "unknown"}`);
        app.save(check);
      }
    } catch (err) {
      // A single server's resource list failing shouldn't abort the whole
      // sync — skip it for this pass rather than fabricating a result.
    }
  }

  return servers.length;
}

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
  if (!coolifyConfigured()) {
    recordIntegrationStatus($app, "coolify", "not_configured");
    return;
  }
  try {
    syncCoolifyOnce($app);
    recordIntegrationStatus($app, "coolify", "connected");
  } catch (err) {
    recordIntegrationStatus($app, "coolify", err.authFailure ? "authentication_failed" : "unavailable", err.message);
  }
});
