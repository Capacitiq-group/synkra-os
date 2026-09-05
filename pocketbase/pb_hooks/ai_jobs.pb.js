/// <reference path="../pb_data/types.d.ts" />

// Actions no AI employee may ever be granted, regardless of what its
// permitted_actions field says. This is enforced here in code — a
// misconfigured permitted_actions list cannot override it. Mirrors the
// spec's explicit list: no refunds, no ownership changes, no account
// deletion, no unauthorized subscription changes, no impersonation, no
// cross-customer access, no credential exposure, no arbitrary admin
// actions. Expressed using the same permission-key vocabulary as the rest
// of the app so it's auditable against one source of truth.
const AI_GLOBAL_DENYLIST = new Set([
  "billing.refund",
  "billing.modify",
  "customers.impersonate",
  "employees.manage",
  "permissions.manage",
  "infrastructure.restart",
  "deployments.execute",
  "ai.configure",
]);

// Actions an AI employee CAN be granted, but which always require a human
// to approve the specific job before it's considered actionable — even if
// the AI employee's role would otherwise permit it. Conservative default:
// anything that changes a customer-facing record.
const ALWAYS_REQUIRES_REVIEW = new Set([
  "customers.edit",
  "support.manage",
]);

function actionIsAllowed(aiEmployee, action) {
  if (AI_GLOBAL_DENYLIST.has(action)) return false;
  const permitted = aiEmployee.get("permitted_actions") || [];
  return Array.isArray(permitted) && permitted.includes(action);
}

// Submitted by an authenticated employee (or a scheduled internal trigger)
// to queue work for an AI employee — this is how a job gets created, not
// a direct ai_jobs.create() call (createRule is null on that collection).
routerAdd("POST", "/api/ai-jobs/submit", (e) => {
  requirePermission(e, "ai.view");
  const data = e.requestInfo().body;
  const aiEmployeeId = data && data.ai_employee_id;
  const task = data && data.task;
  const action = data && data.action; // the permission-style key this task maps to
  const inputReference = data && data.input_reference;

  if (!aiEmployeeId || !task || !action) {
    throw new ApiError(400, "ai_employee_id, task, and action are required.");
  }

  const aiEmployee = findOrNotFound(e.app, "ai_employees", aiEmployeeId, "AI employee");
  if (aiEmployee.get("status") !== "active") {
    throw new ApiError(409, "This AI employee is not active.");
  }
  if (!actionIsAllowed(aiEmployee, action)) {
    throw new ApiError(403, `Action "${action}" is not permitted for this AI employee. AI employees can never be granted denylisted actions (refunds, impersonation, employee/permission management, infrastructure/deployment control), regardless of configuration.`);
  }

  const collection = e.app.findCollectionByNameOrId("ai_jobs");
  const job = new Record(collection);
  job.set("ai_employee", aiEmployee.id);
  job.set("task", task);
  if (inputReference) job.set("input_reference", inputReference);
  job.set("status", "queued");
  job.set("retry_count", 0);
  job.set("human_review_required", ALWAYS_REQUIRES_REVIEW.has(action));
  e.app.save(job);

  return e.json(200, { job_id: job.id, human_review_required: job.get("human_review_required") });
});

// Called by the Python worker to report back a result. Authenticated with
// a static bearer token rather than an employee session — the worker is a
// service, not a person. Each internal AI employee has its OWN token
// (Prompt 8: one credential per consumer, never shared):
//
//   AI_WORKER_API_KEY_CUSTOMER_SUPPORT -> internal_employees/customer_support
//   AI_WORKER_API_KEY_FINANCE_BILLING  -> internal_employees/finance_billing
//
// The old shared AI_WORKER_API_KEY has been retired. If no token is
// configured at all the route is disabled entirely rather than silently
// accepting unauthenticated writes.
const WORKER_TOKEN_ENV_BY_SLUG = {
  customer_support: "AI_WORKER_API_KEY_CUSTOMER_SUPPORT",
  finance_billing: "AI_WORKER_API_KEY_FINANCE_BILLING",
};

// ai_employees.function is a fixed select list ("customer_support",
// "billing", "finance", ...) that does not contain "finance_billing", so
// each worker slug declares which employee functions/names it owns.
const WORKER_SLUG_ALIASES = {
  customer_support: ["customer_support", "support", "customer_support_ai"],
  finance_billing: ["finance_billing", "finance", "billing", "finance_billing_ai"],
};

