/// <reference path="../pb_data/types.d.ts" />
// Prompt 10: Reconcile clients and credit_transactions (schema-only, pre-change row counts: 0).
// 1. Move `credit_balance` and `monthly_credit_allowance` from `testimonial_clients` to `clients`.
// 2. Re-point `credit_transactions.client_id` relation to `clients` (instead of `testimonial_clients`).
// 3. Reduce `testimonial_clients` to marketing-only fields (company_name, logo, testimonial, testimonial_published).
// 4. `admin_users` left intact per Prompt 10 instructions.

migrate((app) => {
  const clients = app.findCollectionByNameOrId("clients");
  const testimonialClients = app.findCollectionByNameOrId("testimonial_clients");
  const creditTransactions = app.findCollectionByNameOrId("credit_transactions");

  // 1. Move credit_balance and monthly_credit_allowance onto `clients`
  if (!clients.fields.getByName("credit_balance")) {
    clients.fields.add(new Field({
      name: "credit_balance",
      type: "number",
      required: false,
    }));
  }
  if (!clients.fields.getByName("monthly_credit_allowance")) {
    clients.fields.add(new Field({
      name: "monthly_credit_allowance",
      type: "number",
      required: false,
    }));
  }
  app.save(clients);

  // 2. Re-point credit_transactions.client_id relation to `clients`
  const oldClientIdField = creditTransactions.fields.getByName("client_id");
  if (oldClientIdField) {
    creditTransactions.fields.removeById(oldClientIdField.id);
  }
  creditTransactions.fields.add(new Field({
    name: "client_id",
    type: "relation",
    required: true,
    collectionId: clients.id,
    maxSelect: 1,
    cascadeDelete: true,
  }));
  app.save(creditTransactions);

  // 3. Reduce testimonial_clients to marketing-only fields:
  // Keep: company_name, logo, testimonial, testimonial_published
  // Remove non-marketing operational fields:
  const fieldsToRemove = [
    "contact_name",
    "email",
    "phone",
    "service_slug",
    "plan_tier",
    "status",
    "credit_balance",
    "monthly_credit_allowance",
    "onboarding_date",
    "notes",
  ];

  for (const fieldName of fieldsToRemove) {
    const field = testimonialClients.fields.getByName(fieldName);
    if (field) {
      testimonialClients.fields.removeById(field.id);
    }
  }
  app.save(testimonialClients);
}, (app) => {
  const clients = app.findCollectionByNameOrId("clients");
  const testimonialClients = app.findCollectionByNameOrId("testimonial_clients");
  const creditTransactions = app.findCollectionByNameOrId("credit_transactions");

  // Re-add fields to testimonial_clients
  const fCb = testimonialClients.fields.getByName("credit_balance");
  if (!fCb) {
    testimonialClients.fields.add(new Field({ name: "credit_balance", type: "number" }));
    testimonialClients.fields.add(new Field({ name: "monthly_credit_allowance", type: "number" }));
    app.save(testimonialClients);
  }

  // Re-point credit_transactions to testimonial_clients
  const clientIdField = creditTransactions.fields.getByName("client_id");
  if (clientIdField) {
    creditTransactions.fields.removeById(clientIdField.id);
  }
  creditTransactions.fields.add(new Field({
    name: "client_id",
    type: "relation",
    required: true,
    collectionId: testimonialClients.id,
    maxSelect: 1,
    cascadeDelete: true,
  }));
  app.save(creditTransactions);

  // Remove from clients
  const f1 = clients.fields.getByName("credit_balance");
  if (f1) clients.fields.removeById(f1.id);
  const f2 = clients.fields.getByName("monthly_credit_allowance");
  if (f2) clients.fields.removeById(f2.id);
  app.save(clients);
});
