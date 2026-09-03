/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  const employees = app.findCollectionByNameOrId("employees");
  const customers = app.findCollectionByNameOrId("customers");

  // ---- audit_logs -------------------------------------------------------
  // Append-only. Nothing — not even a super admin — may update or delete
  // an audit record through the API. Rows are written exclusively by
  // pb_hooks/audit.pb.js via app.save() in a superuser Go/JS context,
  // never by client requests, so createRule is `null` (API-blocked) too.
  const auditLogs = new Collection({
    type: "base",
    name: "audit_logs",
    fields: [
      { name: "actor_employee", type: "relation", required: true, collectionId: employees.id, maxSelect: 1 },
      { name: "action", type: "text", required: true, max: 100 }, // e.g. "customer.suspend", "billing.refund"
      { name: "affected_collection", type: "text", max: 50 },
      { name: "affected_record_id", type: "text", max: 30 },
      { name: "affected_customer", type: "relation", collectionId: customers.id, maxSelect: 1 },
      { name: "previous_value", type: "json" },
      { name: "new_value", type: "json" },
      { name: "reason", type: "text", max: 500 },
      { name: "ip_address", type: "text", max: 60 },
      { name: "occurred_at", type: "date", required: true },
    ],
    indexes: [
      "CREATE INDEX idx_audit_actor ON audit_logs (actor_employee)",
      "CREATE INDEX idx_audit_action ON audit_logs (action)",
      "CREATE INDEX idx_audit_customer ON audit_logs (affected_customer)",
      "CREATE INDEX idx_audit_occurred ON audit_logs (occurred_at)",
    ],
    // Full unscoped audit browsing (Audit Logs module) requires audit.view.
    // customers.view holders can additionally see entries scoped to a
    // specific customer (used by the Customer 360 Activity panel) without
    // being able to browse the full log.
    listRule: "@request.auth.employee.role.is_super_admin = true || @request.auth.employee.role.permissions.key ?= 'audit.view' || (@request.auth.employee.role.permissions.key ?= 'customers.view' && affected_customer != '')",
    viewRule: "@request.auth.employee.role.is_super_admin = true || @request.auth.employee.role.permissions.key ?= 'audit.view' || (@request.auth.employee.role.permissions.key ?= 'customers.view' && affected_customer != '')",
    createRule: null,
    updateRule: null,
    deleteRule: null,
  });
  app.save(auditLogs);

  // ---- impersonation_sessions ("View as Customer") ----------------------
  const impersonation = new Collection({
    type: "base",
    name: "impersonation_sessions",
    fields: [
      { name: "employee", type: "relation", required: true, collectionId: employees.id, maxSelect: 1 },
      { name: "customer", type: "relation", required: true, collectionId: customers.id, maxSelect: 1 },
      { name: "reason", type: "text", required: true, max: 300 },
      { name: "started_at", type: "date", required: true },
      { name: "expires_at", type: "date", required: true }, // hard cap, enforced server-side
      { name: "ended_at", type: "date" },
      {
        name: "status",
        type: "select",
        required: true,
        maxSelect: 1,
        values: ["active", "expired", "ended_manually"],
      },
    ],
    indexes: [
      "CREATE INDEX idx_impersonation_employee ON impersonation_sessions (employee)",
      "CREATE INDEX idx_impersonation_customer ON impersonation_sessions (customer)",
      "CREATE INDEX idx_impersonation_status ON impersonation_sessions (status)",
    ],
    // Sessions are only ever created via the /api/impersonation/start custom
    // route (which permission-checks + writes the audit log atomically) —
    // never via a raw collection create from the client.
    listRule: "@request.auth.employee.role.is_super_admin = true || @request.auth.employee = employee",
    viewRule: "@request.auth.employee.role.is_super_admin = true || @request.auth.employee = employee",
    createRule: null,
    updateRule: null,
    deleteRule: null,
  });
  app.save(impersonation);
}, (app) => {
  app.delete(app.findCollectionByNameOrId("impersonation_sessions"));
  app.delete(app.findCollectionByNameOrId("audit_logs"));
});
