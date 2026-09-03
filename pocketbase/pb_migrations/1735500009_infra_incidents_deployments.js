/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  const employees = app.findCollectionByNameOrId("employees");
  const customers = app.findCollectionByNameOrId("customers");

  const servers = new Collection({
    type: "base",
    name: "servers",
    fields: [
      { name: "name", type: "text", required: true, presentable: true, max: 100 },
      { name: "host", type: "text", max: 200 },
      { name: "role", type: "select", maxSelect: 1, values: ["app", "database", "worker", "vps"] },
      { name: "cpu_pct", type: "number" },
      { name: "ram_pct", type: "number" },
      { name: "disk_pct", type: "number" },
      { name: "uptime_seconds", type: "number" },
      { name: "status", type: "select", required: true, maxSelect: 1, values: ["healthy", "degraded", "down", "unknown"] },
      { name: "last_checked_at", type: "date" },
    ],
    indexes: ["CREATE INDEX idx_servers_status ON servers (status)"],
    listRule: "@request.auth.employee.role.permissions.key ?= 'infrastructure.view' || @request.auth.employee.role.is_super_admin = true",
    viewRule: "@request.auth.employee.role.permissions.key ?= 'infrastructure.view' || @request.auth.employee.role.is_super_admin = true",
    createRule: null, // populated by the health-check worker only
    updateRule: null,
    deleteRule: null,
  });
  app.save(servers);

  const healthChecks = new Collection({
    type: "base",
    name: "health_checks",
    fields: [
      { name: "target", type: "text", required: true, max: 100 }, // e.g. "synkra-flow", "synkra-chat"
      { name: "endpoint", type: "text", max: 200 }, // e.g. "/health"
      { name: "status", type: "select", required: true, maxSelect: 1, values: ["pass", "fail"] },
      { name: "response_ms", type: "number" },
      { name: "checked_at", type: "date", required: true },
      { name: "detail", type: "text", max: 500 },
    ],
    indexes: [
      "CREATE INDEX idx_health_target ON health_checks (target)",
      "CREATE INDEX idx_health_checked_at ON health_checks (checked_at)",
    ],
    listRule: "@request.auth.employee.role.permissions.key ?= 'infrastructure.view' || @request.auth.employee.role.is_super_admin = true",
    viewRule: "@request.auth.employee.role.permissions.key ?= 'infrastructure.view' || @request.auth.employee.role.is_super_admin = true",
    createRule: null,
    updateRule: null,
    deleteRule: null,
  });
  app.save(healthChecks);

  const incidents = new Collection({
    type: "base",
    name: "incidents",
    fields: [
      { name: "title", type: "text", required: true, presentable: true, max: 200 },
      { name: "product", type: "text", max: 100 },
      { name: "service", type: "text", max: 100 },
      { name: "severity", type: "select", required: true, maxSelect: 1, values: ["sev1", "sev2", "sev3", "sev4"] },
      { name: "status", type: "select", required: true, maxSelect: 1, values: ["detected", "investigating", "mitigating", "resolved", "closed"] },
      { name: "detected_at", type: "date", required: true },
      { name: "resolved_at", type: "date" },
      { name: "cause", type: "editor" },
      { name: "actions_taken", type: "editor" },
      { name: "affected_customers", type: "relation", collectionId: customers.id, maxSelect: 999 },
      { name: "owner", type: "relation", collectionId: employees.id, maxSelect: 1 },
    ],
    indexes: [
      "CREATE INDEX idx_incidents_status ON incidents (status)",
      "CREATE INDEX idx_incidents_severity ON incidents (severity)",
    ],
    listRule: "@request.auth.employee.role.permissions.key ?= 'incidents.view' || @request.auth.employee.role.is_super_admin = true",
    viewRule: "@request.auth.employee.role.permissions.key ?= 'incidents.view' || @request.auth.employee.role.is_super_admin = true",
    createRule: "@request.auth.employee.role.permissions.key ?= 'incidents.manage' || @request.auth.employee.role.is_super_admin = true",
    updateRule: "@request.auth.employee.role.permissions.key ?= 'incidents.manage' || @request.auth.employee.role.is_super_admin = true",
    deleteRule: "@request.auth.employee.role.is_super_admin = true",
  });
  app.save(incidents);

  const deployments = new Collection({
    type: "base",
    name: "deployments",
    fields: [
      { name: "repository", type: "text", required: true, max: 150 },
      { name: "branch", type: "text", max: 100 },
      { name: "commit_sha", type: "text", max: 40 },
      { name: "commit_message", type: "text", max: 300 },
      { name: "status", type: "select", required: true, maxSelect: 1, values: ["queued", "building", "succeeded", "failed"] },
      { name: "environment", type: "select", maxSelect: 1, values: ["production"] },
      { name: "triggered_by", type: "relation", collectionId: employees.id, maxSelect: 1 },
      { name: "started_at", type: "date" },
      { name: "finished_at", type: "date" },
      { name: "coolify_deployment_url", type: "url" },
    ],
    indexes: ["CREATE INDEX idx_deployments_status ON deployments (status)"],
    listRule: "@request.auth.employee.role.permissions.key ?= 'deployments.view' || @request.auth.employee.role.is_super_admin = true",
    viewRule: "@request.auth.employee.role.permissions.key ?= 'deployments.view' || @request.auth.employee.role.is_super_admin = true",
    createRule: null, // populated via GitHub/Coolify webhook handler
    updateRule: null,
    deleteRule: null,
  });
  app.save(deployments);
}, (app) => {
  app.delete(app.findCollectionByNameOrId("deployments"));
  app.delete(app.findCollectionByNameOrId("incidents"));
  app.delete(app.findCollectionByNameOrId("health_checks"));
  app.delete(app.findCollectionByNameOrId("servers"));
});
