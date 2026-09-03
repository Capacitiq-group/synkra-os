/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  const aiEmployees = new Collection({
    type: "base",
    name: "ai_employees",
    fields: [
      { name: "name", type: "text", required: true, presentable: true, max: 100 },
      {
        name: "function",
        type: "select",
        required: true,
        maxSelect: 1,
        values: ["operations", "customer_support", "billing", "finance", "implementation", "technical_support", "sales"],
      },
      { name: "model", type: "text", required: true, max: 100 },
      { name: "status", type: "select", required: true, maxSelect: 1, values: ["active", "paused", "disabled"] },
      // Explicit allow-list, never a boolean "full access" flag.
      { name: "permitted_actions", type: "json" },
      { name: "connected_systems", type: "json" },
      { name: "cost_cents_month", type: "number" },
      { name: "success_rate_pct", type: "number" },
      { name: "escalation_rate_pct", type: "number" },
      { name: "avg_execution_ms", type: "number" },
      { name: "last_active_at", type: "date" },
    ],
    indexes: ["CREATE INDEX idx_ai_employees_function ON ai_employees (function)"],
    listRule: "@request.auth.employee.role.permissions.key ?= 'ai.view' || @request.auth.employee.role.is_super_admin = true",
    viewRule: "@request.auth.employee.role.permissions.key ?= 'ai.view' || @request.auth.employee.role.is_super_admin = true",
    createRule: "@request.auth.employee.role.permissions.key ?= 'ai.configure' || @request.auth.employee.role.is_super_admin = true",
    updateRule: "@request.auth.employee.role.permissions.key ?= 'ai.configure' || @request.auth.employee.role.is_super_admin = true",
    deleteRule: "@request.auth.employee.role.is_super_admin = true",
  });
  app.save(aiEmployees);

  const aiJobs = new Collection({
    type: "base",
    name: "ai_jobs",
    fields: [
      { name: "ai_employee", type: "relation", required: true, collectionId: aiEmployees.id, maxSelect: 1 },
      { name: "task", type: "text", required: true, max: 200 },
      // Loose reference to whatever this job operates on (e.g. a support
      // ticket ID, a customer ID) — kept generic rather than a hard
      // relation because the AI worker contract shouldn't be coupled to
      // one specific target collection.
      { name: "input_reference", type: "text", max: 200 },
      { name: "status", type: "select", required: true, maxSelect: 1, values: ["queued", "running", "succeeded", "failed", "escalated"] },
      { name: "related_ticket", type: "relation", collectionId: app.findCollectionByNameOrId("support_tickets").id, maxSelect: 1 },
      { name: "started_at", type: "date" },
      { name: "finished_at", type: "date" },
      { name: "result", type: "json" },
      { name: "error", type: "text", max: 500 },
      { name: "retry_count", type: "number" },
      // Human-in-the-loop gate: the worker can propose an action, but
      // anything the AI employee's permitted_actions marks as sensitive
      // must be approved by a person before it takes effect. Enforced in
      // pb_hooks/ai_jobs.pb.js, not just displayed.
      { name: "human_review_required", type: "bool" },
      { name: "reviewed_by", type: "relation", collectionId: app.findCollectionByNameOrId("employees").id, maxSelect: 1 },
      { name: "approved", type: "bool" },
      { name: "rejected", type: "bool" },
      { name: "review_notes", type: "text", max: 500 },
      { name: "cost_cents", type: "number" },
    ],
    indexes: [
      "CREATE INDEX idx_ai_jobs_employee ON ai_jobs (ai_employee)",
      "CREATE INDEX idx_ai_jobs_status ON ai_jobs (status)",
      "CREATE INDEX idx_ai_jobs_review ON ai_jobs (human_review_required)",
    ],
    listRule: "@request.auth.employee.role.permissions.key ?= 'ai.view' || @request.auth.employee.role.is_super_admin = true",
    viewRule: "@request.auth.employee.role.permissions.key ?= 'ai.view' || @request.auth.employee.role.is_super_admin = true",
    createRule: null, // written only via /api/ai-jobs/submit (enforces permitted_actions)
    updateRule: null, // written only via /api/ai-jobs/:id/result and /api/ai-jobs/:id/review
    deleteRule: null,
  });
  app.save(aiJobs);
}, (app) => {
  app.delete(app.findCollectionByNameOrId("ai_jobs"));
  app.delete(app.findCollectionByNameOrId("ai_employees"));
});
