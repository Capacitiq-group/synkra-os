/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  const employees = app.findCollectionByNameOrId("employees");
  const customers = app.findCollectionByNameOrId("customers");

  const partners = new Collection({
    type: "base",
    name: "partners",
    fields: [
      { name: "company_name", type: "text", required: true, presentable: true, max: 200 },
      { name: "contact_name", type: "text", max: 150 },
      { name: "contact_email", type: "email" },
      { name: "type", type: "select", maxSelect: 1, values: ["referral", "technology", "local"] },
      { name: "status", type: "select", required: true, maxSelect: 1, values: ["active", "inactive"] },
      { name: "commission_structure", type: "text", max: 300 },
      { name: "agreement_url", type: "url" },
      { name: "notes", type: "editor" },
    ],
    indexes: ["CREATE INDEX idx_partners_status ON partners (status)"],
    listRule: "@request.auth.employee.role.permissions.key ?= 'partners.view' || @request.auth.employee.role.is_super_admin = true",
    viewRule: "@request.auth.employee.role.permissions.key ?= 'partners.view' || @request.auth.employee.role.is_super_admin = true",
    createRule: "@request.auth.employee.role.permissions.key ?= 'partners.manage' || @request.auth.employee.role.is_super_admin = true",
    updateRule: "@request.auth.employee.role.permissions.key ?= 'partners.manage' || @request.auth.employee.role.is_super_admin = true",
    deleteRule: "@request.auth.employee.role.is_super_admin = true",
  });
  app.save(partners);

  const referrals = new Collection({
    type: "base",
    name: "referrals",
    fields: [
      { name: "partner", type: "relation", required: true, collectionId: partners.id, maxSelect: 1 },
      { name: "referred_customer", type: "relation", collectionId: customers.id, maxSelect: 1 },
      { name: "status", type: "select", required: true, maxSelect: 1, values: ["lead", "converted", "lost"] },
      { name: "commission_earned_cents", type: "number" },
      { name: "commission_paid_cents", type: "number" },
      { name: "referred_at", type: "date", required: true },
    ],
    indexes: ["CREATE INDEX idx_referrals_partner ON referrals (partner)"],
    listRule: "@request.auth.employee.role.permissions.key ?= 'partners.view' || @request.auth.employee.role.is_super_admin = true",
    viewRule: "@request.auth.employee.role.permissions.key ?= 'partners.view' || @request.auth.employee.role.is_super_admin = true",
    createRule: "@request.auth.employee.role.permissions.key ?= 'partners.manage' || @request.auth.employee.role.is_super_admin = true",
    updateRule: "@request.auth.employee.role.permissions.key ?= 'partners.manage' || @request.auth.employee.role.is_super_admin = true",
    deleteRule: "@request.auth.employee.role.is_super_admin = true",
  });
  app.save(referrals);

  const notifications = new Collection({
    type: "base",
    name: "notifications",
    fields: [
      { name: "recipient_employee", type: "relation", required: true, collectionId: employees.id, maxSelect: 1 },
      { name: "title", type: "text", required: true, max: 150 },
      { name: "body", type: "text", max: 500 },
      { name: "severity", type: "select", maxSelect: 1, values: ["info", "warning", "critical"] },
      { name: "link", type: "text", max: 200 }, // in-app route, e.g. "/incidents/abc123"
      { name: "read", type: "bool" },
      { name: "created_at", type: "date", required: true },
    ],
    indexes: ["CREATE INDEX idx_notifications_recipient ON notifications (recipient_employee)"],
    listRule: "@request.auth.employee = recipient_employee || @request.auth.employee.role.is_super_admin = true",
    viewRule: "@request.auth.employee = recipient_employee || @request.auth.employee.role.is_super_admin = true",
    createRule: null, // system-generated only
    updateRule: "@request.auth.employee = recipient_employee", // marking read/unread
    deleteRule: "@request.auth.employee = recipient_employee",
  });
  app.save(notifications);
}, (app) => {
  app.delete(app.findCollectionByNameOrId("notifications"));
  app.delete(app.findCollectionByNameOrId("referrals"));
  app.delete(app.findCollectionByNameOrId("partners"));
});
