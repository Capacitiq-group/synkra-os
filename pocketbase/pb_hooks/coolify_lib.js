// pb_hooks/coolify_lib.js
//
// Plain CommonJS module (NOT *.pb.js — not auto-loaded as a hook). Required
// from inside coolify_adapter.pb.js's routerAdd/cronAdd handler bodies, per
// PocketBase's handler-scope limitation — see shared.js for the full
// explanation and doc link.
//
// Grounded in Coolify's real API (confirmed via docs.coolify.io):
//   GET /api/v1/servers                     — list servers (VPS)
//   GET /api/v1/servers/{uuid}/resources     — apps/databases/services on
//                                               that server, each with a
//                                               status — works uniformly
//                                               regardless of what's
//                                               deployed (PocketBase,
//                                               PostgreSQL, anything
//                                               Docker-based).
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
// the existing schema rather than adding new collections.
function syncCoolifyOnce(app) {
  const shared = require(`${__hooks}/shared.js`);
  const serversResult = coolifyRequest("/servers");
  const servers = Array.isArray(serversResult) ? serversResult : serversResult.data || [];
  const nowIso = new Date().toISOString();

  for (const coolifyServer of servers) {
    let serverRecord = shared.tryFindFirst(app, "servers", "host = {:host}", { host: coolifyServer.ip || coolifyServer.uuid });
    if (!serverRecord) {
      const collection = app.findCollectionByNameOrId("servers");
      serverRecord = new Record(collection);
      serverRecord.set("host", coolifyServer.ip || coolifyServer.uuid);
      serverRecord.set("role", "vps");
    }
    serverRecord.set("name", coolifyServer.name || coolifyServer.uuid);
    const reachable = coolifyServer.settings?.is_reachable !== false && coolifyServer.settings?.is_usable !== false;
    serverRecord.set("status", reachable ? "healthy" : "down");
    serverRecord.set("last_checked_at", nowIso);
    app.save(serverRecord);

    try {
      const resourcesResult = coolifyRequest(`/servers/${coolifyServer.uuid}/resources`);
      const resources = Array.isArray(resourcesResult) ? resourcesResult : resourcesResult.data || [];
      for (const resource of resources) {
        const healthCollection = app.findCollectionByNameOrId("health_checks");
        const check = new Record(healthCollection);
        check.set("target", resource.name || resource.uuid);
        // Coolify reports resource status as "state:health", e.g.
        // "running:healthy", "running:unknown" (no healthcheck configured
        // for that resource), or "exited:unhealthy". A bare .includes()
        // check against ["running","healthy"] can never match a compound
        // string like "running:healthy" — that's why every genuinely
        // healthy, running resource was showing as "fail". Fail only when
        // the resource isn't actually running, or is running but its own
        // healthcheck explicitly reports unhealthy.
        const [resourceState, resourceHealth] = String(resource.status || "").split(":");
        const isPassing = resourceState === "running" && resourceHealth !== "unhealthy";
        check.set("status", isPassing ? "pass" : "fail");
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

module.exports = { coolifyConfigured, coolifyRequest, syncCoolifyOnce };
