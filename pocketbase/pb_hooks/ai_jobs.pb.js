/// <reference path="../pb_data/types.d.ts" />

// AI JOBS
//
// Shared cross-file helpers (requirePermission, findOrNotFound, runAudited,
// ApiError, tryFindFirst) live in ./shared.js. File-specific logic
// (denylist, review rules, worker-token auth) lives in ./ai_jobs_lib.js.
// Both required from INSIDE each handler body — PocketBase serializes and
// executes every routerAdd handler in its own isolated context with no
// access to anything declared outside itself, even in the same file:
// https://pocketbase.io/docs/js-overview/#handlers-scope

// Submitted by an authenticated employee (or a scheduled internal trigger)
// to queue work for an AI employee.
routerAdd("POST", "/api/ai-jobs/submit", (e) => {
  const shared = require(`${__hooks}/shared.js`);
  const lib = require(`${__hooks}/ai_jobs_lib.js`);

  shared.requirePermission(e, "ai.view");
  const data = e.requestInfo().body;
  const aiEmployeeId = data && data.ai_employee_id;
  const task = data && data.task;
  const action = data && data.action;
  const inputReference = data && data.input_reference;

  if (!aiEmployeeId || !task || !action) {
    throw new shared.ApiError(400, "ai_employee_id, task, and action are required.");
  }

  const aiEmployee = shared.findOrNotFound(e.app, "ai_employees", aiEmployeeId, "AI employee");
  if (aiEmployee.get("status") !== "active") {
    throw new shared.ApiError(409, "This AI employee is not active.");
  }
  if (!lib.actionIsAllowed(aiEmployee, action)) {
    throw new shared.ApiError(403, `Action "${action}" is not permitted for this AI employee. AI employees can never be granted denylisted actions (refunds, impersonation, employee/permission management, infrastructure/deployment control), regardless of configuration.`);
  }

  const collection = e.app.findCollectionByNameOrId("ai_jobs");
  const job = new Record(collection);
  job.set("ai_employee", aiEmployee.id);
  job.set("task", task);
  if (inputReference) job.set("input_reference", inputReference);
  job.set("status", "queued");
  job.set("retry_count", 0);
  job.set("human_review_required", lib.ALWAYS_REQUIRES_REVIEW.has(action));
  e.app.save(job);

  return e.json(200, { job_id: job.id, human_review_required: job.get("human_review_required") });
});

// Called by the Python worker to report back a result. Authenticated with
// a static bearer token rather than an employee session.
routerAdd("POST", "/api/ai-jobs/{id}/result", (e) => {
  const shared = require(`${__hooks}/shared.js`);
  const lib = require(`${__hooks}/ai_jobs_lib.js`);

  const workerSlug = lib.requireWorkerAuth(e);
  const data = e.requestInfo().body;
  const job = shared.findOrNotFound(e.app, "ai_jobs", e.request.pathValue("id"), "AI job");

  // A per-employee token may only report results for its own employee's jobs.
  const owner = shared.tryFindFirst(e.app, "ai_employees", "id = {:id}", { id: job.get("ai_employee") });
  const ownerSlug = owner ? lib.slugifyEmployee(owner.get("function") || owner.get("name") || "") : "";
  const owned = lib.WORKER_SLUG_ALIASES[workerSlug] || [workerSlug];
  if (ownerSlug && owned.indexOf(ownerSlug) === -1) {
    throw new shared.ApiError(403, "This worker token is scoped to a different AI employee.");
  }

  const status = data && data.status;
  if (!["succeeded", "failed", "escalated"].includes(status)) {
    throw new shared.ApiError(400, "status must be succeeded, failed, or escalated.");
  }

  job.set("finished_at", new Date().toISOString());
  if (data.result !== undefined) job.set("result", data.result);
  if (data.error) job.set("error", data.error);
  if (typeof data.cost_cents === "number") job.set("cost_cents", data.cost_cents);

  // Even a "succeeded" result from the worker does not bypass a pending
  // human-review requirement.
  if (status === "succeeded" && job.get("human_review_required") && !job.get("approved")) {
    job.set("status", "escalated");
  } else {
    job.set("status", status);
  }
  e.app.save(job);

  return e.json(200, { success: true, status: job.get("status") });
});

// A human clears (or rejects) a job that required review. This is the
// ONLY place approval happens — approving here does not itself execute
// anything; any actual mutation still goes through its own permissioned,
// audited route. This route only records the human decision.
routerAdd("POST", "/api/ai-jobs/{id}/review", (e) => {
  const shared = require(`${__hooks}/shared.js`);

  const employee = shared.requirePermission(e, "ai.approve");
  const data = e.requestInfo().body;
  const decision = data && data.decision;
  if (!["approve", "reject"].includes(decision)) {
    throw new shared.ApiError(400, "decision must be approve or reject.");
  }

  const job = shared.findOrNotFound(e.app, "ai_jobs", e.request.pathValue("id"), "AI job");
  if (!job.get("human_review_required")) {
    throw new shared.ApiError(409, "This job was never flagged for human review.");
  }

  shared.runAudited(
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
