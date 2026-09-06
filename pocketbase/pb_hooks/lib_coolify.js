/// <reference path="../pb_data/types.d.ts" />
const { tryFindFirst } = require(`${__hooks}/lib_audit.js`);

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
        check.set("status", ["running", "healthy"].includes(resource.status) ? "pass" : "fail");
        check.set("checked_at", nowIso);
        check.set("detail", `type=${resource.type || "unknown"} coolify_status=${resource.status || "unknown"}`);
        app.save(check);
      }
    } catch (err) {}
  }

  return servers.length;
}

module.exports = {
  coolifyConfigured,
  coolifyRequest,
  syncCoolifyOnce,
};
