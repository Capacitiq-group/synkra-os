import { useEffect, useState } from "react";
import { pb } from "../lib/pocketbase";

export interface IntegrationStatus {
  integration_key: string;
  display_name: string;
  status: "connected" | "not_configured" | "authentication_failed" | "unavailable" | "error";
  last_checked_at?: string;
  last_successful_at?: string;
  last_error?: string;
}

const STATUS_LABEL: Record<IntegrationStatus["status"], string> = {
  connected: "Connected",
  not_configured: "Not configured",
  authentication_failed: "Authentication failed",
  unavailable: "Unavailable",
  error: "Error",
};

const STATUS_VARIANT: Record<IntegrationStatus["status"], string> = {
  connected: "ok",
  not_configured: "neutral",
  authentication_failed: "error",
  unavailable: "error",
  error: "error",
};

export function IntegrationStatusBadge({ status }: { status: IntegrationStatus["status"] }) {
  return <span className={`status-badge status-badge--${STATUS_VARIANT[status]}`}>{STATUS_LABEL[status]}</span>;
}

// Small inline tag used next to a metric/section to say where its data
// comes from — "Source: Flow", "Source: Synkra OS", etc. Never omitted on
// a section that pulls from an external system, per the spec's data-source
// labeling requirement.
export function SourceTag({ source }: { source: string }) {
  return (
    <span style={{ color: "var(--text-muted)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>
      Source: {source}
    </span>
  );
}

export function useIntegrationStatuses() {
  const [statuses, setStatuses] = useState<Record<string, IntegrationStatus>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    pb.collection("integration_status")
      .getFullList<IntegrationStatus>()
      .then((rows) => {
        if (cancelled) return;
        const map: Record<string, IntegrationStatus> = {};
        for (const row of rows) map[row.integration_key] = row;
        setStatuses(map);
      })
      .catch(() => {
        // Caller without integrations.view permission simply sees no
        // statuses — that's a permission boundary, not a bug to surface
        // loudly here.
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  return { statuses, loading };
}
