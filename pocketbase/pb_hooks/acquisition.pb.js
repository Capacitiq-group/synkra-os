/// <reference path="../pb_data/types.d.ts" />

// ACQUISITION ENGINE INGESTION CONTRACT
//
// Per the spec's architecture, Python bots + AI research agents are a
// SEPARATE project (see the spec's `synkra_outbound/` structure) — they
// are not part of this codebase. This file is the API boundary they call
// into: Synkra OS owns the CRM (memory + state), Python owns discovery/
// orchestration, AI agents own research/copy judgment. Nothing here
// fabricates prospects, research, or send activity — every row is written
// by an authenticated call from that external system.
//
// Configure ACQUISITION_WORKER_API_KEY once the Python project exists.
// Until then, every route below returns 501, matching the same "honest
// boundary, no fake data" pattern used for the AI worker and Flow/Chat.

function requireAcquisitionWorkerAuth(e) {
  const expected = $os.getenv("ACQUISITION_WORKER_API_KEY");
  if (!expected) {
    throw new ApiError(501, "ACQUISITION_WORKER_API_KEY is not configured — the acquisition engine's Python/AI worker project is not connected yet.");
  }
  const provided = e.request.header.get("Authorization");
  if (provided !== `Bearer ${expected}`) {
    throw new ApiError(401, "Invalid or missing acquisition worker credentials.");
  }
}

function normalizeDomain(input) {
  return String(input || "")
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "")
    .trim();
}

function logAcquisitionEvent(app, eventType, { companyId, contactId, campaignId, detail }) {
  const collection = app.findCollectionByNameOrId("acquisition_events");
  const event = new Record(collection);
  event.set("event_type", eventType);
  if (companyId) event.set("company", companyId);
  if (contactId) event.set("contact", contactId);
  if (campaignId) event.set("campaign", campaignId);
  if (detail !== undefined) event.set("detail", detail);
  event.set("occurred_at", new Date().toISOString());
  app.save(event);
}

// ---- Company discovery/dedup ---------------------------------------------
// Rule 1 (no generic mass-email database) is enforced upstream by the
// research pipeline, not here — this route just guarantees ONE canonical
// company record per domain (spec section 8).
routerAdd("POST", "/api/acquisition/companies/ingest", (e) => {
  requireAcquisitionWorkerAuth(e);
  const data = e.requestInfo().body;
  const domain = normalizeDomain(data && data.domain);
  if (!domain || !data.company_name) {
    throw new ApiError(400, "domain and company_name are required.");
  }

  let company = tryFindFirst(e.app, "prospect_companies", "domain = {:domain}", { domain });
  const isNew = !company;
  if (!company) {
    const collection = e.app.findCollectionByNameOrId("prospect_companies");
    company = new Record(collection);
    company.set("domain", domain);
  }
  company.set("company_name", data.company_name);
  if (data.industry) company.set("industry", data.industry);
  if (data.location) company.set("location", data.location);
  if (data.website) company.set("website", data.website);
  if (data.phone) company.set("phone", data.phone);
  if (data.public_email) company.set("public_email", data.public_email);
  if (data.source) company.set("source", data.source);
  if (data.source_urls) company.set("source_urls", data.source_urls);
  if (data.apollo_organization_id) company.set("apollo_organization_id", data.apollo_organization_id);
  company.set("research_status", company.get("research_status") || "discovered");
  e.app.save(company);

  if (isNew) {
    logAcquisitionEvent(e.app, "company_discovered", { companyId: company.id, detail: { source: data.source } });
  }

  return e.json(200, { company_id: company.id, is_new: isNew });
});

