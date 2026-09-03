/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  const utilities = new Collection({
    type: "base",
    name: "utilities",
    fields: [
      { name: "name", type: "text", required: true, presentable: true, max: 100 },
      { name: "category", type: "text", max: 100 },
      { name: "slug", type: "text", required: true, max: 100 },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_utilities_slug ON utilities (slug)"],
    listRule: "@request.auth.employee.role.permissions.key ?= 'utilities.view' || @request.auth.employee.role.is_super_admin = true",
    viewRule: "@request.auth.employee.role.permissions.key ?= 'utilities.view' || @request.auth.employee.role.is_super_admin = true",
    createRule: "@request.auth.employee.role.is_super_admin = true",
    updateRule: "@request.auth.employee.role.is_super_admin = true",
    deleteRule: "@request.auth.employee.role.is_super_admin = true",
  });
  app.save(utilities);

  const utilityLeads = new Collection({
    type: "base",
    name: "utility_leads",
    fields: [
      { name: "email", type: "email", required: true },
      { name: "email_normalized", type: "text", required: true, max: 200 }, // lowercased, used for uniqueness
      { name: "name", type: "text", max: 150 },
      { name: "source_utility", type: "relation", collectionId: utilities.id, maxSelect: 1 },
      { name: "marketing_consent", type: "bool" }, // default false; never pre-checked
      { name: "marketing_consent_at", type: "date" },
      { name: "marketing_consent_withdrawn_at", type: "date" },
      { name: "converted_customer", type: "relation", collectionId: app.findCollectionByNameOrId("customers").id, maxSelect: 1 },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_utility_leads_email_norm ON utility_leads (email_normalized)",
    ],
    listRule: "@request.auth.employee.role.permissions.key ?= 'utilities.view' || @request.auth.employee.role.is_super_admin = true",
    viewRule: "@request.auth.employee.role.permissions.key ?= 'utilities.view' || @request.auth.employee.role.is_super_admin = true",
    // creation goes through /api/utility-leads/capture (see pb_hooks), which
    // normalizes the email and upserts instead of duplicating — never a raw
    // client-side create, so this stays permission-locked.
    createRule: null,
    updateRule: null,
    deleteRule: "@request.auth.employee.role.is_super_admin = true",
  });
  app.save(utilityLeads);

  // One row per invocation. No uploaded file content is stored here —
  // only the operational event, per spec ("Do NOT retain uploaded files
  // merely for analytics").
  const utilityEvents = new Collection({
    type: "base",
    name: "utility_events",
    fields: [
      { name: "utility", type: "relation", required: true, collectionId: utilities.id, maxSelect: 1 },
      { name: "outcome", type: "select", required: true, maxSelect: 1, values: ["success", "failure"] },
      { name: "anonymous_session_id", type: "text", max: 100 },
      { name: "utility_lead", type: "relation", collectionId: utilityLeads.id, maxSelect: 1 }, // set only if resolved to an identified lead
      { name: "processing_ms", type: "number" },
      { name: "error_code", type: "text", max: 100 },
      { name: "occurred_at", type: "date", required: true },
    ],
    indexes: [
      "CREATE INDEX idx_utility_events_utility ON utility_events (utility)",
      "CREATE INDEX idx_utility_events_occurred ON utility_events (occurred_at)",
    ],
    listRule: "@request.auth.employee.role.permissions.key ?= 'utilities.view' || @request.auth.employee.role.is_super_admin = true",
    viewRule: "@request.auth.employee.role.permissions.key ?= 'utilities.view' || @request.auth.employee.role.is_super_admin = true",
    createRule: "", // public: unauthenticated visitors trigger these via the utility itself
    updateRule: null,
    deleteRule: null,
  });
  app.save(utilityEvents);
}, (app) => {
  app.delete(app.findCollectionByNameOrId("utility_events"));
  app.delete(app.findCollectionByNameOrId("utility_leads"));
  app.delete(app.findCollectionByNameOrId("utilities"));
});
