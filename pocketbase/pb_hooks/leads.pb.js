/// <reference path="../pb_data/types.d.ts" />

onRecordUpdateRequest("leads").bindFunc((e) => {
  const oldStatus = e.record.original().get("status");
  const newStatus = e.record.get("status");

  e.next();

  if (oldStatus !== newStatus) {
    const authRecord = e.auth;
    const employeeId = authRecord ? authRecord.get("employee") : null;
    if (employeeId) {
      writeAuditLog(e.app, {
        actorEmployeeId: employeeId,
        action: "lead.status_change",
        affectedCollection: "leads",
        affectedRecordId: e.record.id,
        affectedCustomerId: e.record.get("converted_customer") || null,
        previousValue: { status: oldStatus },
        newValue: { status: newStatus },
      });

      // Also log a lead_activities row, so the lead's own timeline (shown
      // in the Leads UI) reflects this without needing audit.view.
      const activitiesCollection = e.app.findCollectionByNameOrId("lead_activities");
      const activity = new Record(activitiesCollection);
      activity.set("lead", e.record.id);
      activity.set("activity_type", "status_change");
      activity.set("description", `Status changed from "${oldStatus}" to "${newStatus}".`);
      activity.set("actor_employee", employeeId);
      activity.set("occurred_at", new Date().toISOString());
      e.app.save(activity);
    }
  }
});

// Completing a follow-up as "email" links it to an email that was already
// sent via /api/email/send — this route never sends anything itself. This
// two-step design is the "controlled, event-driven" path the spec asks
// for: a human decides a specific follow-up warrants an email at the
// moment they act on it; there is no background sequence emailing leads
// on its own.
routerAdd("POST", "/api/follow-ups/{id}/complete-with-email", (e) => {
  const employee = requirePermission(e, "followups.manage");
  const data = e.requestInfo().body;
  const emailEventId = data && data.email_event_id;
  if (!emailEventId) {
    throw new ApiError(400, "email_event_id is required — send the email via /api/email/send first, then complete the follow-up with its resulting email_event_id.");
  }

  const followUp = findOrNotFound(e.app, "follow_ups", e.request.pathValue("id"), "Follow-up");
  findOrNotFound(e.app, "email_events", emailEventId, "Email event"); // validates it actually exists

  runAudited(
    e.app,
    (txApp) => {
      followUp.set("status", "completed");
      followUp.set("completed_at", new Date().toISOString());
      followUp.set("outcome", `Completed via email (event ${emailEventId}).`);
      txApp.save(followUp);
    },
    {
      actorEmployeeId: employee.id,
      action: "followup.completed_with_email",
      affectedCollection: "follow_ups",
      affectedRecordId: followUp.id,
      affectedCustomerId: followUp.get("customer") || null,
      newValue: { email_event_id: emailEventId },
    }
  );

  return e.json(200, { success: true });
});