// ---- Research dossier -----------------------------------------------------
routerAdd("POST", "/api/acquisition/companies/{id}/research", (e) => {
  requireAcquisitionWorkerAuth(e);
  const data = e.requestInfo().body;
  const company = findOrNotFound(e.app, "prospect_companies", e.request.pathValue("id"), "Company");

  const collection = e.app.findCollectionByNameOrId("prospect_research");
  const dossier = new Record(collection);
  dossier.set("company", company.id);
  if (data.research_summary) dossier.set("research_summary", data.research_summary);
  if (data.observed_signals) dossier.set("observed_signals", data.observed_signals);
  if (data.pain_points) dossier.set("pain_points", data.pain_points);
  if (data.opportunities) dossier.set("opportunities", data.opportunities);
  if (data.evidence) dossier.set("evidence", data.evidence);
  if (data.confidence) dossier.set("confidence", data.confidence);
  if (data.research_agent_version) dossier.set("research_agent_version", data.research_agent_version);
  dossier.set("quality_control_passed", !!data.quality_control_passed);
  if (data.quality_control_notes) dossier.set("quality_control_notes", data.quality_control_notes);
  dossier.set("researched_at", new Date().toISOString());
  e.app.save(dossier);

  if (typeof data.fit_score === "number") company.set("fit_score", data.fit_score);
  if (typeof data.opportunity_score === "number") company.set("opportunity_score", data.opportunity_score);
  if (data.recommended_offer) company.set("recommended_offer", data.recommended_offer);
  // Quality control (spec 9.7) gates "approved_for_outreach" — a dossier
  // that failed QC cannot silently move a company into the send-ready state.
  if (data.research_status && (data.research_status !== "approved_for_outreach" || data.quality_control_passed)) {
    company.set("research_status", data.research_status);
  }
  e.app.save(company);

  logAcquisitionEvent(e.app, data.research_status === "qualified" ? "qualified" : "research_completed", {
    companyId: company.id,
    detail: { fit_score: data.fit_score, recommended_offer: data.recommended_offer },
  });

  return e.json(200, { dossier_id: dossier.id, research_status: company.get("research_status") });
});

// ---- Contact ingestion ------------------------------------------------------
routerAdd("POST", "/api/acquisition/contacts/ingest", (e) => {
  requireAcquisitionWorkerAuth(e);
  const data = e.requestInfo().body;
  if (!data.company_id || !data.name) {
    throw new ApiError(400, "company_id and name are required.");
  }
  findOrNotFound(e.app, "prospect_companies", data.company_id, "Company");

  let contact = data.business_email
    ? tryFindFirst(e.app, "prospect_contacts", "business_email = {:email}", { email: data.business_email })
    : null;
  const isNew = !contact;
  if (!contact) {
    const collection = e.app.findCollectionByNameOrId("prospect_contacts");
    contact = new Record(collection);
    contact.set("company", data.company_id);
  }
  contact.set("name", data.name);
  if (data.job_title) contact.set("job_title", data.job_title);
  if (data.business_email) contact.set("business_email", data.business_email);
  if (data.phone) contact.set("phone", data.phone);
  if (data.source) contact.set("source", data.source);
  if (data.source_url) contact.set("source_url", data.source_url);
  if (data.verification_status) contact.set("verification_status", data.verification_status);
  if (typeof data.contact_confidence === "number") contact.set("contact_confidence", data.contact_confidence);
  e.app.save(contact);

  if (isNew) {
    logAcquisitionEvent(e.app, "contact_found", { companyId: data.company_id, contactId: contact.id });
  }
  if (data.verification_status === "verified") {
    logAcquisitionEvent(e.app, "contact_verified", { companyId: data.company_id, contactId: contact.id });
  }

  return e.json(200, { contact_id: contact.id, is_new: isNew });
});

// ---- Campaign creation ------------------------------------------------------
// Suppression is checked here, at creation, AND again in the event route
// below before every send — belt and braces, since Rule 6/suppression is
// the one mistake that has real legal/reputational cost.
routerAdd("POST", "/api/acquisition/campaigns/create", (e) => {
  requireAcquisitionWorkerAuth(e);
  const data = e.requestInfo().body;
  if (!data.contact_id || !data.company_id) {
    throw new ApiError(400, "contact_id and company_id are required.");
  }
  const contact = findOrNotFound(e.app, "prospect_contacts", data.contact_id, "Contact");
  const company = findOrNotFound(e.app, "prospect_companies", data.company_id, "Company");

  if (company.get("already_contacted")) {
    throw new ApiError(409, "This company has already been contacted — refusing to create a duplicate initial-outreach campaign.");
  }
  if (contact.get("business_email")) {
    const emailNormalized = String(contact.get("business_email")).toLowerCase().trim();
    const suppressed = tryFindFirst(e.app, "suppression_list", "email_normalized = {:email}", { email: emailNormalized });
    if (suppressed) {
      throw new ApiError(403, `This contact is on the suppression list (reason: ${suppressed.get("reason")}). No campaign was created.`);
    }
  }

  const collection = e.app.findCollectionByNameOrId("acquisition_campaigns");
  const campaign = new Record(collection);
  campaign.set("contact", contact.id);
  campaign.set("company", company.id);
  if (data.campaign_name) campaign.set("campaign_name", data.campaign_name);
  campaign.set("status", "ready");
  e.app.save(campaign);

  return e.json(200, { campaign_id: campaign.id });
});

