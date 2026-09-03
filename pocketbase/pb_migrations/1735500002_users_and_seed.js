/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  // Link the built-in `users` auth collection to an employee record.
  // Login is only ever done via `users`; `employees` carries the role/status.
  const users = app.findCollectionByNameOrId("users");
  const employees = app.findCollectionByNameOrId("employees");

  users.fields.add(new Field({
    name: "employee",
    type: "relation",
    required: false,
    collectionId: employees.id,
    maxSelect: 1,
  }));
  // Never allow public signup — employee accounts are provisioned by a
  // super admin only. Login stays open (rule below); create is locked down.
  users.createRule = "@request.auth.employee.role.is_super_admin = true";
  users.listRule = "@request.auth.id != ''";
  users.viewRule = "id = @request.auth.id || @request.auth.employee.role.is_super_admin = true";
  app.save(users);

  // ---- seed: canonical permission keys (from the Synkra OS spec) ------
  const permissionDefs = [
    ["customers.view", "View customers", "customers"],
    ["customers.edit", "Edit customers", "customers"],
    ["customers.impersonate", "View as customer", "customers"],
    ["billing.view", "View billing", "billing"],
    ["billing.modify", "Modify billing", "billing"],
    ["billing.refund", "Issue refunds", "billing"],
    ["support.view", "View support tickets", "support"],
    ["support.manage", "Manage support tickets", "support"],
    ["agency.view", "View agency pipeline", "agency"],
    ["agency.manage", "Manage agency pipeline", "agency"],
    ["infrastructure.view", "View infrastructure", "infrastructure"],
    ["infrastructure.restart", "Restart services", "infrastructure"],
    ["deployments.view", "View deployments", "deployments"],
    ["deployments.execute", "Trigger deployments", "deployments"],
    ["incidents.view", "View incidents", "incidents"],
    ["incidents.manage", "Manage incidents", "incidents"],
    ["ai.view", "View AI employees", "ai"],
    ["ai.configure", "Configure AI employees", "ai"],
    ["utilities.view", "View utility analytics", "utilities"],
    ["partners.view", "View partners", "partners"],
    ["partners.manage", "Manage partners", "partners"],
    ["employees.view", "View employees", "employees"],
    ["employees.manage", "Manage employees", "employees"],
    ["permissions.manage", "Manage roles & permissions", "permissions"],
    ["audit.view", "View audit logs", "audit"],
    ["leads.view", "View leads", "leads"],
    ["leads.manage", "Manage leads & pipeline", "leads"],
    ["followups.view", "View follow-ups", "followups"],
    ["followups.manage", "Manage follow-ups", "followups"],
    ["email.view", "View email activity & templates", "email"],
    ["email.manage", "Manage email templates & sends", "email"],
    ["flow.view", "View Flow users & subscriptions", "flow"],
    ["chat.view", "View Chat conversations", "chat"],
    ["ai.approve", "Approve/reject AI jobs requiring human review", "ai"],
    ["integrations.view", "View integration connection status", "integrations"],
    ["acquisition.view", "View the direct acquisition engine (prospects, campaigns, CRM)", "acquisition"],
    ["acquisition.manage", "Manage acquisition targets, suppression list, and prospect data", "acquisition"],
  ];

  const permCollection = app.findCollectionByNameOrId("permissions");
  const permRecords = permissionDefs.map(([key, label, category]) => {
    const r = new Record(permCollection);
    r.set("key", key);
    r.set("label", label);
    r.set("category", category);
    app.save(r);
    return r;
  });

  // ---- seed: Super Administrator role ----------------------------------
  const roleCollection = app.findCollectionByNameOrId("roles");
  const superAdminRole = new Record(roleCollection);
  superAdminRole.set("name", "Super Administrator");
  superAdminRole.set("description", "Full unrestricted access. Bypasses per-permission checks.");
  superAdminRole.set("is_super_admin", true);
  superAdminRole.set("permissions", permRecords.map((r) => r.id));
  app.save(superAdminRole);
}, (app) => {
  const users = app.findCollectionByNameOrId("users");
  const field = users.fields.getByName("employee");
  if (field) users.fields.removeById(field.id);
  app.save(users);
  // seeded permission/role records are removed automatically when the
  // collections are dropped in the previous migration's down-step.
});
