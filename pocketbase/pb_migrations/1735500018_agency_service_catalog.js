/// <reference path="../pb_data/types.d.ts" />

// Closes a known gap flagged in pb_hooks/agency_platform_adapter.pb.js:
// the provisioning bridge had no real service to assign an
// agency_client_services record to (it defaulted to "unassigned"). These
// four slugs are Synkra's actual real service catalog, from the live
// website (Services section) — not invented.
migrate((app) => {
  const agencyLeads = app.findCollectionByNameOrId("agency_leads");
  agencyLeads.fields.add(new Field({
    name: "service_slug",
    type: "select",
    maxSelect: 1,
    values: ["ai_voice_agent", "speed_to_lead", "lead_reactivation", "custom_ai_systems"],
  }));
  app.save(agencyLeads);
}, (app) => {
  const agencyLeads = app.findCollectionByNameOrId("agency_leads");
  const field = agencyLeads.fields.getByName("service_slug");
  if (field) agencyLeads.fields.removeById(field.id);
  app.save(agencyLeads);
});
