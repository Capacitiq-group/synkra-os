/// <reference path="../pb_data/types.d.ts" />

// Billing here is deliberately a *mirror*, not a ledger: Synkra OS displays
// invoice/payment state pulled from the real systems of record (Paystack,
// Zoho Books) via the sync worker in pocketbase/pb_hooks/billing_sync.pb.js.
// It never originates financial truth.
migrate((app) => {
  const customers = app.findCollectionByNameOrId("customers");
  const subscriptions = app.findCollectionByNameOrId("subscriptions");

  const invoices = new Collection({
    type: "base",
    name: "invoices",
    fields: [
      { name: "invoice_number", type: "text", required: true, presentable: true, max: 40 },
      { name: "customer", type: "relation", required: true, collectionId: customers.id, maxSelect: 1 },
      { name: "subscription", type: "relation", collectionId: subscriptions.id, maxSelect: 1 },
      { name: "amount_cents", type: "number", required: true },
      { name: "currency", type: "text", max: 5 },
      {
        name: "status",
        type: "select",
        required: true,
        maxSelect: 1,
        values: ["draft", "open", "paid", "failed", "refunded", "void"],
      },
      { name: "issued_at", type: "date" },
      { name: "due_at", type: "date" },
      { name: "zoho_invoice_id", type: "text", max: 100 },
      { name: "source_url", type: "url" }, // deep link back to Zoho Books / Paystack
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_invoices_number ON invoices (invoice_number)",
      "CREATE INDEX idx_invoices_customer ON invoices (customer)",
      "CREATE INDEX idx_invoices_status ON invoices (status)",
    ],
    listRule: "@request.auth.employee.role.is_super_admin = true || @request.auth.employee.role.permissions.key ?= 'customers.view' || @request.auth.employee.role.permissions.key ?= 'billing.view'",
    viewRule: "@request.auth.employee.role.is_super_admin = true || @request.auth.employee.role.permissions.key ?= 'customers.view' || @request.auth.employee.role.permissions.key ?= 'billing.view'",
    createRule: null, // written only by the billing sync hook (superuser context)
    updateRule: null,
    deleteRule: "@request.auth.employee.role.is_super_admin = true",
  });
  app.save(invoices);

  const payments = new Collection({
    type: "base",
    name: "payments",
    fields: [
      { name: "customer", type: "relation", required: true, collectionId: customers.id, maxSelect: 1 },
      { name: "invoice", type: "relation", collectionId: invoices.id, maxSelect: 1 },
      { name: "amount_cents", type: "number", required: true },
      { name: "currency", type: "text", max: 5 },
      {
        name: "status",
        type: "select",
        required: true,
        maxSelect: 1,
        values: ["succeeded", "failed", "pending", "refunded"],
      },
      { name: "provider", type: "select", maxSelect: 1, values: ["paystack", "manual"] },
      { name: "provider_reference", type: "text", max: 150 },
      { name: "paid_at", type: "date" },
      // refunds are a dangerous action: they must always carry who/why
      { name: "refund_reason", type: "text", max: 300 },
      { name: "refunded_by", type: "relation", collectionId: app.findCollectionByNameOrId("employees").id, maxSelect: 1 },
    ],
    indexes: [
      "CREATE INDEX idx_payments_customer ON payments (customer)",
      "CREATE INDEX idx_payments_status ON payments (status)",
      "CREATE UNIQUE INDEX idx_payments_provider_ref ON payments (provider_reference)",
    ],
    listRule: "@request.auth.employee.role.is_super_admin = true || @request.auth.employee.role.permissions.key ?= 'customers.view' || @request.auth.employee.role.permissions.key ?= 'billing.view'",
    viewRule: "@request.auth.employee.role.is_super_admin = true || @request.auth.employee.role.permissions.key ?= 'customers.view' || @request.auth.employee.role.permissions.key ?= 'billing.view'",
    createRule: null,
    updateRule: null, // refunds go through /api/payments/:id/refund, not direct field edits
    deleteRule: null,
  });
  app.save(payments);
}, (app) => {
  app.delete(app.findCollectionByNameOrId("payments"));
  app.delete(app.findCollectionByNameOrId("invoices"));
});
