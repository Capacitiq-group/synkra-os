/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  const agencyLeads = app.findCollectionByNameOrId("agency_leads");
  agencyLeads.fields.add(new Field({
    name: "tier",
    type: "select",
    maxSelect: 1,
    values: ["standard", "growth", "advanced"],
  }));
  app.save(agencyLeads);
}, (app) => {
  const agencyLeads = app.findCollectionByNameOrId("agency_leads");
  const field = agencyLeads.fields.getByName("tier");
  if (field) agencyLeads.fields.removeById(field.id);
  app.save(agencyLeads);
});
