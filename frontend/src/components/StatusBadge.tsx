const OK_STATUSES = new Set(["active", "paid", "succeeded", "resolved", "closed", "healthy", "pass", "ok", "onboarding_complete"]);
const WARN_STATUSES = new Set([
  "trialing", "pending_verification", "open", "waiting_on_customer", "human_review",
  "in_progress", "ai_investigating", "degraded", "queued", "building", "investigating",
  "mitigating", "detected", "past_due",
]);
const ERROR_STATUSES = new Set([
  "suspended", "churned", "failed", "down", "fail", "cancelled", "refunded",
  "urgent", "high", "sev1", "sev2",
]);

export function StatusBadge({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  let variant = "neutral";
  if (OK_STATUSES.has(normalized)) variant = "ok";
  else if (WARN_STATUSES.has(normalized)) variant = "warn";
  else if (ERROR_STATUSES.has(normalized)) variant = "error";

  return (
    <span className={`status-badge status-badge--${variant}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}
