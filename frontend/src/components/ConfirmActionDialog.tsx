import { useState } from "react";

interface ConfirmActionDialogProps {
  title: string;
  description: string;
  confirmLabel: string;
  requireReason?: boolean;
  danger?: boolean;
  onConfirm: (reason: string) => Promise<void>;
  onClose: () => void;
}

export function ConfirmActionDialog({
  title,
  description,
  confirmLabel,
  requireReason = true,
  danger = false,
  onConfirm,
  onClose,
}: ConfirmActionDialogProps) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    if (requireReason && !reason.trim()) {
      setError("A reason is required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm(reason.trim());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        <p style={{ color: "var(--text-secondary)", marginTop: 0 }}>{description}</p>
        {requireReason && (
          <div className="field-row">
            <label>Reason (required, recorded in audit log)</label>
            <textarea
              className="field-input"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        )}
        {error && <div className="error-state" style={{ padding: "8px 0" }}>{error}</div>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
          <button className="btn" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button
            className={`btn ${danger ? "btn--danger" : "btn--primary"}`}
            onClick={handleConfirm}
            disabled={submitting}
          >
            {submitting ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
