/// <reference path="../pb_data/types.d.ts" />

// Agency lifecycle: Lead -> Discovery -> Qualification -> Quotation ->
// Invoice -> Payment -> Onboarding -> ... -> Retainer.
//
// The hard rule "NO PAYMENT = NO ONBOARDING" is enforced in
// pb_hooks/agency_transitions.pb.js, which intercepts updates to
// agency_leads.stage and rejects any transition into "onboarding" (or
// beyond) unless a linked invoice has status "paid". This is enforced
// server-side regardless of what the frontend sends.
migrate((app) => {
  const customers = app.findCollectionByNameOrId("customers");
  const invoices = app.findCollectionByNameOrId("invoices");
  const employees = app.findCollectionByNameOrId("employees");

  const agencyLeads = new Collection({
    type: "base",
    name: "agency_leads",
    fields: [
      { name: "company_name", type: "text", required: true, presentable: true, max: 200 },
      { name: "contact_name", type: "text", max: 150 },
      { name: "contact_email", type: "email" },
      { name: "customer", type: "relation", collectionId: customers.id, maxSelect: 1 }, // set once converted
      {
        name: "stage",
        type: "select",
        required: true,
        maxSelect: 1,
        values: [
          "lead", "discovery", "qualification", "quotation", "invoiced", "paid",
          "onboarding", "information_collection", "onboarding_complete",
          "implementation", "ai_implementation", "internal_testing", "qa_qc",
          "client_testing", "deployment", "handover", "retainer",
        ],
      },
      { name: "invoice", type: "relation", collectionId: invoices.id, maxSelect: 1 },
      { name: "owner", type: "relation", collectionId: employees.id, maxSelect: 1 },
      { name: "quoted_amount_cents", type: "number" },
      // Pricing-exception gate: if the quote exceeds the standard pricing
      // ceiling (AGENCY_STANDARD_PRICING_CEILING_CENTS, see .env.example),
      // pb_hooks/agency_transitions.pb.js blocks any stage transition past
      // "quotation" until manual_review_required is explicitly cleared by
      // someone with agency.manage — the system never auto-prices an
      // out-of-policy project. See README for the exact threshold rule.
      { name: "manual_review_required", type: "bool" },
      { name: "manual_review_cleared_by", type: "relation", collectionId: employees.id, maxSelect: 1 },
      { name: "manual_review_notes", type: "text", max: 500 },
      { name: "notes", type: "editor" },
    ],
    indexes: [
      "CREATE INDEX idx_agency_stage ON agency_leads (stage)",
      "CREATE INDEX idx_agency_customer ON agency_leads (customer)",
    ],
    // Readable by agency.view; mutations require agency.manage so stage
    // changes and pricing decisions are made only by staff with that
    // permission (super admin always bypasses).
    listRule: "@request.auth.employee.role.is_super_admin = true || @request.auth.employee.role.permissions.key ?= 'agency.view'",
    viewRule: "@request.auth.employee.role.is_super_admin = true || @request.auth.employee.role.permissions.key ?= 'agency.view'",
    createRule: "@request.auth.employee.role.is_super_admin = true || @request.auth.employee.role.permissions.key ?= 'agency.manage'",
    updateRule: "@request.auth.employee.role.is_super_admin = true || @request.auth.employee.role.permissions.key ?= 'agency.manage'",
    deleteRule: "@request.auth.employee.role.is_super_admin = true",
  });
  app.save(agencyLeads);

  const projects = new Collection({
    type: "base",
    name: "projects",
    fields: [
      { name: "name", type: "text", required: true, presentable: true, max: 200 },
      { name: "agency_lead", type: "relation", required: true, collectionId: agencyLeads.id, maxSelect: 1 },
      { name: "customer", type: "relation", required: true, collectionId: customers.id, maxSelect: 1 },
      { name: "lead_implementer", type: "relation", collectionId: employees.id, maxSelect: 1 },
      {
        name: "status",
        type: "select",
        required: true,
        maxSelect: 1,
        values: ["not_started", "in_progress", "blocked", "in_qa", "client_review", "deployed", "handed_over", "on_retainer"],
      },
      { name: "target_deployment_date", type: "date" },
      { name: "notes", type: "editor" },
    ],
    indexes: ["CREATE INDEX idx_projects_customer ON projects (customer)"],
    listRule: "@request.auth.employee.role.is_super_admin = true || @request.auth.employee.role.permissions.key ?= 'agency.view'",
    viewRule: "@request.auth.employee.role.is_super_admin = true || @request.auth.employee.role.permissions.key ?= 'agency.view'",
    createRule: "@request.auth.employee.role.is_super_admin = true || @request.auth.employee.role.permissions.key ?= 'agency.manage'",
    updateRule: "@request.auth.employee.role.is_super_admin = true || @request.auth.employee.role.permissions.key ?= 'agency.manage'",
    deleteRule: "@request.auth.employee.role.is_super_admin = true",
  });
  app.save(projects);
}, (app) => {
  app.delete(app.findCollectionByNameOrId("projects"));
  app.delete(app.findCollectionByNameOrId("agency_leads"));
});
