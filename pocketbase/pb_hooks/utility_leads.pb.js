/// <reference path="../pb_data/types.d.ts" />

// Public endpoint — utilities must stay usable without an account. This is
// the ONLY way a utility_leads row is created; the collection itself has
// createRule: null so nothing can bypass the normalization/dedupe/consent
// rules below.
routerAdd("POST", "/api/utility-leads/capture", (e) => {
  const data = e.requestInfo().body;
  const email = data && data.email;
  const utilitySlug = data && data.utility_slug;
  // Must be an explicit, separate opt-in — never implied by submitting the
  // form to get a result, and never defaulted to true.
  const marketingConsent = data && data.marketing_consent === true;

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ApiError(400, "A valid email is required.");
  }

  const emailNormalized = email.trim().toLowerCase();
  const utility = utilitySlug
    ? tryFindFirst(e.app, "utilities", "slug = {:slug}", { slug: utilitySlug })
    : null;

  let lead = tryFindFirst(
    e.app,
    "utility_leads",
    "email_normalized = {:email}",
    { email: emailNormalized }
  );

  const nowIso = new Date().toISOString();

  if (!lead) {
    const collection = e.app.findCollectionByNameOrId("utility_leads");
    lead = new Record(collection);
    lead.set("email", email);
    lead.set("email_normalized", emailNormalized);
    if (data.name) lead.set("name", data.name);
    if (utility) lead.set("source_utility", utility.id);
    lead.set("marketing_consent", marketingConsent);
    if (marketingConsent) lead.set("marketing_consent_at", nowIso);
    e.app.save(lead);
  } else if (marketingConsent && !lead.get("marketing_consent")) {
    // Consent can be added later (e.g. they check the box on a second
    // visit) but is never silently flipped without this explicit call.
    lead.set("marketing_consent", true);
    lead.set("marketing_consent_at", nowIso);
    e.app.save(lead);
  }

  return e.json(200, { lead_id: lead.id, marketing_consent: lead.get("marketing_consent") });
});

// Consent withdrawal must be just as easy as opting in.
routerAdd("POST", "/api/utility-leads/withdraw-consent", (e) => {
  const data = e.requestInfo().body;
  const email = data && data.email;
  if (!email) throw new ApiError(400, "email is required.");

  const emailNormalized = email.trim().toLowerCase();
  const lead = tryFindFirst(
    e.app,
    "utility_leads",
    "email_normalized = {:email}",
    { email: emailNormalized }
  );
  if (!lead) {
    return e.json(200, { success: true }); // nothing to withdraw; don't leak existence either way
  }

  lead.set("marketing_consent", false);
  lead.set("marketing_consent_withdrawn_at", new Date().toISOString());
  e.app.save(lead);

  return e.json(200, { success: true });
});

// Anonymous usage events (no email) — separate concept from a lead.
routerAdd("POST", "/api/utility-events/record", (e) => {
  const data = e.requestInfo().body;
  const utilitySlug = data && data.utility_slug;
  if (!utilitySlug) throw new ApiError(400, "utility_slug is required.");

  const utility = tryFindFirst(e.app, "utilities", "slug = {:slug}", { slug: utilitySlug });
  if (!utility) throw new ApiError(404, "Unknown utility.");

  const collection = e.app.findCollectionByNameOrId("utility_events");
  const event = new Record(collection);
  event.set("utility", utility.id);
  event.set("outcome", data.outcome === "failure" ? "failure" : "success");
  if (data.anonymous_session_id) event.set("anonymous_session_id", data.anonymous_session_id);
  if (data.utility_lead_id) event.set("utility_lead", data.utility_lead_id);
  if (typeof data.processing_ms === "number") event.set("processing_ms", data.processing_ms);
  if (data.error_code) event.set("error_code", data.error_code);
  event.set("occurred_at", new Date().toISOString());
  e.app.save(event);

  return e.json(200, { success: true });
});