// ---- Campaign events (the state machine) ------------------------------------
// One route for every event type in the spec's real-time event list. This
// is where the hard rules live:
//   - a reply immediately stops automated follow-ups (Rule 6)
//   - unsubscribe/hard_bounce/complaint immediately suppress (never a soft flag)
//   - suppression is re-checked before marking any *_sent event
const STOP_EVENTS = new Set(["email_bounced", "deal_lost"]);
const AUTO_SUPPRESS_ON = {
  email_bounced: "hard_bounce",
};

routerAdd("POST", "/api/acquisition/campaigns/{id}/event", (e) => {
  requireAcquisitionWorkerAuth(e);
  const data = e.requestInfo().body;
  const eventType = data && data.event_type;
  if (!eventType) throw new ApiError(400, "event_type is required.");

  const campaign = findOrNotFound(e.app, "acquisition_campaigns", e.request.pathValue("id"), "Campaign");
  const contact = findOrNotFound(e.app, "prospect_contacts", campaign.get("contact"), "Contact");

  if (campaign.get("suppressed") && ["email_sent", "followup_sent"].includes(eventType)) {
    throw new ApiError(403, "This campaign is suppressed. No send may proceed regardless of what the caller requests.");
  }

  const nowIso = new Date().toISOString();

  switch (eventType) {
    case "email_sent":
      campaign.set("status", "initial_sent");
      campaign.set("initial_email_sent_at", nowIso);
      campaign.set("company", campaign.get("company"));
      // Mark the company as contacted the moment the initial send happens —
      // this is the dedup guard against re-entering the outreach queue.
      {
        const company = findOrNotFound(e.app, "prospect_companies", campaign.get("company"), "Company");
        company.set("already_contacted", true);
        e.app.save(company);
      }
      break;
    case "followup_sent": {
      const followUpStage = data.follow_up_stage; // "follow_up_1" | "follow_up_2" | "final_follow_up"
      if (followUpStage) {
        campaign.set("status", followUpStage);
        campaign.set(`${followUpStage}_at`, nowIso);
      }
      break;
    }
    case "email_replied":
      // Rule 6: a reply stops automated follow-ups, unconditionally.
      campaign.set("status", "replied");
      campaign.set("suppressed", false); // a reply is not suppression — human/reply-agent takes over
      break;
    case "reply_classified":
      if (data.classification) campaign.set("reply_classification", data.classification);
      if (data.classification === "unsubscribe") {
        campaign.set("suppressed", true);
        campaign.set("stop_reason", "unsubscribed");
        addToSuppressionList(e.app, contact, "unsubscribe");
      } else if (data.classification === "not_interested") {
        campaign.set("suppressed", true);
        campaign.set("stop_reason", "explicit_rejection");
      } else if (data.classification === "interested") {
        campaign.set("status", "qualified");
      }
      break;
    case "meeting_booked":
      campaign.set("status", "meeting_booked");
      campaign.set("suppressed", true);
      campaign.set("stop_reason", "meeting_booked");
      if (data.meeting_date) campaign.set("meeting_date", data.meeting_date);
      break;
    case "meeting_completed":
      campaign.set("status", "meeting_completed");
      break;
    case "deal_won":
      campaign.set("status", "won");
      campaign.set("deal_status", "won");
      campaign.set("closed_at", nowIso);
      if (data.offer_type) campaign.set("offer_type", data.offer_type);
      if (typeof data.setup_value_cents === "number") campaign.set("setup_value_cents", data.setup_value_cents);
      if (typeof data.monthly_value_cents === "number") campaign.set("monthly_value_cents", data.monthly_value_cents);
      break;
    case "deal_lost":
      campaign.set("status", "lost");
      campaign.set("deal_status", "lost");
      campaign.set("closed_at", nowIso);
      if (data.loss_reason) campaign.set("loss_reason", data.loss_reason);
      break;
    case "email_bounced":
      addToSuppressionList(e.app, contact, "hard_bounce");
      campaign.set("suppressed", true);
      campaign.set("stop_reason", "hard_bounce");
      break;
    default:
      // email_delivered, followup_scheduled, etc. — logged without a
      // dedicated state transition.
      break;
  }
  e.app.save(campaign);

  logAcquisitionEvent(e.app, eventType, {
    companyId: campaign.get("company"),
    contactId: campaign.get("contact"),
    campaignId: campaign.id,
    detail: data.detail,
  });

  return e.json(200, { success: true, status: campaign.get("status"), suppressed: campaign.get("suppressed") });
});

