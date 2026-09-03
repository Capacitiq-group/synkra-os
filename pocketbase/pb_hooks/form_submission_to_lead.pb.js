/// <reference path="../pb_data/types.d.ts" />

// Bridges Website's form_submissions into the canonical leads pipeline.
// form_submissions stays Website's own triage inbox (status: new/read/
// archived/converted) — this hook does not replace it, it mirrors each
// new submission into `leads` so it's visible in the same Growth/CRM
// pipeline as every other lead source, per the original brief's §4.

const FORM_TYPE_TO_LEAD_SOURCE = {
  contact: "website_contact",
  talk_to_us: "website_talk_to_us",
  partner_agency: "partner_agency_application",
  partner_referral: "partner_referral_application",
};

onRecordAfterCreateSuccess((e) => {
  const submission = e.record;
  const formType = submission.get("form_type");
  const source = FORM_TYPE_TO_LEAD_SOURCE[formType] || "other";

  const leadsCollection = e.app.findCollectionByNameOrId("leads");
  const lead = new Record(leadsCollection);
  lead.set("lead_code", `LEAD-${submission.id.slice(0, 8).toUpperCase()}`);
  lead.set("name", submission.get("name") || "Unknown");
  lead.set("company", submission.get("company") || "");
  lead.set("email", submission.get("email") || "");
  lead.set("phone", submission.get("phone") || "");
  lead.set("source", source);
  lead.set("source_detail", `Website form submission (${formType}), id ${submission.id}`);
  lead.set("lead_type", formType.startsWith("partner") ? "partnership" : "product");
  lead.set("status", "new");
  e.app.save(lead);

  e.next();
}, "form_submissions");
