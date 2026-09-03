/// <reference path="../pb_data/types.d.ts" />

routerAdd("POST", "/api/payments/{id}/refund", (e) => {
  const employee = requirePermission(e, "billing.refund");
  const data = e.requestInfo().body;
  const reason = (data && data.reason) || "";
  if (!reason) throw new ApiError(400, "A reason is required to issue a refund.");

  const payment = findOrNotFound(e.app, "payments", e.request.pathValue("id"), "Payment");
  if (payment.get("status") === "refunded") {
    throw new ApiError(409, "This payment has already been refunded.");
  }

  const paystackSecret = $os.getenv("PAYSTACK_SECRET_KEY");
  if (!paystackSecret) {
    throw new ApiError(501, "PAYSTACK_SECRET_KEY is not configured — the payment-provider integration boundary is not connected. No refund has been attempted or faked.");
  }

  // Real call to the provider happens BEFORE any local state changes, and
  // outside the transaction below — we never want to mark something
  // refunded locally if the provider call actually failed.
  let res;
  try {
    res = $http.send({
      url: "https://api.paystack.co/refund",
      method: "POST",
      headers: {
        Authorization: `Bearer ${paystackSecret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ transaction: payment.get("provider_reference") }),
    });
  } catch (err) {
    throw new ApiError(502, "Could not reach the payment provider. No changes were made.");
  }

  if (res.statusCode >= 400) {
    throw new ApiError(502, `Refund failed at payment provider (status ${res.statusCode}). No changes were made.`);
  }

  const previousStatus = payment.get("status");

  runAudited(
    e.app,
    (txApp) => {
      payment.set("status", "refunded");
      payment.set("refund_reason", reason);
      payment.set("refunded_by", employee.id);
      txApp.save(payment);
    },
    {
      actorEmployeeId: employee.id,
      action: "billing.refund",
      affectedCollection: "payments",
      affectedRecordId: payment.id,
      affectedCustomerId: payment.get("customer"),
      previousValue: { status: previousStatus },
      newValue: { status: "refunded" },
      reason,
    }
  );

  return e.json(200, { success: true, status: "refunded" });
});