function addToSuppressionList(app, contact, reason) {
  const email = contact.get("business_email");
  if (!email) return;
  const emailNormalized = String(email).toLowerCase().trim();
  const existing = tryFindFirst(app, "suppression_list", "email_normalized = {:email}", { email: emailNormalized });
  if (existing) return;
  const collection = app.findCollectionByNameOrId("suppression_list");
  const row = new Record(collection);
  row.set("email_normalized", emailNormalized);
  row.set("reason", reason);
  app.save(row);
  logAcquisitionEvent(app, "suppression_added", { detail: { email: emailNormalized, reason } });
}

// ---- Pull-query routes (Python workers read these to find work) -----------
// Everything above is push (ingest/report an event). Without these, the
// Python side has no way to ask "what should I work on next?" — a real
// gap, closed here rather than left for the worker to guess at.

routerAdd("GET", "/api/acquisition/companies/needs-research", (e) => {
  requireAcquisitionWorkerAuth(e);
  const limit = Math.min(parseInt(e.request.url.query().get("limit") || "50", 10) || 50, 200);
  let companies = [];
  try {
    companies = e.app.findRecordsByFilter(
      "prospect_companies",
      "research_status = 'discovered' || research_status = 'researching'",
      "-created",
      limit,
      0
    );
  } catch (err) {
    return e.json(200, { items: [] });
  }
  const items = companies.map((c) => ({
    id: c.id,
    company_name: c.get("company_name"),
    domain: c.get("domain"),
    website: c.get("website"),
  }));
  return e.json(200, { items });
});

routerAdd("GET", "/api/acquisition/companies/ready-for-outreach", (e) => {  requireAcquisitionWorkerAuth(e);
  const limit = Math.min(parseInt(e.request.url.query().get("limit") || "50", 10) || 50, 200);
  let companies = [];
  try {
    companies = e.app.findRecordsByFilter(
      "prospect_companies",
      "research_status = 'approved_for_outreach' && (already_contacted = false || already_contacted = null)",
      "-created",
      limit,
      0
    );
  } catch (err) {
    return e.json(200, { items: [] });
  }

  const items = companies.map((company) => {
    let contact = null;
    try {
      contact = e.app.findFirstRecordByFilter(
        "prospect_contacts",
        "company = {:company} && verification_status = 'verified'",
        { company: company.id }
      );
    } catch (err) {
      try {
        contact = e.app.findFirstRecordByFilter("prospect_contacts", "company = {:company}", { company: company.id });
      } catch (err2) {
        contact = null;
      }
    }
    let dossier = null;
    try {
      dossier = e.app.findFirstRecordByFilter("prospect_research", "company = {:company}", { company: company.id });
    } catch (err) {
      dossier = null;
    }
    return {
      company_id: company.id,
      company_name: company.get("company_name"),
      domain: company.get("domain"),
      recommended_offer: company.get("recommended_offer"),
      contact_id: contact ? contact.id : null,
      contact_name: contact ? contact.get("name") : null,
      business_email: contact ? contact.get("business_email") : null,
      evidence: dossier ? dossier.get("evidence") : [],
      opportunities: dossier ? dossier.get("opportunities") : [],
      solution_summary: dossier ? dossier.get("research_summary") : null,
    };
  }).filter((item) => !!item.business_email); // nothing usable to contact without an email

  return e.json(200, { items });
});

routerAdd("GET", "/api/acquisition/campaigns/active", (e) => {
  requireAcquisitionWorkerAuth(e);
  const limit = Math.min(parseInt(e.request.url.query().get("limit") || "100", 10) || 100, 500);
  let campaigns = [];
  try {
    campaigns = e.app.findRecordsByFilter(
      "acquisition_campaigns",
      "suppressed = false && status != 'won' && status != 'lost' && status != 'stopped'",
      "-created",
      limit,
      0
    );
  } catch (err) {
    return e.json(200, { items: [] });
  }

  const items = campaigns.map((campaign) => {
    let contact = null;
    let company = null;
    try {
      contact = e.app.findRecordById("prospect_contacts", campaign.get("contact"));
    } catch (err) { /* contact may have been removed */ }
    try {
      company = e.app.findRecordById("prospect_companies", campaign.get("company"));
    } catch (err) { /* company may have been removed */ }
    return {
      campaign_id: campaign.id,
      status: campaign.get("status"),
      initial_email_sent_at: campaign.get("initial_email_sent_at"),
      follow_up_1_at: campaign.get("follow_up_1_at"),
      follow_up_2_at: campaign.get("follow_up_2_at"),
      business_email: contact ? contact.get("business_email") : null,
      company_name: company ? company.get("company_name") : null,
    };
  }).filter((item) => !!item.business_email);

  return e.json(200, { items });
});


