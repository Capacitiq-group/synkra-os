import { useEffect, useState } from "react";
import { pb } from "../../lib/pocketbase";
import { DataTable, Column } from "../../components/DataTable";
import { StatusBadge } from "../../components/StatusBadge";
import { ConfirmActionDialog } from "../../components/ConfirmActionDialog";
import { useAuth } from "../../auth/AuthContext";
import type { Invoice, Payment, Customer } from "../../types/models";

function formatCurrency(cents: number, currency = "USD"): string {
  return `${currency} ${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

export function BillingPage() {
  const { hasPermission } = useAuth();
  const [tab, setTab] = useState<"invoices" | "payments">("invoices");
  const [invoices, setInvoices] = useState<(Invoice & { expand?: { customer?: Customer } })[]>([]);
  const [payments, setPayments] = useState<(Payment & { expand?: { customer?: Customer } })[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refundTarget, setRefundTarget] = useState<Payment | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [inv, pay] = await Promise.all([
        pb.collection("invoices").getList<Invoice & { expand?: { customer?: Customer } }>(1, 100, {
          sort: "-issued_at",
          expand: "customer",
        }),
        pb.collection("payments").getList<Payment & { expand?: { customer?: Customer } }>(1, 100, {
          sort: "-paid_at",
          expand: "customer",
        }),
      ]);
      setInvoices(inv.items);
      setPayments(pay.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load billing data.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleRefund(reason: string) {
    if (!refundTarget) return;
    await pb.send(`/api/payments/${refundTarget.id}/refund`, { method: "POST", body: { reason } });
    await load();
  }

  const invoiceColumns: Column<Invoice & { expand?: { customer?: Customer } }>[] = [
    { header: "Number", render: (i) => i.invoice_number },
    { header: "Customer", render: (i) => i.expand?.customer?.name ?? "—" },
    { header: "Amount", render: (i) => formatCurrency(i.amount_cents, i.currency) },
    { header: "Status", render: (i) => <StatusBadge status={i.status} /> },
    { header: "Issued", render: (i) => i.issued_at?.slice(0, 10) ?? "—" },
    { header: "Due", render: (i) => i.due_at?.slice(0, 10) ?? "—" },
  ];

  const paymentColumns: Column<Payment & { expand?: { customer?: Customer } }>[] = [
    { header: "Customer", render: (p) => p.expand?.customer?.name ?? "—" },
    { header: "Amount", render: (p) => formatCurrency(p.amount_cents, p.currency) },
    { header: "Status", render: (p) => <StatusBadge status={p.status} /> },
    { header: "Provider", render: (p) => p.provider ?? "—" },
    { header: "Paid", render: (p) => p.paid_at?.slice(0, 10) ?? "—" },
    {
      header: "Action",
      render: (p) =>
        hasPermission("billing.refund") && p.status === "succeeded" ? (
          <button className="btn btn--danger" onClick={() => setRefundTarget(p)}>
            Refund
          </button>
        ) : (
          "—"
        ),
    },
  ];

  return (
    <div>
      <div className="page-header">
        <h1>Billing</h1>
        <span className="page-header__meta">
          {invoices.length} invoices · {payments.length} payments
        </span>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <button className={`btn ${tab === "invoices" ? "btn--primary" : ""}`} onClick={() => setTab("invoices")}>
          Invoices
        </button>
        <button className={`btn ${tab === "payments" ? "btn--primary" : ""}`} onClick={() => setTab("payments")}>
          Payments
        </button>
      </div>

      {tab === "invoices" ? (
        <DataTable
          columns={invoiceColumns}
          rows={invoices}
          rowKey={(i) => i.id}
          loading={loading}
          error={error}
          emptyMessage="No invoices yet. Invoices populate once the Zoho Books sync worker is connected."
          onRetry={load}
        />
      ) : (
        <DataTable
          columns={paymentColumns}
          rows={payments}
          rowKey={(p) => p.id}
          loading={loading}
          error={error}
          emptyMessage="No payments yet. Payments populate once the Paystack sync worker is connected."
          onRetry={load}
        />
      )}

      {refundTarget && (
        <ConfirmActionDialog
          title="Issue refund"
          description={`This will refund ${formatCurrency(refundTarget.amount_cents, refundTarget.currency)} via the payment provider. This cannot be undone from here.`}
          confirmLabel="Issue refund"
          danger
          onConfirm={handleRefund}
          onClose={() => setRefundTarget(null)}
        />
      )}
    </div>
  );
}
