/// <reference path="../pb_data/types.d.ts" />

// Every base/auth collection in this schema was created without explicit
// created/updated fields (checked every migration file in this repo —
// none use PocketBase's "autodate" field type anywhere). On PocketBase
// 0.23+ these are optional collection fields, not implicit system
// columns, so any collection created without them genuinely has no
// created/updated column — any request sorting/filtering by "created" on
// one of these fails with "invalid sort field \"created\"", same as the
// customers/ai_jobs bug fixed in the previous migration.
//
// This migration covers every remaining base/auth collection this repo
// creates (64 of them) — customers and ai_jobs are excluded since
// 1735500024 already fixed those. PocketBase's own built-in "users" auth
// collection is not touched — it's framework-managed, not created by any
// migration in this repo, and already has proper timestamps.
//
// Idempotent: checks fields.getByName() before adding, so this is safe to
// re-run and won't error if a collection somehow already has one of these.
migrate((app) => {
  const collectionNames = [
    "permissions", "roles", "employees", "organisations", "products",
    "subscriptions", "invoices", "payments", "support_tickets",
    "conversations", "audit_logs", "impersonation_sessions", "agency_leads",
    "projects", "ai_employees", "servers", "health_checks", "incidents",
    "deployments", "utilities", "utility_leads", "utility_events",
    "partners", "referrals", "notifications", "leads", "lead_activities",
    "follow_ups", "email_templates", "email_events", "integration_status",
    "prospect_companies", "prospect_contacts", "prospect_research",
    "suppression_list", "acquisition_campaigns", "acquisition_events",
    "acquisition_targets", "agency_service_pricing", "clients",
    "agency_client_users", "agency_client_services", "intake_forms",
    "onboarding_notes", "implementation_reports", "agency_usage_events",
    "agency_usage_credits", "agency_invites", "agency_payments",
    "agency_service_configs", "service_packages",
    "agency_suppressed_contacts", "admin_users", "services",
    "portfolio_items", "blog_posts", "testimonial_clients",
    "credit_transactions", "form_submissions", "approved_partners",
    "integration_partner_applications", "admin_audit_log", "waitlist",
    "media",
  ];

  for (const name of collectionNames) {
    const collection = app.findCollectionByNameOrId(name);
    if (!collection.fields.getByName("created")) {
      collection.fields.add(new Field({ name: "created", type: "autodate", onCreate: true }));
    }
    if (!collection.fields.getByName("updated")) {
      collection.fields.add(new Field({ name: "updated", type: "autodate", onCreate: true, onUpdate: true }));
    }
    app.save(collection);
  }
}, (app) => {
  const collectionNames = [
    "permissions", "roles", "employees", "organisations", "products",
    "subscriptions", "invoices", "payments", "support_tickets",
    "conversations", "audit_logs", "impersonation_sessions", "agency_leads",
    "projects", "ai_employees", "servers", "health_checks", "incidents",
    "deployments", "utilities", "utility_leads", "utility_events",
    "partners", "referrals", "notifications", "leads", "lead_activities",
    "follow_ups", "email_templates", "email_events", "integration_status",
    "prospect_companies", "prospect_contacts", "prospect_research",
    "suppression_list", "acquisition_campaigns", "acquisition_events",
    "acquisition_targets", "agency_service_pricing", "clients",
    "agency_client_users", "agency_client_services", "intake_forms",
    "onboarding_notes", "implementation_reports", "agency_usage_events",
    "agency_usage_credits", "agency_invites", "agency_payments",
    "agency_service_configs", "service_packages",
    "agency_suppressed_contacts", "admin_users", "services",
    "portfolio_items", "blog_posts", "testimonial_clients",
    "credit_transactions", "form_submissions", "approved_partners",
    "integration_partner_applications", "admin_audit_log", "waitlist",
    "media",
  ];

  for (const name of collectionNames) {
    const collection = app.findCollectionByNameOrId(name);
    ["created", "updated"].forEach((fname) => {
      const field = collection.fields.getByName(fname);
      if (field) collection.fields.removeById(field.id);
    });
    app.save(collection);
  }
});