routerAdd("GET", "/api/acquisition/suppression/check", (e) => {
  requireAcquisitionWorkerAuth(e);
  const email = e.request.url.query().get("email");
  if (!email) throw new ApiError(400, "email query param is required.");
  const emailNormalized = email.toLowerCase().trim();
  const suppressed = tryFindFirst(e.app, "suppression_list", "email_normalized = {:email}", { email: emailNormalized });
  return e.json(200, { suppressed: !!suppressed, reason: suppressed ? suppressed.get("reason") : null });
});

// ---- Manual suppression (a human adds someone, e.g. a phone opt-out) --------
routerAdd("POST", "/api/acquisition/suppression/add", (e) => {
  const employee = requirePermission(e, "acquisition.manage");
  const data = e.requestInfo().body;
  const email = data && data.email;
  if (!email) throw new ApiError(400, "email is required.");
  const emailNormalized = email.toLowerCase().trim();

  const existing = tryFindFirst(e.app, "suppression_list", "email_normalized = {:email}", { email: emailNormalized });
  if (existing) return e.json(200, { success: true, already_suppressed: true });

  const collection = e.app.findCollectionByNameOrId("suppression_list");
  const row = new Record(collection);
  row.set("email_normalized", emailNormalized);
  row.set("reason", (data && data.reason) || "manual");
  row.set("added_by_employee", employee.id);
  if (data.notes) row.set("notes", data.notes);
  e.app.save(row);

  writeAuditLog(e.app, {
    actorEmployeeId: employee.id,
    action: "acquisition.suppression_added",
    affectedCollection: "suppression_list",
    affectedRecordId: row.id,
    reason: data.notes || undefined,
  });

  logAcquisitionEvent(e.app, "suppression_added", { detail: { email: emailNormalized, reason: (data && data.reason) || "manual" } });

  return e.json(200, { success: true });
});

// ---- Dashboard aggregation ---------------------------------------------------
routerAdd("GET", "/api/acquisition/dashboard", (e) => {
  requirePermission(e, "acquisition.view");
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const todayIso = startOfToday.toISOString();

  // NOTE: capped at 5,000 rows per count — comfortably above the Month 1/2
  // targets (3,000 / 2,000 total), but if volume grows past that this
  // should move to a real COUNT query instead of counting a fetched page.
  function countViaCollection(filter) {
    try {
      return e.app.findRecordsByFilter("acquisition_events", filter, "-occurred_at", 5000, 0).length;
    } catch {
      return 0;
    }
  }

  const daily = {
    companies_discovered: countViaCollection(`event_type = "company_discovered" && occurred_at >= "${todayIso}"`),
    contacts_found: countViaCollection(`event_type = "contact_found" && occurred_at >= "${todayIso}"`),
    contacts_verified: countViaCollection(`event_type = "contact_verified" && occurred_at >= "${todayIso}"`),
    initial_emails_sent: countViaCollection(`event_type = "email_sent" && occurred_at >= "${todayIso}"`),
    followups_sent: countViaCollection(`event_type = "followup_sent" && occurred_at >= "${todayIso}"`),
    replies: countViaCollection(`event_type = "email_replied" && occurred_at >= "${todayIso}"`),
    meetings_booked: countViaCollection(`event_type = "meeting_booked" && occurred_at >= "${todayIso}"`),
    deals_won: countViaCollection(`event_type = "deal_won" && occurred_at >= "${todayIso}"`),
  };

  let targets = [];
  try {
    targets = e.app.findRecordsByFilter("acquisition_targets", "", "period_start", 20, 0);
  } catch {
    targets = [];
  }
  const now = new Date().toISOString();
  const currentTarget = targets.find((t) => t.get("period_start") <= now && t.get("period_end") > now);

  let periodInitialSent = 0;
  let periodNewClients = 0;
  if (currentTarget) {
    periodInitialSent = countViaCollection(
      `event_type = "email_sent" && occurred_at >= "${currentTarget.get("period_start")}" && occurred_at < "${currentTarget.get("period_end")}"`
    );
    periodNewClients = countViaCollection(
      `event_type = "deal_won" && occurred_at >= "${currentTarget.get("period_start")}" && occurred_at < "${currentTarget.get("period_end")}"`
    );
  }

  return e.json(200, {
    daily,
    current_period: currentTarget
      ? {
          label: currentTarget.get("period_label"),
          initial_emails_target: currentTarget.get("initial_emails_target"),
          initial_emails_sent: periodInitialSent,
          new_clients_target: currentTarget.get("new_clients_target"),
          new_clients: periodNewClients,
        }
      : null,
  });
});
