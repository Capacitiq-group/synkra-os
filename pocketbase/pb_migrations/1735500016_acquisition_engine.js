/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  const employees = app.findCollectionByNameOrId("employees");

  // ---- prospect_companies ------------------------------------------------
  const companies = new Collection({
    type: "base",
    name: "prospect_companies",
    fields: [
      { name: "company_name", type: "text", required: true, presentable: true, max: 200 },
      { name: "domain", type: "text", max: 150 }, // normalized, used for dedup
      { name: "industry", type: "text", max: 100 },
      { name: "location", type: "text", max: 150 },
      { name: "website", type: "url" },
      { name: "phone", type: "text", max: 40 },
      { name: "public_email", type: "email" },
      {
        name: "source",
        type: "select",
        maxSelect: 1,
        values: ["search", "yellow_pages", "local_directory", "public_social", "company_website", "apollo", "other"],
      },
      { name: "source_urls", type: "json" },
      { name: "apollo_organization_id", type: "text", max: 100 }, // external identifier, retained not duplicated
      { name: "company_description", type: "text", max: 1000 },
      { name: "fit_score", type: "number" }, // 0-100, ICP Qualification Agent output
      { name: "opportunity_score", type: "number" },
      {
        name: "recommended_offer",
        type: "select",
        maxSelect: 1,
        values: ["STANDARD_DEFINED_SCOPE", "CUSTOM_AGENTIC_AI", "SETUP_HANDOFF", "NOT_A_FIT"],
      },
      {
        name: "research_status",
        type: "select",
        maxSelect: 1,
        values: ["discovered", "researching", "researched", "qualified", "rejected", "approved_for_outreach"],
      },
      { name: "already_contacted", type: "bool" }, // hard dedup guard against re-entering the outreach queue
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_prospect_companies_domain ON prospect_companies (domain)",
      "CREATE INDEX idx_prospect_companies_status ON prospect_companies (research_status)",
      "CREATE INDEX idx_prospect_companies_source ON prospect_companies (source)",
    ],
    listRule: "@request.auth.employee.role.is_super_admin = true || @request.auth.employee.role.permissions.key ?= 'acquisition.view'",
    viewRule: "@request.auth.employee.role.is_super_admin = true || @request.auth.employee.role.permissions.key ?= 'acquisition.view'",
    createRule: null, // written only via /api/acquisition/* ingestion routes (worker-authenticated)
    updateRule: null,
    deleteRule: "@request.auth.employee.role.is_super_admin = true",
  });
  app.save(companies);

  // ---- prospect_contacts --------------------------------------------------
  const contacts = new Collection({
    type: "base",
    name: "prospect_contacts",
    fields: [
      { name: "company", type: "relation", required: true, collectionId: companies.id, maxSelect: 1 },
      { name: "name", type: "text", required: true, max: 150 },
      { name: "job_title", type: "text", max: 150 },
      { name: "business_email", type: "email" },
      { name: "phone", type: "text", max: 40 },
      { name: "source", type: "text", max: 100 },
      { name: "source_url", type: "url" },
      { name: "verification_status", type: "select", maxSelect: 1, values: ["unverified", "verified", "invalid"] },
      { name: "contact_confidence", type: "number" }, // 0-100
    ],
    indexes: [
      "CREATE INDEX idx_prospect_contacts_company ON prospect_contacts (company)",
      "CREATE UNIQUE INDEX idx_prospect_contacts_email ON prospect_contacts (business_email)",
    ],
    listRule: "@request.auth.employee.role.is_super_admin = true || @request.auth.employee.role.permissions.key ?= 'acquisition.view'",
    viewRule: "@request.auth.employee.role.is_super_admin = true || @request.auth.employee.role.permissions.key ?= 'acquisition.view'",
    createRule: null,
    updateRule: null,
    deleteRule: "@request.auth.employee.role.is_super_admin = true",
  });
  app.save(contacts);

  // ---- prospect_research (the dossier) ------------------------------------
  const research = new Collection({
    type: "base",
    name: "prospect_research",
    fields: [
      { name: "company", type: "relation", required: true, collectionId: companies.id, maxSelect: 1 },
      { name: "research_summary", type: "text", max: 2000 },
      { name: "observed_signals", type: "json" },
      { name: "pain_points", type: "json" },
      { name: "opportunities", type: "json" },
      // Spec requires distinguishing observed fact / reasonable hypothesis /
      // unsupported assumption — stored explicitly, not collapsed into one
      // free-text blob, so quality control (and outreach generation) can
      // enforce "unsupported assumptions must not be presented as facts."
      { name: "evidence", type: "json" }, // [{ claim, classification: fact|hypothesis|assumption, source_url }]
      { name: "confidence", type: "select", maxSelect: 1, values: ["low", "medium", "high"] },
      { name: "research_agent_version", type: "text", max: 50 },
      { name: "quality_control_passed", type: "bool" },
      { name: "quality_control_notes", type: "text", max: 500 },
      { name: "researched_at", type: "date" },
    ],
    indexes: ["CREATE INDEX idx_prospect_research_company ON prospect_research (company)"],
    listRule: "@request.auth.employee.role.is_super_admin = true || @request.auth.employee.role.permissions.key ?= 'acquisition.view'",
    viewRule: "@request.auth.employee.role.is_super_admin = true || @request.auth.employee.role.permissions.key ?= 'acquisition.view'",
    createRule: null,
    updateRule: null,
    deleteRule: "@request.auth.employee.role.is_super_admin = true",
  });
  app.save(research);

  // ---- suppression_list ---------------------------------------------------
  // Checked before EVERY send. Immutable-in-spirit: entries are added, not
  // edited, and never auto-removed.
  const suppression = new Collection({
    type: "base",
    name: "suppression_list",
    fields: [
      { name: "email_normalized", type: "text", required: true, max: 200 },
      { name: "domain", type: "text", max: 150 },
      { name: "reason", type: "select", maxSelect: 1, values: ["unsubscribe", "hard_bounce", "explicit_rejection", "complaint", "manual", "legal_request"] },
      { name: "added_by_employee", type: "relation", collectionId: employees.id, maxSelect: 1 }, // null if added by an automated event
      { name: "notes", type: "text", max: 300 },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_suppression_email ON suppression_list (email_normalized)"],
    listRule: "@request.auth.employee.role.is_super_admin = true || @request.auth.employee.role.permissions.key ?= 'acquisition.view'",
    viewRule: "@request.auth.employee.role.is_super_admin = true || @request.auth.employee.role.permissions.key ?= 'acquisition.view'",
    createRule: "@request.auth.employee.role.is_super_admin = true || @request.auth.employee.role.permissions.key ?= 'acquisition.manage'",
    updateRule: null, // append-only in spirit — no editing an existing suppression reason
    deleteRule: "@request.auth.employee.role.is_super_admin = true",
  });
  app.save(suppression);

  // ---- acquisition_campaigns (per-contact outreach state machine) --------
  const campaigns = new Collection({
    type: "base",
    name: "acquisition_campaigns",
    fields: [
      { name: "contact", type: "relation", required: true, collectionId: contacts.id, maxSelect: 1 },
      { name: "company", type: "relation", required: true, collectionId: companies.id, maxSelect: 1 },
      { name: "campaign_name", type: "text", max: 150 },
      {
        name: "status",
        type: "select",
        required: true,
        maxSelect: 1,
        values: [
          "ready", "initial_sent", "replied", "no_reply",
          "follow_up_1", "follow_up_2", "final_follow_up",
          "qualified", "meeting_booked", "meeting_completed",
          "proposal", "won", "lost", "stopped",
        ],
      },
      { name: "initial_email_sent_at", type: "date" },
      { name: "follow_up_1_at", type: "date" },
      { name: "follow_up_2_at", type: "date" },
      { name: "final_follow_up_at", type: "date" },
      {
        name: "reply_classification",
        type: "select",
        maxSelect: 1,
        values: ["interested", "question", "pricing", "objection", "not_now", "not_interested", "referral", "wrong_person", "unsubscribe", "out_of_office", "other"],
      },
      // Hard stop conditions — once true, no automated follow-up may fire
      // regardless of what status says (enforced in pb_hooks/acquisition.pb.js).
      { name: "suppressed", type: "bool" },
      { name: "stop_reason", type: "select", maxSelect: 1, values: ["replied", "unsubscribed", "hard_bounce", "explicit_rejection", "meeting_booked", "human_takeover", "invalid_contact"] },
      // Sales/commercial outcome fields
      { name: "meeting_date", type: "date" },
      { name: "proposal_status", type: "select", maxSelect: 1, values: ["not_sent", "sent", "accepted", "declined"] },
      { name: "deal_status", type: "select", maxSelect: 1, values: ["open", "won", "lost"] },
      { name: "offer_type", type: "select", maxSelect: 1, values: ["STANDARD_DEFINED_SCOPE", "CUSTOM_AGENTIC_AI", "SETUP_HANDOFF"] },
      { name: "setup_value_cents", type: "number" },
      { name: "monthly_value_cents", type: "number" },
      { name: "usage_value_cents", type: "number" },
      { name: "closed_at", type: "date" },
      { name: "loss_reason", type: "text", max: 300 },
      { name: "converted_agency_lead", type: "relation", collectionId: app.findCollectionByNameOrId("agency_leads").id, maxSelect: 1 },
    ],
    indexes: [
      "CREATE INDEX idx_acq_campaigns_contact ON acquisition_campaigns (contact)",
      "CREATE INDEX idx_acq_campaigns_status ON acquisition_campaigns (status)",
    ],
    listRule: "@request.auth.employee.role.is_super_admin = true || @request.auth.employee.role.permissions.key ?= 'acquisition.view'",
    viewRule: "@request.auth.employee.role.is_super_admin = true || @request.auth.employee.role.permissions.key ?= 'acquisition.view'",
    createRule: null,
    updateRule: null, // state transitions go through pb_hooks/acquisition.pb.js so the reply-stops-followups rule is unbypassable
    deleteRule: "@request.auth.employee.role.is_super_admin = true",
  });
  app.save(campaigns);

  // ---- acquisition_events (real-time event log, section 23 of the spec) --
  const events = new Collection({
    type: "base",
    name: "acquisition_events",
    fields: [
      {
        name: "event_type",
        type: "select",
        required: true,
        maxSelect: 1,
        values: [
          "company_discovered", "research_started", "research_completed", "qualified",
          "contact_found", "contact_verified", "email_generated", "email_approved",
          "email_sent", "email_delivered", "email_bounced", "email_replied",
          "reply_classified", "followup_scheduled", "followup_sent",
          "meeting_booked", "meeting_cancelled", "meeting_completed",
          "deal_won", "deal_lost", "suppression_added",
        ],
      },
      { name: "company", type: "relation", collectionId: companies.id, maxSelect: 1 },
      { name: "contact", type: "relation", collectionId: contacts.id, maxSelect: 1 },
      { name: "campaign", type: "relation", collectionId: campaigns.id, maxSelect: 1 },
      { name: "detail", type: "json" },
      { name: "occurred_at", type: "date", required: true },
    ],
    indexes: [
      "CREATE INDEX idx_acq_events_type ON acquisition_events (event_type)",
      "CREATE INDEX idx_acq_events_occurred ON acquisition_events (occurred_at)",
      "CREATE INDEX idx_acq_events_campaign ON acquisition_events (campaign)",
    ],
    listRule: "@request.auth.employee.role.is_super_admin = true || @request.auth.employee.role.permissions.key ?= 'acquisition.view'",
    viewRule: "@request.auth.employee.role.is_super_admin = true || @request.auth.employee.role.permissions.key ?= 'acquisition.view'",
    createRule: null, // written only by pb_hooks/acquisition.pb.js as part of each ingestion route
    updateRule: null,
    deleteRule: null,
  });
  app.save(events);

  // ---- acquisition_targets (configurable monthly throughput targets) -----
  // Month 1: 3,000 initial emails. Month 2+: 2,000/month (business decision,
  // not hardcoded) — stored here so it can change without a code deploy.
  const targets = new Collection({
    type: "base",
    name: "acquisition_targets",
    fields: [
      { name: "period_label", type: "text", required: true, presentable: true, max: 30 }, // e.g. "2026-09", "Month 1"
      { name: "period_start", type: "date", required: true },
      { name: "period_end", type: "date", required: true },
      { name: "initial_emails_target", type: "number", required: true },
      { name: "new_clients_target", type: "number" },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_acq_targets_period ON acquisition_targets (period_label)"],
    listRule: "@request.auth.employee.role.is_super_admin = true || @request.auth.employee.role.permissions.key ?= 'acquisition.view'",
    viewRule: "@request.auth.employee.role.is_super_admin = true || @request.auth.employee.role.permissions.key ?= 'acquisition.view'",
    createRule: "@request.auth.employee.role.is_super_admin = true || @request.auth.employee.role.permissions.key ?= 'acquisition.manage'",
    updateRule: "@request.auth.employee.role.is_super_admin = true || @request.auth.employee.role.permissions.key ?= 'acquisition.manage'",
    deleteRule: "@request.auth.employee.role.is_super_admin = true",
  });
  app.save(targets);

  // Seed exactly the two targets you specified: Month 1 = 3,000 initial
  // emails / 5 new clients; Month 2 onwards = 2,000/month. Real dates,
  // not placeholders — adjust period_start/end per actual campaign launch.
  const month1Start = new Date();
  month1Start.setDate(1);
  month1Start.setHours(0, 0, 0, 0);
  const month1End = new Date(month1Start);
  month1End.setMonth(month1End.getMonth() + 1);
  const month2Start = new Date(month1End);
  const month2End = new Date(month2Start);
  month2End.setMonth(month2End.getMonth() + 1);

  const m1 = new Record(targets);
  m1.set("period_label", "Month 1");
  m1.set("period_start", month1Start.toISOString());
  m1.set("period_end", month1End.toISOString());
  m1.set("initial_emails_target", 3000);
  m1.set("new_clients_target", 5);
  app.save(m1);

  const m2 = new Record(targets);
  m2.set("period_label", "Month 2");
  m2.set("period_start", month2Start.toISOString());
  m2.set("period_end", month2End.toISOString());
  m2.set("initial_emails_target", 2000);
  app.save(m2);
}, (app) => {
  app.delete(app.findCollectionByNameOrId("acquisition_targets"));
  app.delete(app.findCollectionByNameOrId("acquisition_events"));
  app.delete(app.findCollectionByNameOrId("acquisition_campaigns"));
  app.delete(app.findCollectionByNameOrId("suppression_list"));
  app.delete(app.findCollectionByNameOrId("prospect_research"));
  app.delete(app.findCollectionByNameOrId("prospect_contacts"));
  app.delete(app.findCollectionByNameOrId("prospect_companies"));
});
