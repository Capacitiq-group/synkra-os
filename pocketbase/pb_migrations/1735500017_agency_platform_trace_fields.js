/// <reference path="../pb_data/types.d.ts" />

// Adds traceability to the REAL Agency PocketBase instance (a separate,
// dedicated PocketBase per ARCHITECTURE.md — NOT this Synkra OS database).
// Synkra OS's own agency_leads models the PRE-SALE pipeline (lead through
// paid quotation); once NO PAYMENT = NO ONBOARDING clears, Synkra OS
// (acting as the "Admin Panel" role in that document) provisions the real
// `clients` + `agency_client_services` records over there — see
// pb_hooks/agency_platform_adapter.pb.js. These two fields retain those
// external IDs, following the same "never invent a duplicate identity,
// always keep the external ID" principle used for Flow.
migrate((app) => {
  const agencyLeads = app.findCollectionByNameOrId("agency_leads");
  agencyLeads.fields.add(new Field({
    name: "agency_platform_client_id",
    type: "text",
    max: 30,
  }));
  agencyLeads.fields.add(new Field({
    name: "agency_platform_service_id",
    type: "text",
    max: 30,
  }));
  app.save(agencyLeads);
}, (app) => {
  const agencyLeads = app.findCollectionByNameOrId("agency_leads");
  const f1 = agencyLeads.fields.getByName("agency_platform_client_id");
  if (f1) agencyLeads.fields.removeById(f1.id);
  const f2 = agencyLeads.fields.getByName("agency_platform_service_id");
  if (f2) agencyLeads.fields.removeById(f2.id);
  app.save(agencyLeads);
});
