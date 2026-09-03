# Synkra Agency Platform — Technical Architecture & Handover

**Purpose of this document:** the shared contract for everyone building
on the Agency PocketBase instance — this Client Portal (built), the Admin
Panel (not yet built), and the AI Implementation Agent (not yet built,
scoped in `portal-integration-brief.md`). If you're building either of
those two, this is what you build against.

This supersedes the earlier `ARCHITECTURE.md` — that file was corrected
in place across several sessions and had become hard to read as a single
source of truth. Nothing here contradicts a *decision* made along the
way; this just consolidates them into one document instead of a trail of
patches.

---

## 1. The four systems

**One dedicated Agency PocketBase instance**, not shared with Client
Hub's (Flow/Chat) or web-main's own instance. Four systems read and/or
write it:

| System | Status | Role |
|---|---|---|
| **Client Portal** | Built (this repo) | Client-facing: invite acceptance, dashboard, intake forms, usage display, billing, add-on purchases |
| **Admin Panel** | Not built | Internal ops: managing clients, reviewing intake forms, logging onboarding call notes, financial visibility, QC on implementation |
| **AI Implementation Agent** | Not built | Reads intake forms + onboarding notes, builds/tests/deploys the actual AI service, writes implementation reports |
| **`synkra-core`** | Built (separate repo, already exists) | Writes usage events as services actually run (voice minutes, emails, etc.) — the operational backend, not a UI |

No sync layer between them. Same database, same collections, direct
reads/writes with each system's own credentials. Real-time visibility
comes from PocketBase's own realtime subscriptions on the collections
below, not polling or webhooks between these four systems.

---

## 2. Known inconsistency, flagging rather than hiding it

