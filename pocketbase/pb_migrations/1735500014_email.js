/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  const employees = app.findCollectionByNameOrId("employees");
  const customers = app.findCollectionByNameOrId("customers");
  const products = app.findCollectionByNameOrId("products");

  const emailTemplates = new Collection({
    type: "base",
    name: "email_templates",
    fields: [
      { name: "name", type: "text", required: true, presentable: true, max: 150 },
      {
        name: "purpose",
        type: "select",
        maxSelect: 1,
        values: [
          "lead_follow_up", "quotation", "payment_confirmation",
          "onboarding_confirmation", "action_required", "deployment_completed",
          "payment_failure", "support_communication", "other",
        ],
      },
      { name: "subject", type: "text", required: true, max: 250 },
      { name: "body", type: "editor", required: true },
      // Named placeholders the body references, e.g. ["customer_name", "invoice_number"].
      { name: "variables", type: "json" },
      { name: "status", type: "select", required: true, maxSelect: 1, values: ["draft", "active", "archived"] },
      { name: "created_by", type: "relation", collectionId: employees.id, maxSelect: 1 },
      { name: "updated_by", type: "relation", collectionId: employees.id, maxSelect: 1 },
      { name: "version", type: "number" },
    ],
    indexes: ["CREATE INDEX idx_templates_purpose ON email_templates (purpose)"],
    listRule: "@request.auth.employee.role.is_super_admin = true || @request.auth.employee.role.permissions.key ?= 'email.view'",
    viewRule: "@request.auth.employee.role.is_super_admin = true || @request.auth.employee.role.permissions.key ?= 'email.view'",
    createRule: "@request.auth.employee.role.is_super_admin = true || @request.auth.employee.role.permissions.key ?= 'email.manage'",
    updateRule: "@request.auth.employee.role.is_super_admin = true || @request.auth.employee.role.permissions.key ?= 'email.manage'",
    deleteRule: "@request.auth.employee.role.is_super_admin = true",
  });
  app.save(emailTemplates);

  // Mirror of Resend activity, not a second mail system. Populated by
  // pb_hooks/email_adapter.pb.js (outgoing sends we trigger) and by the
  // Resend webhook handler (delivery/bounce/complaint status updates).
  // resend_email_id is the external identifier — never invented locally.
  const emailEvents = new Collection({
    type: "base",
    name: "email_events",
    fields: [
      { name: "resend_email_id", type: "text", max: 150 },
      { name: "direction", type: "select", required: true, maxSelect: 1, values: ["outgoing", "incoming"] },
      { name: "recipient", type: "email", required: true },
      { name: "sender", type: "email" },
      { name: "subject", type: "text", max: 250 },
      {
        name: "status",
        type: "select",
        required: true,
        maxSelect: 1,
        values: ["queued", "sent", "delivered", "bounced", "complained", "failed"],
      },
      { name: "failure_reason", type: "text", max: 500 },
      { name: "template", type: "relation", collectionId: emailTemplates.id, maxSelect: 1 },
      { name: "related_customer", type: "relation", collectionId: customers.id, maxSelect: 1 },
      { name: "related_product", type: "relation", collectionId: products.id, maxSelect: 1 },
      { name: "related_transaction_ref", type: "text", max: 150 }, // e.g. an invoice number
      { name: "sent_at", type: "date" },
      { name: "delivered_at", type: "date" },
    ],
    indexes: [
      "CREATE INDEX idx_email_events_recipient ON email_events (recipient)",
      "CREATE INDEX idx_email_events_status ON email_events (status)",
      "CREATE INDEX idx_email_events_customer ON email_events (related_customer)",
      "CREATE UNIQUE INDEX idx_email_events_resend_id ON email_events (resend_email_id)",
    ],
    listRule: "@request.auth.employee.role.is_super_admin = true || @request.auth.employee.role.permissions.key ?= 'email.view' || @request.auth.employee.role.permissions.key ?= 'customers.view'",
    viewRule: "@request.auth.employee.role.is_super_admin = true || @request.auth.employee.role.permissions.key ?= 'email.view' || @request.auth.employee.role.permissions.key ?= 'customers.view'",
    createRule: null, // written only by pb_hooks/email_adapter.pb.js (send route + Resend webhook)
    updateRule: null,
    deleteRule: "@request.auth.employee.role.is_super_admin = true",
  });
  app.save(emailEvents);
}, (app) => {
  app.delete(app.findCollectionByNameOrId("email_events"));
  app.delete(app.findCollectionByNameOrId("email_templates"));
});
