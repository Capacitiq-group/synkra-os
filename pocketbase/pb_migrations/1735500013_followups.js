/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  const employees = app.findCollectionByNameOrId("employees");
  const leads = app.findCollectionByNameOrId("leads");
  const customers = app.findCollectionByNameOrId("customers");

  const followUps = new Collection({
    type: "base",
    name: "follow_ups",
    fields: [
      // A follow-up attaches to a lead OR a customer (not necessarily
      // both) — exactly one should usually be set, enforced in the UI
      // rather than the schema to keep this collection simple.
      { name: "lead", type: "relation", collectionId: leads.id, maxSelect: 1 },
      { name: "customer", type: "relation", collectionId: customers.id, maxSelect: 1 },
      { name: "assigned_employee", type: "relation", collectionId: employees.id, maxSelect: 1 },
      { name: "due_at", type: "date", required: true },
      { name: "follow_up_type", type: "select", required: true, maxSelect: 1, values: ["email", "call", "meeting", "whatsapp", "internal_task", "other"] },
      { name: "status", type: "select", required: true, maxSelect: 1, values: ["pending", "completed", "cancelled"] },
      { name: "priority", type: "select", maxSelect: 1, values: ["low", "medium", "high"] },
      { name: "notes", type: "text", max: 500 },
      { name: "outcome", type: "text", max: 500 },
      { name: "completed_at", type: "date" },
    ],
    indexes: [
      "CREATE INDEX idx_followups_due ON follow_ups (due_at)",
      "CREATE INDEX idx_followups_status ON follow_ups (status)",
      "CREATE INDEX idx_followups_assigned ON follow_ups (assigned_employee)",
    ],
    // Visible to anyone with leads.view OR followups.view (a follow-up on
    // a customer record, not a lead, still needs to be visible to support/
    // sales staff who don't necessarily hold leads.view).
    listRule: "@request.auth.employee.role.is_super_admin = true || @request.auth.employee.role.permissions.key ?= 'followups.view' || @request.auth.employee.role.permissions.key ?= 'leads.view'",
    viewRule: "@request.auth.employee.role.is_super_admin = true || @request.auth.employee.role.permissions.key ?= 'followups.view' || @request.auth.employee.role.permissions.key ?= 'leads.view'",
    createRule: "@request.auth.employee.role.is_super_admin = true || @request.auth.employee.role.permissions.key ?= 'followups.manage' || @request.auth.employee.role.permissions.key ?= 'leads.manage'",
    updateRule: "@request.auth.employee.role.is_super_admin = true || @request.auth.employee.role.permissions.key ?= 'followups.manage' || @request.auth.employee.role.permissions.key ?= 'leads.manage'",
    deleteRule: "@request.auth.employee.role.is_super_admin = true",
  });
  app.save(followUps);
}, (app) => {
  app.delete(app.findCollectionByNameOrId("follow_ups"));
});