`agency_quote_requests` (created by the qualification-form quote engine
in `synkra-core` + `synkra--web-main`, documented in that work's own
`POCKETBASE-MIGRATION-PLAN.md`) currently writes to **Client Hub's**
PocketBase instance, not this dedicated Agency one. That decision predates
this instance existing. Given a quote is the direct precursor to becoming
an Agency `clients` record, it arguably belongs on *this* instance
instead, alongside `clients` — same instance a quote eventually feeds
into. Not resolved here; needs a decision (and a small migration in
`synkra-core`'s `agency_quotes.py` router) before the Admin Panel is
built, since "see every quote and every client in one place" is presumably
one of its jobs.

---

## 3. Full collection reference

For each collection: purpose, fields, and exactly which system can
Create / Read / Update / Delete. "Read" always means subject to the
listed access rule, not unrestricted.

### `clients`
One record per Agency client company.

**Fields:** `company_name`, `contact_name`, `contact_email`,
`contact_phone`, `billing_mode` (`recurring`|`manual`), `zoho_contact_id`,
`paystack_customer_code`, `paystack_authorization_code`, `status`
(`active`|`suspended`).

| | Client Portal | Admin Panel | AI Implementation Agent |
|---|---|---|---|
| Create | Yes (accept-invite, find-or-create) | Yes (manual onboarding) | No |
| Read | Own record only | All | Own-client-scoped, as needed for context |
| Update | No (billing_mode changes go through Admin Panel per current portal copy) | Yes | No |
| Delete | No | Yes | No |

### `agency_client_users` (auth collection)
The people who log into the Client Portal.

**Fields:** standard auth fields (email, password, verified) +
`agency_client_id` (relation), `role` (`owner` for now), `invited_at`,
`invite_accepted_at`.

| | Client Portal | Admin Panel |
|---|---|---|
| Create | Yes (accept-invite only) | Yes (rare — manual account creation) |
| Read | Own record only | All |
| Update | Own record | All |
| Delete | No | Yes |

AI Implementation Agent has no reason to touch this collection at all.

### `agency_client_services`
One record per purchased service — this is the granularity mechanism for
"a client only sees what they bought," and where both the onboarding
pipeline and billing status live.

**Fields:** `agency_client_id` (relation), `service_slug`, `tier`,
`monthly_price`, `setup_price` (locked at purchase time), `status`
(`active`|`paused`|`cancelled` — billing state), `onboarding_status`
(`quotation_sent`|`invoiced`|`paid`|`intake_form_completed`|
`onboarding_scheduled`|`onboarding_completed`|`onboarding_notes_ready`|
`implementation_triggered`|`implementing`|`pending_qc`|`active` —
onboarding/implementation pipeline state, a separate concern from
`status`, see §4), `pending_change` (`none`|`pause_at_next_cycle`|
`cancel_at_next_cycle`), `current_period_start`, `current_period_end`,
`activated_at`.

| | Client Portal | Admin Panel | AI Implementation Agent |
|---|---|---|---|
| Create | Yes (accept-invite provisions the invited services) | Yes (adding a service to an existing client) | No |
| Read | Own services only | All | Own-service-scoped |
| Update | `pending_change` only (pause/cancel request — not yet actually applied, see §6) | `onboarding_status`, `tier`, pricing, admin overrides | `onboarding_status` transitions specifically `implementation_triggered → implementing → pending_qc` |
| Delete | No | Yes | No |

### `intake_forms`
The client's answers about their business, submitted once per service.

**Fields:** `client_id`, `agency_client_service_id`, `service`,
`plan_tier`, `data` (json, service-specific — field set is a first draft,
see the Client Portal's own `_authed.intake.$serviceRecordId.tsx`
comments), `submitted_at`.

| | Client Portal | Admin Panel | AI Implementation Agent |
|---|---|---|---|
| Create | Yes (the only creator) | No | No |
| Read | Own submissions | All | Yes — this is primary input |
| Update | No | Corrections only | No |
| Delete | No | Yes | No |

### `onboarding_notes`
Human-logged notes from the onboarding call, filling gaps the intake
form left.

**Fields:** `client_id`, `agency_client_service_id`, `call_held_at`,
`notes`, `changes_from_form`, `additional_info`, `finalized_by`,
`finalized_at`.

| | Client Portal | Admin Panel | AI Implementation Agent |
|---|---|---|---|
| Create | No | Yes (only creator — a human is on this call) | No |
| Read | No (internal) | All | Yes — this is primary input, alongside `intake_forms` |
| Update | No | Yes | No |
| Delete | No | Yes | No |

### `implementation_reports`
The AI Implementation Agent's own record of what it built and tested.

**Fields:** `client_id`, `agency_client_service_id`, `service`, `status`
(`in_progress`|`ready_for_qc`|`needs_review`|`blocked`),
`steps_completed` (json), `test_results` (json), `flags_for_human` (json),
`started_at`, `completed_at`.

| | Client Portal | Admin Panel | AI Implementation Agent |
|---|---|---|---|
| Create | No | No | Yes (only creator) |
| Read | Not in v1 (per `portal-integration-brief.md` §7 — may change later) | Yes — this is what QC reviews | Own reports |
| Update | No | Yes (QC decisions, status overrides) | Yes (progress updates) |
| Delete | No | Yes | No |

### `agency_usage_events`
Append-only log of billable usage — one row per call, email, AI
operation, etc.

**Fields:** `agency_client_service_id`, `usage_type`
(`voice_minute`|`email`|`sms`|`whatsapp_conversation`|`ai_operation`),
`quantity`, `occurred_at`, `source` (which backend system generated it).

| | Client Portal | Admin Panel | `synkra-core` |
|---|---|---|---|
| Create | No | No | Yes (only creator — writes this as services actually run) |
| Read | Own service's events | All | N/A (write-only from its perspective) |
| Update/Delete | Nobody, ever — append-only |

**Gap, not yet built anywhere:** nothing currently decrements
`agency_usage_credits.remaining` when a usage event is written. The
Client Portal displays credits; it doesn't consume them. This needs a
writer — most naturally `synkra-core`, in the same code path that writes
`agency_usage_events` in the first place, doing the FIFO
included-then-purchased draw-down described in
`AGENCY-SERVICES-DOCUMENTATION.md` §10.

### `agency_usage_credits`
Included and purchased usage balances, FIFO consumption, per
`AGENCY-SERVICES-DOCUMENTATION.md` §10.

**Fields:** `agency_client_service_id`, `usage_type`, `source`
(`included`|`purchased`), `amount`, `remaining`, `granted_at`,
`expires_at`.

| | Client Portal | Admin Panel | `synkra-core` |
|---|---|---|---|
| Create | Yes — only for `purchased` (the Paystack webhook, on a confirmed add-on payment) | Yes (manual grants/adjustments) | Yes (would create the monthly `included` grant at renewal — not yet built, tied to the deferred renewal job) |
| Read | Own service's credits | All | As needed |
| Update | No (the webhook creates new rows rather than editing existing ones) | Yes (manual adjustments) | Yes (decrementing `remaining` — see the gap above) |
| Delete | No | Yes | No |

### `agency_invites`
The only path to a Client Portal account existing.

**Fields:** `email`, `company_name`, `service_slugs` (json array — the
whole granularity mechanism starts here), `token`, `status`
(`pending`|`accepted`|`expired`), `expires_at`.

| | Client Portal | Admin Panel |
|---|---|---|
| Create | No | Yes (only creator) |
| Read | Public, scoped to exact-token lookup only (`token != ""` as the rule — trusts token unguessability, same model as any reset-link token) | All |
| Update | Yes (marking `accepted`, part of the accept-invite flow) | Yes |
| Delete | No | Yes |

### `agency_payments`
Every Paystack transaction, checkout or add-on.

**Fields:** `agency_client_id`, `agency_client_service_id` (nullable),
`purpose` (`setup_fee`|`monthly_renewal`|`addon_purchase`),
`addon_usage_type`, `addon_quantity`, `amount_rand`,
`paystack_reference` (unique, also the webhook's idempotency key),
`status` (`pending`|`success`|`failed`), `paystack_authorization_code`,
`completed_at`.

| | Client Portal | Admin Panel |
|---|---|---|
| Create | Yes (checkout-init server route, always starts `pending`) | No |
| Read | Own payments | All |
| Update | Yes (webhook only, sets `success`/`failed` — never the browser-facing code) | No, in practice — nothing needs to override a payment record |
| Delete | No | No |

---

## 4. Why `status` and `onboarding_status` are two different fields

`status` is billing/service state once a service is actually live —
active, paused, or cancelled. `onboarding_status` is the pipeline getting
a *paid-for* service to the point of being live in the first place. A
service only starts using `status`/`pending_change` at all once
`onboarding_status` reaches `active`. Before that, the Client Portal
shows onboarding progress instead of usage/billing controls. This is
what makes a client with two services able to have one live and one
still mid-onboarding, which is real — implementation happens per
service, not per client.

---

## 5. Auth model, for whoever builds the Admin Panel

Client Portal's auth collection is `agency_client_users`, scoped to
`id = @request.auth.id` for their own record. **The Admin Panel needs
its own separate credentials on this same instance** — either its own
superuser account, or (better, for audit-trail reasons) its own
non-superuser service account with broad-but-scoped collection rules, so
"who did this" is traceable to a real admin panel session rather than an
undifferentiated superuser. Do not have the Admin Panel authenticate as
`agency_client_users` — it's not a client.

The AI Implementation Agent similarly needs its own credentials, scoped
to what §3's tables say it can touch — it should not have blanket
superuser access either, given it's the system most likely to be given
autonomous write access to real client data.

---

## 6. Explicitly deferred, not built anywhere yet

- **The pause/cancel scheduled job.** The Client Portal writes
  `pending_change`; nothing applies it. Waiting on the actual
  cancellation policy, per instruction.
- **The renewal job** (advancing `current_period_end`, resetting
  `included` credits, charging stored `paystack_authorization_code` for
  recurring clients). Tied to the same policy decision as above.
- **Usage-credit consumption** (decrementing `remaining` as
  `agency_usage_events` are written) — see the gap noted under
  `agency_usage_credits` above.
- **Zoho invoice display** in the Client Portal — needs a proxy read
  through `synkra-core` (which already holds the Zoho connection), not a
  second Zoho integration.
- **The `agency_quote_requests` instance location** — see §2.

---

## 7. Env vars, per system

**Client Portal** (already in use):
```
VITE_POCKETBASE_URL=            # this dedicated Agency instance, NOT Client Hub's
POCKETBASE_URL=                 # same instance, server-side
POCKETBASE_ADMIN_EMAIL=
POCKETBASE_ADMIN_PASSWORD=
PAYSTACK_SECRET_KEY=            # same Paystack merchant account as Client Hub
APP_URL=                        # this app's own public URL, for Paystack callbacks
```

**Admin Panel** (when built) will need its own `POCKETBASE_URL` pointing
at the same instance, plus its own service-account credentials per §5 —
not the Client Portal's `POCKETBASE_ADMIN_EMAIL`/`PASSWORD` pair.

**AI Implementation Agent** (when built): same instance, its own scoped
credentials, plus whatever it needs to actually build/test/deploy
services (that's a separate concern from this document).
