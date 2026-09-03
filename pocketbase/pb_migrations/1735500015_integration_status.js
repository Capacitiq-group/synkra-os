/// <reference path="../pb_data/types.d.ts" />

// One row per external integration this platform depends on. Adapters
// (pb_hooks/*_adapter.pb.js) update their own row on every attempt — success
// or failure — so the UI always reflects the real, current connection
// state instead of assuming "no error shown" means "connected."
migrate((app) => {
  const integrationStatus = new Collection({
    type: "base",
    name: "integration_status",
    fields: [
      {
        name: "integration_key",
        type: "select",
        required: true,
        maxSelect: 1,
        values: ["flow", "chat", "resend", "paystack", "zoho_books", "coolify", "github", "python_ai_worker", "agency_platform"],
      },
      { name: "display_name", type: "text", required: true, max: 100 },
      {
        name: "status",
        type: "select",
        required: true,
        maxSelect: 1,
        values: ["connected", "not_configured", "authentication_failed", "unavailable", "error"],
      },
      { name: "last_checked_at", type: "date" },
      { name: "last_successful_at", type: "date" },
      { name: "last_error", type: "text", max: 500 },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_integration_status_key ON integration_status (integration_key)"],
    listRule: "@request.auth.employee.role.is_super_admin = true || @request.auth.employee.role.permissions.key ?= 'integrations.view'",
    viewRule: "@request.auth.employee.role.is_super_admin = true || @request.auth.employee.role.permissions.key ?= 'integrations.view'",
    createRule: null, // written only by adapters (superuser context)
    updateRule: null,
    deleteRule: "@request.auth.employee.role.is_super_admin = true",
  });
  app.save(integrationStatus);

  // Seed one row per known integration in "not_configured" state — never
  // "connected" — so the UI has something honest to show before any
  // adapter has run.
  const rows = [
    ["flow", "Synkra Flow"],
    ["chat", "Synkra Chat"],
    ["resend", "Resend (email)"],
    ["paystack", "Paystack (payments)"],
    ["zoho_books", "Zoho Books (invoicing)"],
    ["coolify", "Coolify (deployments)"],
    ["github", "GitHub (source/CI)"],
    ["python_ai_worker", "Python AI Worker"],
    ["agency_platform", "Agency Platform (dedicated PocketBase)"],
  ];
  for (const [key, name] of rows) {
    const r = new Record(integrationStatus);
    r.set("integration_key", key);
    r.set("display_name", name);
    r.set("status", "not_configured");
    app.save(r);
  }
}, (app) => {
  app.delete(app.findCollectionByNameOrId("integration_status"));
});
