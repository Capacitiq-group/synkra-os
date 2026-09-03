/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  // ---- organisations (a customer's company, when applicable) ---------
  const organisations = new Collection({
    type: "base",
    name: "organisations",
    fields: [
      { name: "name", type: "text", required: true, presentable: true, max: 200 },
      { name: "country", type: "text", max: 100 },
      { name: "website", type: "url" },
      { name: "notes", type: "editor" },
    ],
    indexes: ["CREATE INDEX idx_orgs_name ON organisations (name)"],
    // Organisations are effectively part of a customer record — gate them
    // on the same customers.* permissions rather than a separate key.
    listRule: "@request.auth.employee.role.is_super_admin = true || @request.auth.employee.role.permissions.key ?= 'customers.view'",
    viewRule: "@request.auth.employee.role.is_super_admin = true || @request.auth.employee.role.permissions.key ?= 'customers.view'",
    createRule: "@request.auth.employee.role.is_super_admin = true || @request.auth.employee.role.permissions.key ?= 'customers.edit'",
    updateRule: "@request.auth.employee.role.is_super_admin = true || @request.auth.employee.role.permissions.key ?= 'customers.edit'",
    deleteRule: "@request.auth.employee.role.is_super_admin = true",
  });
  app.save(organisations);

  // ---- customers -------------------------------------------------------
  // customer_id is a short human-friendly identifier (e.g. CUS-000482)
  // distinct from PocketBase's internal record id, used in search and
  // referenced by support/agency/billing records.
  const customers = new Collection({
    type: "base",
    name: "customers",
    fields: [
      { name: "customer_code", type: "text", required: true, presentable: true, max: 20 },
      { name: "name", type: "text", required: true, max: 150 },
      { name: "email", type: "email", required: true },
      { name: "phone", type: "text", max: 40 },
      { name: "country", type: "text", max: 100 },
      {
        name: "organisation",
        type: "relation",
        collectionId: organisations.id,
        maxSelect: 1,
      },
      {
        name: "customer_type",
        type: "select",
        required: true,
        maxSelect: 1,
        values: ["saas", "agency", "utility_lead", "partner_referred"],
      },
      {
        name: "account_status",
        type: "select",
        required: true,
        maxSelect: 1,
        values: ["active", "suspended", "churned", "pending_verification"],
      },
      {
        name: "assigned_staff",
        type: "relation",
        collectionId: app.findCollectionByNameOrId("employees").id,
        maxSelect: 1,
      },
      { name: "signup_date", type: "date" },
      { name: "notes", type: "editor" },
      // links to systems of record this platform does not own
      { name: "flow_account_id", type: "text", max: 100 },
      { name: "chat_account_id", type: "text", max: 100 },
      { name: "zoho_contact_id", type: "text", max: 100 },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_customers_code ON customers (customer_code)",
      "CREATE INDEX idx_customers_email ON customers (email)",
      "CREATE INDEX idx_customers_phone ON customers (phone)",
      "CREATE INDEX idx_customers_status ON customers (account_status)",
    ],
    listRule: "@request.auth.employee.role.is_super_admin = true || @request.auth.employee.role.permissions.key ?= 'customers.view'",
    viewRule: "@request.auth.employee.role.is_super_admin = true || @request.auth.employee.role.permissions.key ?= 'customers.view'",
    createRule: "@request.auth.employee.role.is_super_admin = true || @request.auth.employee.role.permissions.key ?= 'customers.edit'",
    updateRule: "@request.auth.employee.role.is_super_admin = true || @request.auth.employee.role.permissions.key ?= 'customers.edit'",
    deleteRule: "@request.auth.employee.role.is_super_admin = true",
  });
  app.save(customers);

  // ---- products ----------------------------------------------------------
  const products = new Collection({
    type: "base",
    name: "products",
    fields: [
      { name: "name", type: "text", required: true, presentable: true, max: 100 },
      {
        name: "product_key",
        type: "select",
        required: true,
        maxSelect: 1,
        values: ["flow", "chat", "business_tools", "agency", "ai_voice_agent"],
      },
      { name: "description", type: "text", max: 300 },
      {
        name: "status",
        type: "select",
        required: true,
        maxSelect: 1,
        values: ["active", "beta", "deprecated"],
      },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_products_key ON products (product_key)"],
    listRule: "@request.auth.id != ''",
    viewRule: "@request.auth.id != ''",
    createRule: "@request.auth.employee.role.is_super_admin = true",
    updateRule: "@request.auth.employee.role.is_super_admin = true",
    deleteRule: "@request.auth.employee.role.is_super_admin = true",
  });
  app.save(products);

  // ---- subscriptions -------------------------------------------------
  const subscriptions = new Collection({
    type: "base",
    name: "subscriptions",
    fields: [
      { name: "subscription_code", type: "text", required: true, presentable: true, max: 20 },
      {
        name: "customer",
        type: "relation",
        required: true,
        collectionId: customers.id,
        maxSelect: 1,
      },
      {
        name: "product",
        type: "relation",
        required: true,
        collectionId: products.id,
        maxSelect: 1,
      },
      { name: "plan_name", type: "text", max: 100 },
      {
        name: "status",
        type: "select",
        required: true,
        maxSelect: 1,
        values: ["trialing", "active", "past_due", "cancelled", "paused"],
      },
      { name: "mrr_cents", type: "number", required: true },
      { name: "currency", type: "text", max: 5 },
      { name: "current_period_end", type: "date" },
      { name: "cancelled_at", type: "date" },
      { name: "payment_provider_id", type: "text", max: 150 }, // e.g. Paystack subscription id
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_subs_code ON subscriptions (subscription_code)",
      "CREATE INDEX idx_subs_customer ON subscriptions (customer)",
      "CREATE INDEX idx_subs_status ON subscriptions (status)",
    ],
    // Readable by either customers.view (surfaced in Customer 360) or
    // billing.view (surfaced in the standalone Billing module) — either
    // permission is sufficient, matching how the two screens use this data.
    listRule: "@request.auth.employee.role.is_super_admin = true || @request.auth.employee.role.permissions.key ?= 'customers.view' || @request.auth.employee.role.permissions.key ?= 'billing.view'",
    viewRule: "@request.auth.employee.role.is_super_admin = true || @request.auth.employee.role.permissions.key ?= 'customers.view' || @request.auth.employee.role.permissions.key ?= 'billing.view'",
    createRule: "@request.auth.employee.role.is_super_admin = true || @request.auth.employee.role.permissions.key ?= 'billing.modify'",
    updateRule: "@request.auth.employee.role.is_super_admin = true || @request.auth.employee.role.permissions.key ?= 'billing.modify'",
    deleteRule: "@request.auth.employee.role.is_super_admin = true",
  });
  app.save(subscriptions);
}, (app) => {
  app.delete(app.findCollectionByNameOrId("subscriptions"));
  app.delete(app.findCollectionByNameOrId("products"));
  app.delete(app.findCollectionByNameOrId("customers"));
  app.delete(app.findCollectionByNameOrId("organisations"));
});
