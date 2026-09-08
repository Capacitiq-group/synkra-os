/// <reference path="../pb_data/types.d.ts" />

// customers and ai_jobs were created without explicit created/updated
// fields. On PocketBase 0.23+, these are optional autodate fields, not
// implicit system columns — a collection created without them genuinely
// has no created/updated column at all, so any request sorting by
// "-created" fails with "invalid sort field \"created\"".
//
// Confirmed via production logs (Synkra OS PocketBase Logs, 2026-09-08):
// GET /api/collections/customers/records?...&sort=-created and
// GET /api/collections/ai_jobs/records?...&sort=-created both returned
// status 400 with exactly that error.
//
// NOTE: this same gap likely exists on other collections in this schema
// too (no migration file in this repo defines an autodate field anywhere)
// — this migration deliberately fixes only the two collections confirmed
// broken in production, not a blanket sweep.
migrate((app) => {
  const customers = app.findCollectionByNameOrId("customers");
  customers.fields.add(new Field({ name: "created", type: "autodate", onCreate: true }));
  customers.fields.add(new Field({ name: "updated", type: "autodate", onCreate: true, onUpdate: true }));
  app.save(customers);

  const aiJobs = app.findCollectionByNameOrId("ai_jobs");
  aiJobs.fields.add(new Field({ name: "created", type: "autodate", onCreate: true }));
  aiJobs.fields.add(new Field({ name: "updated", type: "autodate", onCreate: true, onUpdate: true }));
  app.save(aiJobs);
}, (app) => {
  const customers = app.findCollectionByNameOrId("customers");
  ["created", "updated"].forEach((name) => {
    const field = customers.fields.getByName(name);
    if (field) customers.fields.removeById(field.id);
  });
  app.save(customers);

  const aiJobs = app.findCollectionByNameOrId("ai_jobs");
  ["created", "updated"].forEach((name) => {
    const field = aiJobs.fields.getByName(name);
    if (field) aiJobs.fields.removeById(field.id);
  });
  app.save(aiJobs);
});
