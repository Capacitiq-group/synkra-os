/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  const customers = app.findCollectionByNameOrId("customers");
  const products = app.findCollectionByNameOrId("products");
  const employees = app.findCollectionByNameOrId("employees");

  const tickets = new Collection({
    type: "base",
    name: "support_tickets",
    fields: [
      { name: "ticket_number", type: "text", required: true, presentable: true, max: 20 },
      { name: "customer", type: "relation", required: true, collectionId: customers.id, maxSelect: 1 },
      { name: "product", type: "relation", collectionId: products.id, maxSelect: 1 },
      { name: "subject", type: "text", required: true, max: 200 },
      { name: "category", type: "select", maxSelect: 1, values: ["billing", "technical", "account", "feature_request", "other"] },
      { name: "priority", type: "select", required: true, maxSelect: 1, values: ["low", "medium", "high", "urgent"] },
      {
        name: "status",
        type: "select",
        required: true,
        maxSelect: 1,
        values: ["open", "ai_investigating", "waiting_on_customer", "human_review", "in_progress", "resolved", "closed"],
      },
      { name: "assignee", type: "relation", collectionId: employees.id, maxSelect: 1 },
      { name: "ai_involved", type: "bool" },
      { name: "resolution", type: "editor" },
      { name: "opened_at", type: "date", required: true },
      { name: "resolved_at", type: "date" },
      { name: "closed_at", type: "date" },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_tickets_number ON support_tickets (ticket_number)",
      "CREATE INDEX idx_tickets_customer ON support_tickets (customer)",
      "CREATE INDEX idx_tickets_status ON support_tickets (status)",
      "CREATE INDEX idx_tickets_priority ON support_tickets (priority)",
    ],
    // Readable by support.view (Support module) or customers.view
    // (surfaced as ticket history inside Customer 360) — either suffices.
    listRule: "@request.auth.employee.role.is_super_admin = true || @request.auth.employee.role.permissions.key ?= 'support.view' || @request.auth.employee.role.permissions.key ?= 'customers.view'",
    viewRule: "@request.auth.employee.role.is_super_admin = true || @request.auth.employee.role.permissions.key ?= 'support.view' || @request.auth.employee.role.permissions.key ?= 'customers.view'",
    createRule: "@request.auth.employee.role.is_super_admin = true || @request.auth.employee.role.permissions.key ?= 'support.view'",
    updateRule: "@request.auth.employee.role.is_super_admin = true || @request.auth.employee.role.permissions.key ?= 'support.manage'",
    deleteRule: "@request.auth.employee.role.is_super_admin = true",
  });
  app.save(tickets);

  const conversations = new Collection({
    type: "base",
    name: "conversations",
    fields: [
      { name: "ticket", type: "relation", collectionId: tickets.id, maxSelect: 1 },
      { name: "customer", type: "relation", required: true, collectionId: customers.id, maxSelect: 1 },
      { name: "channel", type: "select", maxSelect: 1, values: ["email", "chat_widget", "whatsapp", "internal_note"] },
      { name: "author_employee", type: "relation", collectionId: employees.id, maxSelect: 1 },
      { name: "author_is_customer", type: "bool" },
      { name: "body", type: "editor", required: true },
      { name: "sent_at", type: "date", required: true },
    ],
    indexes: [
      "CREATE INDEX idx_conversations_ticket ON conversations (ticket)",
      "CREATE INDEX idx_conversations_customer ON conversations (customer)",
    ],
    listRule: "@request.auth.employee.role.is_super_admin = true || @request.auth.employee.role.permissions.key ?= 'support.view' || @request.auth.employee.role.permissions.key ?= 'customers.view'",
    viewRule: "@request.auth.employee.role.is_super_admin = true || @request.auth.employee.role.permissions.key ?= 'support.view' || @request.auth.employee.role.permissions.key ?= 'customers.view'",
    createRule: "@request.auth.employee.role.is_super_admin = true || @request.auth.employee.role.permissions.key ?= 'support.view'",
    updateRule: "@request.auth.employee.role.is_super_admin = true",
    deleteRule: "@request.auth.employee.role.is_super_admin = true",
  });
  app.save(conversations);
}, (app) => {
  app.delete(app.findCollectionByNameOrId("conversations"));
  app.delete(app.findCollectionByNameOrId("support_tickets"));
});
