/// <reference path="../pb_data/types.d.ts" />

// Leads are deliberately a SEPARATE collection from customers. The spec is
// explicit: a utility user, a utility lead, a product customer, and an
// agency client are different stages of one relationship, not one
// collapsed record. A lead only becomes `customers.converted_customer` /
// an agency_leads row once it actually converts — this collection never
// gets silently merged into `customers`.
migrate((app) => {
  const employees = app.findCollectionByNameOrId("employees");
  const customers = app.findCollectionByNameOrId("customers");
  const agencyLeads = app.findCollectionByNameOrId("agency_leads");
  const utilityLeads = app.findCollectionByNameOrId("utility_leads");

  const leads = new Collection({
    type: "base",
    name: "leads",
    fields: [
      { name: "lead_code", type: "text", required: true, presentable: true, max: 20 },
      { name: "name", type: "text", required: true, max: 150 },
      { name: "company", type: "text", max: 200 },
      { name: "email", type: "email" },
      { name: "phone", type: "text", max: 40 },
      {
        name: "source",
        type: "select",
        required: true,
        maxSelect: 1,
        values: [
          "qr_code_generator", "link_shortener", "business_contact_page",
          "inquiry_form", "file_compressor", "file_converter", "csv_cleaner",
          "background_remover", "invoice_generator", "quotation_generator",
          "referral", "partner", "other_utility", "manual", "other",
        ],
      },
      { name: "source_detail", type: "text", max: 300 },
      // Traceable back to the actual anonymous-or-identified utility usage
      // that produced this lead, when the source was a utility.
      { name: "originating_utility_lead", type: "relation", collectionId: utilityLeads.id, maxSelect: 1 },
      { name: "product_interest", type: "text", max: 150 },
      { name: "service_interest", type: "text", max: 150 },
      { name: "lead_type", type: "select", maxSelect: 1, values: ["product", "agency", "partnership", "other"] },
      {
        name: "status",
        type: "select",
        required: true,
        maxSelect: 1,
        values: ["new", "contacted", "qualified", "discovery", "proposal", "negotiation", "won", "lost", "nurture"],
      },
      { name: "priority", type: "select", maxSelect: 1, values: ["low", "medium", "high"] },
      { name: "assigned_employee", type: "relation", collectionId: employees.id, maxSelect: 1 },
      { name: "last_contact_at", type: "date" },
      { name: "next_follow_up_at", type: "date" },
      { name: "notes", type: "editor" },
      { name: "qualification_notes", type: "text", max: 500 },
      { name: "score", type: "number" },
      // Consent mirrors the utility_leads model: optional, explicit,
      // unchecked by default, withdrawable — never assumed from the lead
      // simply existing.
      { name: "marketing_consent", type: "bool" },
      { name: "marketing_consent_at", type: "date" },
      {
        name: "conversion_status",
        type: "select",
        maxSelect: 1,
        values: ["not_converted", "converted_customer", "converted_agency_client", "disqualified"],
      },
      { name: "converted_customer", type: "relation", collectionId: customers.id, maxSelect: 1 },
      { name: "converted_agency_lead", type: "relation", collectionId: agencyLeads.id, maxSelect: 1 },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_leads_code ON leads (lead_code)",
      "CREATE INDEX idx_leads_status ON leads (status)",
      "CREATE INDEX idx_leads_assigned ON leads (assigned_employee)",
      "CREATE INDEX idx_leads_email ON leads (email)",
    ],
    listRule: "@request.auth.employee.role.is_super_admin = true || @request.auth.employee.role.permissions.key ?= 'leads.view'",
    viewRule: "@request.auth.employee.role.is_super_admin = true || @request.auth.employee.role.permissions.key ?= 'leads.view'",
    createRule: "@request.auth.employee.role.is_super_admin = true || @request.auth.employee.role.permissions.key ?= 'leads.manage'",
    updateRule: "@request.auth.employee.role.is_super_admin = true || @request.auth.employee.role.permissions.key ?= 'leads.manage'",
    deleteRule: "@request.auth.employee.role.is_super_admin = true",
  });
  app.save(leads);

  // Timeline of contact attempts / status changes / notes on a lead —
  // separate from follow_ups (which is forward-looking/scheduled).
  const leadActivities = new Collection({
    type: "base",
    name: "lead_activities",
    fields: [
      { name: "lead", type: "relation", required: true, collectionId: leads.id, maxSelect: 1 },
      { name: "activity_type", type: "select", maxSelect: 1, values: ["note", "status_change", "email", "call", "meeting", "other"] },
      { name: "description", type: "text", required: true, max: 1000 },
      { name: "actor_employee", type: "relation", collectionId: employees.id, maxSelect: 1 },
      { name: "occurred_at", type: "date", required: true },
    ],
    indexes: ["CREATE INDEX idx_lead_activities_lead ON lead_activities (lead)"],
    listRule: "@request.auth.employee.role.is_super_admin = true || @request.auth.employee.role.permissions.key ?= 'leads.view'",
    viewRule: "@request.auth.employee.role.is_super_admin = true || @request.auth.employee.role.permissions.key ?= 'leads.view'",
    createRule: "@request.auth.employee.role.is_super_admin = true || @request.auth.employee.role.permissions.key ?= 'leads.manage'",
    updateRule: "@request.auth.employee.role.is_super_admin = true",
    deleteRule: "@request.auth.employee.role.is_super_admin = true",
  });
  app.save(leadActivities);
}, (app) => {
  app.delete(app.findCollectionByNameOrId("lead_activities"));
  app.delete(app.findCollectionByNameOrId("leads"));
});