// "Finance & Billing" -> "finance_billing". ai_employees has no slug
// column, so identity comes from `function` (falling back to `name`).
function slugifyEmployee(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

// Returns the employee slug the presented token belongs to.
function requireWorkerAuth(e) {
  const provided = e.request.header.get("Authorization");
  let configured = 0;

  for (const slug of Object.keys(WORKER_TOKEN_ENV_BY_SLUG)) {
    const value = $os.getenv(WORKER_TOKEN_ENV_BY_SLUG[slug]);
    if (!value) continue;
    configured++;
    if (provided === `Bearer ${value}`) return slug;
  }

  if (configured === 0) {
    throw new ApiError(501, "No AI worker token is configured (AI_WORKER_API_KEY_CUSTOMER_SUPPORT / AI_WORKER_API_KEY_FINANCE_BILLING) — the Python AI worker integration boundary is not connected.");
  }
  throw new ApiError(401, "Invalid or missing worker credentials.");
}

routerAdd("POST", "/api/ai-jobs/{id}/result", (e) => {
  const workerSlug = requireWorkerAuth(e);
  const data = e.requestInfo().body;
  const job = findOrNotFound(e.app, "ai_jobs", e.request.pathValue("id"), "AI job");

  // A per-employee token may only report results for its own employee's jobs.
  const owner = tryFindFirst(e.app, "ai_employees", "id = {:id}", { id: job.get("ai_employee") });
  const ownerSlug = owner ? slugifyEmployee(owner.get("function") || owner.get("name") || "") : "";
  const owned = WORKER_SLUG_ALIASES[workerSlug] || [workerSlug];
  if (ownerSlug && owned.indexOf(ownerSlug) === -1) {
    throw new ApiError(403, "This worker token is scoped to a different AI employee.");
  }

  const status = data && data.status; // "succeeded" | "failed" | "escalated"
  if (!["succeeded", "failed", "escalated"].includes(status)) {
    throw new ApiError(400, "status must be succeeded, failed, or escalated.");
  }

  job.set("finished_at", new Date().toISOString());
  if (data.result !== undefined) job.set("result", data.result);
  if (data.error) job.set("error", data.error);
  if (typeof data.cost_cents === "number") job.set("cost_cents", data.cost_cents);

  // Even a "succeeded" result from the worker does not bypass a pending
  // human-review requirement — the job sits at "escalated" until a human
  // approves it via /api/ai-jobs/:id/review.
  if (status === "succeeded" && job.get("human_review_required") && !job.get("approved")) {
    job.set("status", "escalated");
  } else {
    job.set("status", status);
  }
  e.app.save(job);

  return e.json(200, { success: true, status: job.get("status") });
});

// A human clears (or rejects) a job that required review. This is the
// ONLY place approval happens — the worker cannot self-approve, and
// approving here does not itself execute anything: any actual mutation
// (a refund, an account change) still has to go through that module's own
// permissioned, audited route. This route only records the human decision.
routerAdd("POST", "/api/ai-jobs/{id}/review", (e) => {
  const employee = requirePermission(e, "ai.approve");
  const data = e.requestInfo().body;
  const decision = data && data.decision; // "approve" | "reject"
  if (!["approve", "reject"].includes(decision)) {
    throw new ApiError(400, "decision must be approve or reject.");
  }

  const job = findOrNotFound(e.app, "ai_jobs", e.request.pathValue("id"), "AI job");
  if (!job.get("human_review_required")) {
    throw new ApiError(409, "This job was never flagged for human review.");
  }

  runAudited(
    e.app,
    (txApp) => {
      job.set("reviewed_by", employee.id);
      job.set("approved", decision === "approve");
      job.set("rejected", decision === "reject");
      job.set("review_notes", (data && data.notes) || "");
      job.set("status", decision === "approve" ? "succeeded" : "failed");
      txApp.save(job);
    },
    {
      actorEmployeeId: employee.id,
      action: `ai_job.${decision}`,
      affectedCollection: "ai_jobs",
      affectedRecordId: job.id,
      reason: (data && data.notes) || undefined,
    }
  );

  return e.json(200, { success: true, status: job.get("status") });
});
