/// <reference path="../pb_data/types.d.ts" />
// Prompt 7 & Prompt 15 (Part 3):
// 1. Link or create the initial OS Super Administrator login record in `users`
//    associated with the existing `employees` tester row (tester@synkra.co.za).
// 2. Seed a realistic test Agency Client end-to-end:
//    - Company: Apex Growth Partners
//    - User: client.test@synkra.co.za
//    - Services: Live (ai-voice-agent) and Mid-Onboarding (lead-reactivation)
//    - Implementation reports & service configs (labeled clearly as seed data)

migrate((app) => {
  // =========================================================================
  // 1. OS SUPER ADMIN LOGIN (Prompt 7)
  // =========================================================================
  const usersCol = app.findCollectionByNameOrId("users");
  const employeesCol = app.findCollectionByNameOrId("employees");

  let testerEmp = null;
  try {
    testerEmp = app.findFirstRecordByFilter("employees", "email = 'tester@synkra.co.za'");
  } catch (e) {
    // If not found, look up any Super Admin employee or create for the Super Admin role
    try {
      const superRole = app.findFirstRecordByFilter("roles", "is_super_admin = true");
      if (superRole) {
        testerEmp = new Record(employeesCol);
        testerEmp.set("full_name", "Synkra Administrator");
        testerEmp.set("email", "tester@synkra.co.za");
        testerEmp.set("role", superRole.id);
        testerEmp.set("department", "Executive");
        testerEmp.set("title", "Super Administrator");
        testerEmp.set("status", "active");
        app.save(testerEmp);
      }
    } catch (err) {}
  }

  if (testerEmp) {
    let userRec = null;
    try {
      userRec = app.findFirstRecordByFilter("users", "email = 'tester@synkra.co.za'");
    } catch (e) {
      userRec = new Record(usersCol);
      userRec.set("email", "tester@synkra.co.za");
      userRec.setPassword("SynkraAdmin2026!Secure");
      userRec.set("verified", true);
      userRec.set("emailVisibility", true);
      app.save(userRec);
    }
    if (userRec) {
      testerEmp.set("user", userRec.id);
      app.save(testerEmp);
      userRec.set("employee", testerEmp.id);
      app.save(userRec);
    }
  }

  // =========================================================================
  // 2. SEED REAL TEST AGENCY CLIENT (Prompt 15 Part 3)
  // =========================================================================
  const clientsCol = app.findCollectionByNameOrId("clients");
  const agencyUsersCol = app.findCollectionByNameOrId("agency_client_users");
  const agencyServicesCol = app.findCollectionByNameOrId("agency_client_services");
  const implReportsCol = app.findCollectionByNameOrId("implementation_reports");
  const configsCol = app.findCollectionByNameOrId("agency_service_configs");

  let testClient = null;
  try {
    testClient = app.findFirstRecordByFilter("clients", "company_name = 'Apex Growth Partners'");
  } catch (e) {
    testClient = new Record(clientsCol);
    testClient.set("company_name", "Apex Growth Partners");
    testClient.set("contact_name", "Alex Vance");
    testClient.set("contact_email", "alex.vance@apexgrowth.co.za");
    testClient.set("contact_phone", "+27 82 555 0199");
    testClient.set("billing_mode", "recurring");
    testClient.set("status", "active");
    testClient.set("credit_balance", 1250);
    testClient.set("monthly_credit_allowance", 500);
    app.save(testClient);
  }

  // Portal user login
  let clientUser = null;
  try {
    clientUser = app.findFirstRecordByFilter("agency_client_users", "email = 'client.test@synkra.co.za'");
  } catch (e) {
    clientUser = new Record(agencyUsersCol);
    clientUser.set("email", "client.test@synkra.co.za");
    clientUser.setPassword("SynkraClient2026!Secure");
    clientUser.set("agency_client_id", testClient.id);
    clientUser.set("role", "owner");
    clientUser.set("verified", true);
    clientUser.set("emailVisibility", true);
    app.save(clientUser);
  }

  // Live service (ai-voice-agent)
  let liveSvc = null;
  try {
    liveSvc = app.findFirstRecordByFilter(
      "agency_client_services",
      `agency_client_id = '${testClient.id}' && service_slug = 'ai-voice-agent'`
    );
  } catch (e) {
    liveSvc = new Record(agencyServicesCol);
    liveSvc.set("agency_client_id", testClient.id);
    liveSvc.set("service_slug", "ai-voice-agent");
    liveSvc.set("tier", "pro");
    liveSvc.set("monthly_price", 14900);
    liveSvc.set("setup_price", 25000);
    liveSvc.set("status", "active");
    liveSvc.set("onboarding_status", "active"); // LIVE
    liveSvc.set("pending_change", "none");
    liveSvc.set("current_period_start", new Date().toISOString());
    liveSvc.set("current_period_end", new Date(Date.now() + 30 * 86400000).toISOString());
    liveSvc.set("activated_at", new Date().toISOString());
    app.save(liveSvc);
  }

  // Mid-onboarding service (lead-reactivation)
  let midOnboardingSvc = null;
  try {
    midOnboardingSvc = app.findFirstRecordByFilter(
      "agency_client_services",
      `agency_client_id = '${testClient.id}' && service_slug = 'lead-reactivation'`
    );
  } catch (e) {
    midOnboardingSvc = new Record(agencyServicesCol);
    midOnboardingSvc.set("agency_client_id", testClient.id);
    midOnboardingSvc.set("service_slug", "lead-reactivation");
    midOnboardingSvc.set("tier", "standard");
    midOnboardingSvc.set("monthly_price", 9900);
    midOnboardingSvc.set("setup_price", 18000);
    midOnboardingSvc.set("status", "active");
    midOnboardingSvc.set("onboarding_status", "implementing"); // MID-ONBOARDING
    midOnboardingSvc.set("pending_change", "none");
    midOnboardingSvc.set("current_period_start", new Date().toISOString());
    midOnboardingSvc.set("current_period_end", new Date(Date.now() + 30 * 86400000).toISOString());
    app.save(midOnboardingSvc);
  }

  // Implementation report for live service
  if (liveSvc) {
    try {
      app.findFirstRecordByFilter(
        "implementation_reports",
        `client_id = '${testClient.id}' && service = 'ai-voice-agent'`
      );
    } catch (e) {
      const report = new Record(implReportsCol);
      report.set("client_id", testClient.id);
      report.set("agency_client_service_id", liveSvc.id);
      report.set("service", "ai-voice-agent");
      report.set("status", "ready_for_qc");
      report.set("steps_completed", [
        "Discovery & Intake Analysis Completed",
        "Telephony SIP Trunk Configured",
        "Conversational Prompt & Knowledge Base Tuned",
        "End-to-End Test Calls Executed",
      ]);
      report.set("test_results", {
        avg_latency_ms: 420,
        speech_recognition_accuracy: "98.5%",
        fallback_rate: "1.2%",
        note: "[SEED / TEST DATA] Verified via automated test suite",
      });
      report.set("flags_for_human", []);
      report.set("started_at", new Date(Date.now() - 5 * 86400000).toISOString());
      report.set("completed_at", new Date().toISOString());
      app.save(report);
    }

    // Service config for live service
    try {
      app.findFirstRecordByFilter(
        "agency_service_configs",
        `agency_client_service_id = '${liveSvc.id}'`
      );
    } catch (e) {
      const cfg = new Record(configsCol);
      cfg.set("agency_client_service_id", liveSvc.id);
      cfg.set("config", {
        inbound_number: "+27 10 500 9812",
        voice_model: "ElevenLabs Turbo v2.5",
        transfer_number: "+27 82 555 0199",
        business_hours: "08:00 - 17:00 SAST",
        is_seed_data: true,
      });
      cfg.set("updated_by", "implementation_ai");
      app.save(cfg);
    }
  }
}, (app) => {
  // down-migration
});
