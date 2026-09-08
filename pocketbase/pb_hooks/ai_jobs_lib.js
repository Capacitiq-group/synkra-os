// pb_hooks/ai_jobs_lib.js
//
// Plain CommonJS module (NOT *.pb.js). Required from inside
// ai_jobs.pb.js's routerAdd handler bodies — see shared.js for the full
// explanation of why (PocketBase handler-scope isolation).

// Actions no AI employee may ever be granted, regardless of what its
// permitted_actions field says. Mirrors the spec's explicit list: no
// refunds, no ownership changes, no account deletion, no unauthorized
// subscription changes, no impersonation, no cross-customer access, no
// credential exposure, no arbitrary admin actions.
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
// to approve the specific job before it's considered actionable.
const ALWAYS_REQUIRES_REVIEW = new Set([
  "customers.edit",
  "support.manage",
]);

function actionIsAllowed(aiEmployee, action) {
  if (AI_GLOBAL_DENYLIST.has(action)) return false;
  const permitted = aiEmployee.get("permitted_actions") || [];
  return Array.isArray(permitted) && permitted.includes(action);
}

// The old shared AI_WORKER_API_KEY has been retired — one token per
// internal AI employee, never shared.
const WORKER_TOKEN_ENV_BY_SLUG = {
  customer_support: "AI_WORKER_API_KEY_CUSTOMER_SUPPORT",
  finance_billing: "AI_WORKER_API_KEY_FINANCE_BILLING",
};

// ai_employees.function is a fixed select list that does not contain
// "finance_billing", so each worker slug declares which employee
// functions/names it owns.
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
  const shared = require(`${__hooks}/shared.js`);
  const provided = e.request.header.get("Authorization");
  let configured = 0;

  for (const slug of Object.keys(WORKER_TOKEN_ENV_BY_SLUG)) {
    const value = $os.getenv(WORKER_TOKEN_ENV_BY_SLUG[slug]);
    if (!value) continue;
    configured++;
    if (provided === `Bearer ${value}`) return slug;
  }

  if (configured === 0) {
    throw new shared.ApiError(501, "No AI worker token is configured (AI_WORKER_API_KEY_CUSTOMER_SUPPORT / AI_WORKER_API_KEY_FINANCE_BILLING) — the Python AI worker integration boundary is not connected.");
  }
  throw new shared.ApiError(401, "Invalid or missing worker credentials.");
}

module.exports = {
  AI_GLOBAL_DENYLIST,
  ALWAYS_REQUIRES_REVIEW,
  actionIsAllowed,
  WORKER_TOKEN_ENV_BY_SLUG,
  WORKER_SLUG_ALIASES,
  slugifyEmployee,
  requireWorkerAuth,
};
