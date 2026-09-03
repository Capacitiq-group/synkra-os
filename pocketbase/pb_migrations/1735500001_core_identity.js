/// <reference path="../pb_data/types.d.ts" />

// Core identity & permission model.
//
// Design notes:
// - `users` is PocketBase's built-in auth collection; we extend it with an
//   `employee` relation so every operator logging into Synkra OS is tied to
//   an internal employee record (never a raw customer account).
// - Permissions are flat string keys (e.g. "billing.refund") assigned to
//   Roles. Roles are assigned to Employees. Authorization is *always*
//   checked server-side in pb_hooks (see 0100_authz.pb.js) — the frontend
//   only uses this data to decide what to render, never to decide what is
//   allowed.
migrate((app) => {
  // ---- permissions -------------------------------------------------
  const permissions = new Collection({
    type: "base",
    name: "permissions",
    fields: [
      { name: "key", type: "text", required: true, presentable: true, max: 100 },
      { name: "label", type: "text", required: true, max: 150 },
      { name: "category", type: "text", required: true, max: 50 },
      { name: "description", type: "text", max: 300 },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_permissions_key ON permissions (key)"],
    listRule: "@request.auth.id != ''",
    viewRule: "@request.auth.id != ''",
    createRule: null, // seeded only, never created via API
    updateRule: null,
    deleteRule: null,
  });
  app.save(permissions);

  // ---- roles ---------------------------------------------------------
  const roles = new Collection({
    type: "base",
    name: "roles",
    fields: [
      { name: "name", type: "text", required: true, presentable: true, max: 100 },
      { name: "description", type: "text", max: 300 },
      {
        name: "permissions",
        type: "relation",
        required: false,
        collectionId: permissions.id,
        maxSelect: 999,
      },
      { name: "is_super_admin", type: "bool" }, // bypasses individual permission checks
    ],
    indexes: ["CREATE UNIQUE INDEX idx_roles_name ON roles (name)"],
    listRule: "@request.auth.id != ''",
    viewRule: "@request.auth.id != ''",
    createRule: "@request.auth.employee.role.is_super_admin = true || @request.auth.employee.role.permissions.key ?= 'permissions.manage'",
    updateRule: "@request.auth.employee.role.is_super_admin = true || @request.auth.employee.role.permissions.key ?= 'permissions.manage'",
    deleteRule: "@request.auth.employee.role.is_super_admin = true",
  });
  app.save(roles);

  // ---- employees -------------------------------------------------------
  const employees = new Collection({
    type: "base",
    name: "employees",
    fields: [
      { name: "full_name", type: "text", required: true, presentable: true, max: 150 },
      { name: "email", type: "email", required: true },
      {
        name: "role",
        type: "relation",
        required: true,
        collectionId: roles.id,
        maxSelect: 1,
      },
      { name: "department", type: "text", max: 100 },
      { name: "title", type: "text", max: 100 },
      {
        name: "status",
        type: "select",
        required: true,
        maxSelect: 1,
        values: ["active", "suspended", "offboarded"],
      },
      {
        name: "user",
        type: "relation",
        required: false,
        collectionId: app.findCollectionByNameOrId("users").id, // linked once the login account is created
        maxSelect: 1,
      },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_employees_email ON employees (email)",
      "CREATE INDEX idx_employees_status ON employees (status)",
    ],
    // Any authenticated employee can list/view basic employee directory
    // info (needed for assignee dropdowns, "assigned staff" display, etc.)
    // gated to employees.view for anyone without it, self always allowed.
    // Mutations require employees.manage (super admin always bypasses).
    listRule: "@request.auth.employee.role.is_super_admin = true || @request.auth.employee.role.permissions.key ?= 'employees.view'",
    viewRule: "@request.auth.employee.role.is_super_admin = true || @request.auth.employee.role.permissions.key ?= 'employees.view' || id = @request.auth.employee",
    createRule: "@request.auth.employee.role.is_super_admin = true || @request.auth.employee.role.permissions.key ?= 'employees.manage'",
    updateRule: "@request.auth.employee.role.is_super_admin = true || @request.auth.employee.role.permissions.key ?= 'employees.manage'",
    deleteRule: "@request.auth.employee.role.is_super_admin = true",
  });
  app.save(employees);
}, (app) => {
  app.delete(app.findCollectionByNameOrId("employees"));
  app.delete(app.findCollectionByNameOrId("roles"));
  app.delete(app.findCollectionByNameOrId("permissions"));
});
