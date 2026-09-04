/// <reference path="../pb_data/types.d.ts" />

// Consolidation migration: brings synkra-agency-client-portal's and
// synkra--web's collections onto this same PocketBase instance, per the
// "one shared instance" decision. Two link fields added to existing
// collections (see bottom of this file) so the pre-existing agency_leads
// pipeline and the new agency_client_services pipeline aren't silently
// duplicated records of the same real-world client.
//
// Access rules for Website/Agency-Portal-owned collections use the SAME
// employees/roles/permissions model as the rest of this instance, since
// synkra-os IS now the Admin Panel both of those repos' own architecture
// docs describe as "not yet built" / "reads and writes directly." New
// permission keys are seeded at the bottom.
migrate((app) => {
  const employees = app.findCollectionByNameOrId("employees");
  const customers = app.findCollectionByNameOrId("customers");
  const agencyLeads = app.findCollectionByNameOrId("agency_leads");

  const adminOrPerm = (key) =>
    `@request.auth.employee.role.is_super_admin = true || @request.auth.employee.role.permissions.key ?= '${key}'`;

  // =====================================================================
  // AGENCY PORTAL — owned by synkra-agency-client-portal, per its own
  // ARCHITECTURE.md §3. Field lists are copied verbatim from that doc.
  // =====================================================================

  const agencyClientUsers = new Collection({
    type: "auth",
    name: "agency_client_users",
    fields: [
      { name: "agency_client_id", type: "relation", required: true, maxSelect: 1 }, // set below once `clients` exists
      { name: "role", type: "select", required: true, maxSelect: 1, values: ["owner"] },
      { name: "invited_at", type: "date" },
      { name: "invite_accepted_at", type: "date" },
    ],
    listRule: "id = @request.auth.id",
    viewRule: "id = @request.auth.id",
    createRule: null, // accept-invite flow only, via pb_hooks in that repo
    updateRule: "id = @request.auth.id",
    deleteRule: null,
  });
  app.save(agencyClientUsers);

  const clients = new Collection({
    type: "base",
    name: "clients",
    fields: [
      { name: "company_name", type: "text", required: true, presentable: true, max: 200 },
      { name: "contact_name", type: "text", max: 150 },
      { name: "contact_email", type: "email" },
      { name: "contact_phone", type: "text", max: 40 },
      { name: "billing_mode", type: "select", required: true, maxSelect: 1, values: ["recurring", "manual"] },
      { name: "zoho_contact_id", type: "text", max: 100 },
      { name: "paystack_customer_code", type: "text", max: 100 },
      { name: "paystack_authorization_code", type: "text", max: 150 },
      { name: "status", type: "select", required: true, maxSelect: 1, values: ["active", "suspended"] },
      // NEW — links this Agency client to synkra-os's own customer record,
      // set by the Admin Panel when a won `agency_leads` row is converted.
      // See "New link fields" section at the bottom for why this is added
      // here rather than making `customers` and `clients` the same thing.
      { name: "customer", type: "relation", collectionId: customers.id, maxSelect: 1 },
    ],
    indexes: [],
    listRule: `id = @request.auth.agency_client_id || ${adminOrPerm("agency.view")}`,
    viewRule: `id = @request.auth.agency_client_id || ${adminOrPerm("agency.view")}`,
    createRule: null, // accept-invite (portal) or manual onboarding (admin) — both via server-side code, not raw client create
    updateRule: adminOrPerm("agency.manage"), // billing_mode changes go through Admin Panel per portal's own docs
    deleteRule: adminOrPerm("agency.manage"),
  });
  app.save(clients);

  // Now that `clients` exists, point agency_client_users.agency_client_id at it.
  agencyClientUsers.fields.getByName("agency_client_id").collectionId = clients.id;
  app.save(agencyClientUsers);

  const agencyClientServices = new Collection({
    type: "base",
    name: "agency_client_services",
    fields: [
      { name: "agency_client_id", type: "relation", required: true, collectionId: clients.id, maxSelect: 1 },
      { name: "service_slug", type: "text", required: true, max: 100 },
      { name: "tier", type: "text", max: 100 },
      { name: "monthly_price", type: "number" },
      { name: "setup_price", type: "number" }, // locked at purchase time
      { name: "status", type: "select", maxSelect: 1, values: ["active", "paused", "cancelled"] },
      {
        name: "onboarding_status",
        type: "select",
        maxSelect: 1,
        values: [
          "quotation_sent", "invoiced", "paid", "intake_form_completed",
          "onboarding_scheduled", "onboarding_completed", "onboarding_notes_ready",
          "implementation_triggered", "implementing", "pending_qc", "active",
        ],
      },
      { name: "pending_change", type: "select", maxSelect: 1, values: ["none", "pause_at_next_cycle", "cancel_at_next_cycle"] },
      { name: "current_period_start", type: "date" },
      { name: "current_period_end", type: "date" },
      { name: "activated_at", type: "date" },
      // NEW — traces this post-sale service record back to the pre-sale
      // agency_leads deal that closed it. Nullable: not every service row
      // will have one if onboarding predates this migration.
      { name: "originating_agency_lead", type: "relation", collectionId: agencyLeads.id, maxSelect: 1 },
    ],
    indexes: ["CREATE INDEX idx_acs_client ON agency_client_services (agency_client_id)"],
    listRule: `agency_client_id.id = @request.auth.agency_client_id || ${adminOrPerm("agency.view")}`,
    viewRule: `agency_client_id.id = @request.auth.agency_client_id || ${adminOrPerm("agency.view")}`,
    createRule: null, // accept-invite provisioning (portal) or admin-add (admin) — server-side
    updateRule: adminOrPerm("agency.manage"),
    deleteRule: adminOrPerm("agency.manage"),
  });
  app.save(agencyClientServices);

  const intakeForms = new Collection({
    type: "base",
    name: "intake_forms",
    fields: [
      { name: "client_id", type: "relation", required: true, collectionId: clients.id, maxSelect: 1 },
      { name: "agency_client_service_id", type: "relation", required: true, collectionId: agencyClientServices.id, maxSelect: 1 },
      { name: "service", type: "text", max: 100 },
      { name: "plan_tier", type: "text", max: 100 },
      { name: "data", type: "json" },
      { name: "submitted_at", type: "date" },
    ],
    indexes: ["CREATE INDEX idx_intake_client ON intake_forms (client_id)"],
    listRule: `client_id.id = @request.auth.agency_client_id || ${adminOrPerm("agency.view")}`,
    viewRule: `client_id.id = @request.auth.agency_client_id || ${adminOrPerm("agency.view")}`,
    createRule: "client_id.id = @request.auth.agency_client_id", // the client portal is the only creator
    updateRule: adminOrPerm("agency.manage"), // corrections only, per the portal's own docs
    deleteRule: adminOrPerm("agency.manage"),
  });
  app.save(intakeForms);

  const onboardingNotes = new Collection({
    type: "base",
    name: "onboarding_notes",
    fields: [
      { name: "client_id", type: "relation", required: true, collectionId: clients.id, maxSelect: 1 },
      { name: "agency_client_service_id", type: "relation", required: true, collectionId: agencyClientServices.id, maxSelect: 1 },
      { name: "call_held_at", type: "date" },
      { name: "notes", type: "editor" },
      { name: "changes_from_form", type: "editor" },
      { name: "additional_info", type: "editor" },
      { name: "finalized_by", type: "relation", collectionId: employees.id, maxSelect: 1 },
      { name: "finalized_at", type: "date" },
    ],
    indexes: ["CREATE INDEX idx_onb_notes_client ON onboarding_notes (client_id)"],
    listRule: adminOrPerm("agency.view"), // internal only, per the portal's docs
    viewRule: adminOrPerm("agency.view"),
    createRule: adminOrPerm("agency.manage"), // a human is always on this call
    updateRule: adminOrPerm("agency.manage"),
    deleteRule: adminOrPerm("agency.manage"),
  });
  app.save(onboardingNotes);

  const implementationReports = new Collection({
    type: "base",
    name: "implementation_reports",
    fields: [
      { name: "client_id", type: "relation", required: true, collectionId: clients.id, maxSelect: 1 },
      { name: "agency_client_service_id", type: "relation", required: true, collectionId: agencyClientServices.id, maxSelect: 1 },
      { name: "service", type: "text", max: 100 },
      { name: "status", type: "select", maxSelect: 1, values: ["in_progress", "ready_for_qc", "needs_review", "blocked"] },
      { name: "steps_completed", type: "json" },
      { name: "test_results", type: "json" },
      { name: "flags_for_human", type: "json" },
      { name: "started_at", type: "date" },
      { name: "completed_at", type: "date" },
    ],
    indexes: ["CREATE INDEX idx_impl_reports_client ON implementation_reports (client_id)"],
    listRule: adminOrPerm("agency.view"), // this is what QC reviews
    viewRule: adminOrPerm("agency.view"),
    createRule: null, // Implementation AI's own scoped service account only — no employee/permission-based create
    updateRule: adminOrPerm("agency.manage"), // QC decisions/overrides; the AI's own updates use its scoped account, not this rule
    deleteRule: adminOrPerm("agency.manage"),
  });
  app.save(implementationReports);

  const agencyUsageEvents = new Collection({
    type: "base",
    name: "agency_usage_events",
    fields: [
      { name: "agency_client_service_id", type: "relation", required: true, collectionId: agencyClientServices.id, maxSelect: 1 },
      { name: "usage_type", type: "select", required: true, maxSelect: 1, values: ["voice_minute", "email", "sms", "whatsapp_conversation", "ai_operation"] },
      { name: "quantity", type: "number", required: true },
      { name: "occurred_at", type: "date", required: true },
      { name: "source", type: "text", max: 100 },
    ],
    indexes: ["CREATE INDEX idx_usage_events_service ON agency_usage_events (agency_client_service_id)"],
    listRule: `agency_client_service_id.agency_client_id.id = @request.auth.agency_client_id || ${adminOrPerm("agency.view")}`,
    viewRule: `agency_client_service_id.agency_client_id.id = @request.auth.agency_client_id || ${adminOrPerm("agency.view")}`,
    createRule: null, // synkra-core's own scoped service account only — append-only
    updateRule: null,
    deleteRule: null,
  });
  app.save(agencyUsageEvents);

  const agencyUsageCredits = new Collection({
    type: "base",
    name: "agency_usage_credits",
    fields: [
      { name: "agency_client_service_id", type: "relation", required: true, collectionId: agencyClientServices.id, maxSelect: 1 },
      { name: "usage_type", type: "select", required: true, maxSelect: 1, values: ["voice_minute", "email", "sms", "whatsapp_conversation", "ai_operation"] },
      { name: "source", type: "select", required: true, maxSelect: 1, values: ["included", "purchased"] },
      { name: "amount", type: "number", required: true },
      { name: "remaining", type: "number", required: true },
      { name: "granted_at", type: "date" },
      { name: "expires_at", type: "date" },
    ],
    indexes: ["CREATE INDEX idx_usage_credits_service ON agency_usage_credits (agency_client_service_id)"],
    listRule: `agency_client_service_id.agency_client_id.id = @request.auth.agency_client_id || ${adminOrPerm("agency.view")}`,
    viewRule: `agency_client_service_id.agency_client_id.id = @request.auth.agency_client_id || ${adminOrPerm("agency.view")}`,
    createRule: `agency_client_service_id.agency_client_id.id = @request.auth.agency_client_id || ${adminOrPerm("agency.manage")}`, // client: purchased only, via Paystack webhook code; admin: manual [...]
    updateRule: adminOrPerm("agency.manage"),
    deleteRule: adminOrPerm("agency.manage"),
  });
  app.save(agencyUsageCredits);

  const agencyInvites = new Collection({
    type: "base",
    name: "agency_invites",
    fields: [
      { name: "email", type: "email", required: true },
      { name: "company_name", type: "text", max: 200 },
      { name: "service_slugs", type: "json" },
      { name: "token", type: "text", required: true, max: 100 },
      { name: "status", type: "select", required: true, maxSelect: 1, values: ["pending", "accepted", "expired"] },
      { name: "expires_at", type: "date" },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_agency_invites_token ON agency_invites (token)"],
    listRule: `token != "" || ${adminOrPerm("agency.view")}`, // public, exact-token lookup only, per the portal's docs
    viewRule: `token != "" || ${adminOrPerm("agency.view")}`,
    createRule: adminOrPerm("agency.manage"),
    updateRule: `token != "" || ${adminOrPerm("agency.manage")}`, // accept-invite flow flips status to accepted
    deleteRule: adminOrPerm("agency.manage"),
  });
  app.save(agencyInvites);

  const agencyPayments = new Collection({
    type: "base",
    name: "agency_payments",
    fields: [
      { name: "agency_client_id", type: "relation", required: true, collectionId: clients.id, maxSelect: 1 },
      { name: "agency_client_service_id", type: "relation", collectionId: agencyClientServices.id, maxSelect: 1 },
      { name: "purpose", type: "select", required: true, maxSelect: 1, values: ["setup_fee", "monthly_renewal", "addon_purchase"] },
      { name: "addon_usage_type", type: "text", max: 100 },
      { name: "addon_quantity", type: "number" },
      { name: "amount_rand", type: "number", required: true },
      { name: "paystack_reference", type: "text", required: true, max: 150 },
      { name: "status", type: "select", required: true, maxSelect: 1, values: ["pending", "success", "failed"] },
      { name: "paystack_authorization_code", type: "text", max: 150 },
      { name: "completed_at", type: "date" },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_agency_payments_ref ON agency_payments (paystack_reference)"],
    listRule: `agency_client_id.id = @request.auth.agency_client_id || ${adminOrPerm("agency.view")}`,
    viewRule: `agency_client_id.id = @request.auth.agency_client_id || ${adminOrPerm("agency.view")}`,
    createRule: "agency_client_id.id = @request.auth.agency_client_id", // checkout-init, always starts pending
    updateRule: null, // webhook only, via a scoped service account — not exposed to any auth-rule-based writer
    deleteRule: null,
  });
  app.save(agencyPayments);

  const agencyServiceConfigs = new Collection({
    type: "base",
    name: "agency_service_configs",
    fields: [
      { name: "agency_client_service_id", type: "relation", required: true, collectionId: agencyClientServices.id, maxSelect: 1 },
      { name: "config", type: "json" },
      { name: "updated_by", type: "text", max: 100 }, // "implementation_ai" or an employee id
    ],
    indexes: ["CREATE INDEX idx_service_configs_service ON agency_service_configs (agency_client_service_id)"],
    listRule: adminOrPerm("agency.view"),
    viewRule: adminOrPerm("agency.view"),
    createRule: null, // Implementation AI's scoped account only
    updateRule: null,
    deleteRule: adminOrPerm("agency.manage"),
  });
  app.save(agencyServiceConfigs);

  const servicePackages = new Collection({
    type: "base",
    name: "service_packages",
    fields: [
      { name: "service_slug", type: "text", required: true, max: 100 },
      { name: "tier", type: "text", required: true, max: 100 },
      { name: "monthly_price", type: "number" },
      { name: "setup_price", type: "number" },
      { name: "included_usage", type: "json" },
      { name: "active", type: "bool" },
    ],
    indexes: ["CREATE INDEX idx_service_packages_slug ON service_packages (service_slug)"],
    listRule: "",
    viewRule: "",
    createRule: adminOrPerm("agency.manage"),
    updateRule: adminOrPerm("agency.manage"),
    deleteRule: adminOrPerm("agency.manage"),
  });
  app.save(servicePackages);

  const agencySuppressedContacts = new Collection({
    type: "base",
    name: "agency_suppressed_contacts",
    fields: [
      { name: "email", type: "email", required: true },
      { name: "reason", type: "text", max: 200 },
      { name: "suppressed_at", type: "date" },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_suppressed_email ON agency_suppressed_contacts (email)"],
    listRule: adminOrPerm("agency.view"),
    viewRule: adminOrPerm("agency.view"),
    createRule: null, // opt-out webhook / Lead Reactivation service account only
    updateRule: null,
    deleteRule: adminOrPerm("agency.manage"),
  });
  app.save(agencySuppressedContacts);

  // =====================================================================
  // WEBSITE — owned by synkra--web. `clients` is renamed to
  // `testimonial_clients` here on creation (it never existed under the
  // old name on this instance, so this is a fresh create, not an ALTER —
  // the rename only matters for synkra--web's own code, see chat).
  // =====================================================================

  const adminUsers = new Collection({
    type: "auth",
    name: "admin_users",
    fields: [
      { name: "full_name", type: "text" },
      { name: "avatar_url", type: "text" },
      { name: "last_sign_in_at", type: "date" },
    ],
    listRule: "id = @request.auth.id",
    viewRule: "id = @request.auth.id",
    createRule: null, // superuser-provisioned only
    updateRule: "id = @request.auth.id",
    deleteRule: null,
  });
  app.save(adminUsers);

  const services = new Collection({
    type: "base",
    name: "services",
    fields: [
      { name: "slug", type: "text", required: true, max: 100 },
      { name: "name", type: "text", required: true, max: 150 },
      { name: "description", type: "text", max: 500 },
      { name: "setup_fee", type: "number" },
      { name: "monthly_basic", type: "number" },
      { name: "monthly_standard", type: "number" },
      { name: "monthly_premium", type: "number" },
      { name: "usage_rate", type: "number" },
      { name: "usage_unit", type: "text", max: 50 },
      { name: "sort_order", type: "number" },
      { name: "active", type: "bool" },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_services_slug ON services (slug)"],
    listRule: `active = true || ${adminOrPerm("website.manage")}`,
    viewRule: `active = true || ${adminOrPerm("website.manage")}`,
    createRule: adminOrPerm("website.manage"),
    updateRule: adminOrPerm("website.manage"),
    deleteRule: adminOrPerm("website.manage"),
  });
  app.save(services);

  const portfolioItems = new Collection({
    type: "base",
    name: "portfolio_items",
    fields: [
      { name: "slug", type: "text", required: true, max: 150 },
      { name: "title", type: "text", required: true, max: 200 },
      { name: "client_name", type: "text", max: 150 },
      { name: "category", type: "text", max: 100 },
      { name: "summary", type: "text", max: 500 },
      { name: "challenge", type: "editor" },
      { name: "solution", type: "editor" },
      { name: "outcome", type: "editor" },
      { name: "images", type: "file", maxSelect: 10 },
      { name: "aspect_ratio", type: "text", max: 20 },
      { name: "disclaimer", type: "text", max: 500 },
      { name: "services", type: "json" },
      { name: "status", type: "select", maxSelect: 1, values: ["draft", "published", "archived"] },
      { name: "sort_order", type: "number" },
      { name: "published_at", type: "date" },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_portfolio_slug ON portfolio_items (slug)"],
    listRule: `status = "published" || ${adminOrPerm("website.manage")}`,
    viewRule: `status = "published" || ${adminOrPerm("website.manage")}`,
    createRule: adminOrPerm("website.manage"),
    updateRule: adminOrPerm("website.manage"),
    deleteRule: adminOrPerm("website.manage"),
  });
  app.save(portfolioItems);

  const blogPosts = new Collection({
    type: "base",
    name: "blog_posts",
    fields: [
      { name: "slug", type: "text", required: true, max: 150 },
      { name: "title", type: "text", required: true, max: 200 },
      { name: "excerpt", type: "text", max: 300 },
      { name: "content_md", type: "editor", required: true },
      { name: "cover_image", type: "file", maxSelect: 1 },
      { name: "author_name", type: "text", max: 150 },
      { name: "tags", type: "json" },
      { name: "category", type: "text", max: 100 },
      { name: "featured", type: "bool" },
      { name: "view_count", type: "number" },
      { name: "read_time_minutes", type: "number" },
      { name: "status", type: "select", maxSelect: 1, values: ["draft", "published", "archived"] },
      { name: "published_at", type: "date" },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_blog_slug ON blog_posts (slug)"],
    listRule: `status = "published" || ${adminOrPerm("website.manage")}`,
    viewRule: `status = "published" || ${adminOrPerm("website.manage")}`,
    createRule: adminOrPerm("website.manage"),
    updateRule: adminOrPerm("website.manage"),
    deleteRule: adminOrPerm("website.manage"),
  });
  app.save(blogPosts);

  // RENAMED from the website's own docs' `clients` — see chat for why.
  const testimonialClients = new Collection({
    type: "base",
    name: "testimonial_clients",
    fields: [
      { name: "company_name", type: "text", required: true, max: 200 },
      { name: "contact_name", type: "text", max: 150 },
      { name: "email", type: "email" },
      { name: "phone", type: "text", max: 40 },
      { name: "service_slug", type: "relation", collectionId: services.id, maxSelect: 1 },
      { name: "plan_tier", type: "select", maxSelect: 1, values: ["basic", "standard", "premium"] },
      { name: "status", type: "select", maxSelect: 1, values: ["active", "paused", "cancelled"] },
      { name: "credit_balance", type: "number" },
      { name: "monthly_credit_allowance", type: "number" },
      { name: "onboarding_date", type: "date" },
      { name: "notes", type: "editor" },
      { name: "testimonial", type: "text", max: 1000 },
      { name: "testimonial_published", type: "bool" },
      { name: "logo", type: "file", maxSelect: 1 },
    ],
    indexes: [],
    listRule: `${adminOrPerm("website.manage")} || testimonial_published = true`,
    viewRule: `${adminOrPerm("website.manage")} || testimonial_published = true`,
    createRule: adminOrPerm("website.manage"),
    updateRule: adminOrPerm("website.manage"),
    deleteRule: adminOrPerm("website.manage"),
  });
  app.save(testimonialClients);

  const creditTransactions = new Collection({
    type: "base",
    name: "credit_transactions",
    fields: [
      { name: "client_id", type: "relation", required: true, collectionId: testimonialClients.id, maxSelect: 1, cascadeDelete: true },
      { name: "txn_type", type: "select", maxSelect: 1, values: ["grant", "usage", "adjustment", "overage_recovery"] },
      { name: "amount", type: "number" },
      { name: "description", type: "text", max: 300 },
      { name: "balance_after", type: "number", required: true },
    ],
    indexes: ["CREATE INDEX idx_credit_txn_client ON credit_transactions (client_id)"],
    listRule: adminOrPerm("website.manage"),
    viewRule: adminOrPerm("website.manage"),
    createRule: adminOrPerm("website.manage"),
    updateRule: adminOrPerm("website.manage"),
    deleteRule: adminOrPerm("website.manage"),
  });
  app.save(creditTransactions);

  const formSubmissions = new Collection({
    type: "base",
    name: "form_submissions",
    fields: [
      { name: "form_type", type: "text", required: true, max: 100 },
      { name: "name", type: "text", max: 150 },
      { name: "email", type: "email" },
      { name: "phone", type: "text", max: 40 },
      { name: "company", type: "text", max: 200 },
      { name: "message", type: "text", max: 2000 },
      { name: "payload", type: "json" },
      { name: "status", type: "select", maxSelect: 1, values: ["new", "read", "archived", "converted"] },
    ],
    indexes: ["CREATE INDEX idx_form_submissions_type ON form_submissions (form_type)"],
    listRule: `${adminOrPerm("leads.view")} || ${adminOrPerm("website.manage")}`,
    viewRule: `${adminOrPerm("leads.view")} || ${adminOrPerm("website.manage")}`,
    createRule: "", // anyone can submit a form
    updateRule: `${adminOrPerm("leads.manage")} || ${adminOrPerm("website.manage")}`,
    deleteRule: adminOrPerm("website.manage"),
  });
  app.save(formSubmissions);

  const approvedPartners = new Collection({
    type: "base",
    name: "approved_partners",
    fields: [
      { name: "submission_id", type: "relation", collectionId: formSubmissions.id, maxSelect: 1 },
      { name: "partner_type", type: "select", maxSelect: 1, values: ["agency", "referral"] },
      { name: "name", type: "text", required: true, max: 150 },
      { name: "email", type: "email" },
      { name: "phone", type: "text", max: 40 },
      { name: "company", type: "text", max: 200 },
      { name: "commission_rate", type: "number" },
      { name: "status", type: "select", maxSelect: 1, values: ["active", "paused", "terminated"] },
      { name: "notes", type: "text", max: 500 },
      { name: "approved_at", type: "date" },
    ],
    indexes: [],
    listRule: adminOrPerm("website.manage"),
    viewRule: adminOrPerm("website.manage"),
    createRule: adminOrPerm("website.manage"),
    updateRule: adminOrPerm("website.manage"),
    deleteRule: adminOrPerm("website.manage"),
  });
  app.save(approvedPartners);

  const integrationPartnerApplications = new Collection({
    type: "base",
    name: "integration_partner_applications",
    fields: [
      { name: "company", type: "text", max: 200 },
      { name: "contact_name", type: "text", max: 150 },
      { name: "email", type: "email" },
      { name: "application_data", type: "json" },
      { name: "ai_score", type: "number" },
      { name: "ai_flag", type: "select", maxSelect: 1, values: ["low", "medium", "high"] },
      { name: "ai_summary", type: "text", max: 1000 },
      { name: "ai_strengths", type: "json" },
      { name: "ai_risks", type: "json" },
      { name: "ai_missing_information", type: "json" },
      { name: "status", type: "select", maxSelect: 1, values: ["new", "reviewing", "contacted", "approved", "declined"] },
    ],
    indexes: [],
    listRule: adminOrPerm("website.manage"),
    viewRule: adminOrPerm("website.manage"),
    createRule: "", // public application form
    updateRule: adminOrPerm("website.manage"), // status only, per the website's own docs — the AI never touches status
    deleteRule: adminOrPerm("website.manage"),
  });
  app.save(integrationPartnerApplications);

  const adminAuditLog = new Collection({
    type: "base",
    name: "admin_audit_log",
    fields: [
      { name: "actor_id", type: "text", max: 100 },
      { name: "actor_email", type: "email" },
      { name: "action", type: "text", required: true, max: 150 },
      { name: "entity_type", type: "text", max: 100 },
      { name: "entity_id", type: "text", max: 100 },
      { name: "metadata", type: "json" },
    ],
    indexes: [],
    listRule: adminOrPerm("website.manage"),
    viewRule: adminOrPerm("website.manage"),
    createRule: adminOrPerm("website.manage"),
    updateRule: null, // append-only
    deleteRule: null,
  });
  app.save(adminAuditLog);

  const waitlist = new Collection({
    type: "base",
    name: "waitlist",
    fields: [
      { name: "email", type: "email", required: true },
      { name: "product", type: "text", required: true, max: 50 },
    ],
    indexes: [],
    listRule: adminOrPerm("website.manage"),
    viewRule: adminOrPerm("website.manage"),
    createRule: "",
    updateRule: adminOrPerm("website.manage"),
    deleteRule: adminOrPerm("website.manage"),
  });
  app.save(waitlist);

  const media = new Collection({
    type: "base",
    name: "media",
    fields: [
      { name: "bucket", type: "select", required: true, maxSelect: 1, values: ["portfolio-images", "blog-images"] },
      { name: "filename", type: "text", required: true, max: 300 },
      { name: "file", type: "file", maxSelect: 1 },
    ],
    indexes: [],
    listRule: "", // public — renders on public portfolio/blog pages
    viewRule: "",
    createRule: null, // superuser-only via the upload endpoint, never a regular admin session
    updateRule: null,
    deleteRule: adminOrPerm("website.manage"),
  });
  app.save(media);

  // =====================================================================
  // New permission keys for the collections above
  // =====================================================================
  const permCollection = app.findCollectionByNameOrId("permissions");
  const newPerms = [
    ["website.manage", "Manage website content, forms & partners", "website"],
  ];
  for (const [key, label, category] of newPerms) {
    const r = new Record(permCollection);
    r.set("key", key);
    r.set("label", label);
    r.set("category", category);
    app.save(r);
  }

  // Super Administrator gets every permission automatically — add the new
  // one(s) to that role's existing list rather than leaving it stale.
  const superAdmin = app.findFirstRecordByFilter("roles", "");
  const newPermRecords = app.findRecordsByFilter(
    "permissions",
    newPerms.map(([key]) => `key = "${key}"`).join(" || ")
  );
  const existing = superAdmin.get("permissions") || [];
  superAdmin.set("permissions", existing.concat(newPermRecords.map(function (r) { return r.id; })));
  app.save(superAdmin);
}, (app) => {
  const names = [
    "media", "waitlist", "admin_audit_log", "integration_partner_applications",
    "approved_partners", "form_submissions", "credit_transactions",
    "testimonial_clients", "blog_posts", "portfolio_items", "services", "admin_users",
    "agency_suppressed_contacts", "service_packages", "agency_service_configs",
    "agency_payments", "agency_invites", "agency_usage_credits", "agency_usage_events",
    "implementation_reports", "onboarding_notes", "intake_forms",
    "agency_client_services", "clients", "agency_client_users",
  ];
  for (const name of names) {
    const c = app.findCollectionByNameOrId(name);
    if (c) app.delete(c);
  }
});
