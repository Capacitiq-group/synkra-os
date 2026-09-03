/// <reference path="../pb_data/types.d.ts" />

// Real pricing from AGENCY-SERVICES-DOCUMENTATION.md — not placeholders.
// Stored in Rand (not cents) deliberately: the real Agency PocketBase's
// own agency_payments collection uses `amount_rand`, so Rand is that
// system's house style for money fields — matching it here avoids a unit
// mismatch at the boundary in agency_platform_adapter.pb.js.
migrate((app) => {
  const pricing = new Collection({
    type: "base",
    name: "agency_service_pricing",
    fields: [
      {
        name: "service_slug",
        type: "select",
        required: true,
        maxSelect: 1,
        values: ["ai_voice_agent", "speed_to_lead", "lead_reactivation", "custom_ai_systems"],
      },
      {
        name: "tier",
        type: "select",
        required: true,
        maxSelect: 1,
        values: ["standard", "growth", "advanced"],
      },
      { name: "monthly_price_rand", type: "number", required: true },
      { name: "setup_price_rand", type: "number", required: true },
      { name: "included_allowance_note", type: "text", max: 200 },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_agency_pricing_slug_tier ON agency_service_pricing (service_slug, tier)"],
    listRule: "@request.auth.id != ''", // reference data, not sensitive — any authenticated employee can see rates
    viewRule: "@request.auth.id != ''",
    createRule: "@request.auth.employee.role.is_super_admin = true",
    updateRule: "@request.auth.employee.role.is_super_admin = true",
    deleteRule: "@request.auth.employee.role.is_super_admin = true",
  });
  app.save(pricing);

  const rows = [
    ["ai_voice_agent", "standard", 700, 2500, "100 min included, R5/min extra"],
    ["ai_voice_agent", "growth", 1500, 4500, "250 min included, R5/min extra"],
    ["ai_voice_agent", "advanced", 2500, 7000, "500 min included, R5/min extra"],

    ["speed_to_lead", "standard", 700, 3000, "100 min included, R5/min extra, 1 lead source"],
    ["speed_to_lead", "growth", 1500, 5000, "250 min included, R5/min extra, multiple lead sources"],
    ["speed_to_lead", "advanced", 2500, 7000, "500 min included, R5/min extra, more sources"],

    ["lead_reactivation", "standard", 800, 3500, "10,000 emails/mo, 500 AI personalization ops"],
    ["lead_reactivation", "growth", 1800, 5500, "25,000 emails/mo, 1,500 AI personalization ops"],
    ["lead_reactivation", "advanced", 3000, 8000, "50,000 emails/mo, 3,500 AI personalization ops"],

    ["custom_ai_systems", "standard", 1500, 5000, "1 AI employee, up to 4 integrations, up to 5 workflows (Essential tier)"],
    ["custom_ai_systems", "growth", 2500, 9000, "1 AI employee, up to 8 integrations, up to 15 workflows"],
    ["custom_ai_systems", "advanced", 4000, 15000, "1 AI employee, 12+ integrations, 30+ workflows (setup from R15,000+)"],
  ];
  for (const [service_slug, tier, monthly_price_rand, setup_price_rand, included_allowance_note] of rows) {
    const r = new Record(pricing);
    r.set("service_slug", service_slug);
    r.set("tier", tier);
    r.set("monthly_price_rand", monthly_price_rand);
    r.set("setup_price_rand", setup_price_rand);
    r.set("included_allowance_note", included_allowance_note);
    app.save(r);
  }
}, (app) => {
  app.delete(app.findCollectionByNameOrId("agency_service_pricing"));
});
