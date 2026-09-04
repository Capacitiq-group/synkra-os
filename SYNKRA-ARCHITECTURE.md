# SYNKRA-ARCHITECTURE.md — canonical architecture

**Status:** source of truth. This file lives in `synkra-os` and supersedes the
architecture sections of every other Synkra repo's README, plus these now-legacy
documents:

- `synkra-agency-client-portal/ARCHITECTURE.md`
- `synkra-os/docs/AGENCY_PLATFORM_ARCHITECTURE.md` (a byte-identical copy of the above)
- `synkra--web/ADMIN-PANEL-ARCHITECTURE.md`
- `synkra--web/POCKETBASE-MIGRATION-PLAN.md` (architecture claims only; its migration
  steps remain historically accurate)

Where those documents disagree with this one, this one is correct: it was written by
querying the live PocketBase instances, not from memory.

**Verified live:** 2026-09-04 (UTC) against the shared instance, superuser API.
Credentials referenced by env-var name only: `PB_URL`, `PB_ADMIN_EMAIL`, `PB_PASSWORD`.

---

## 1. The instances

There are exactly **two** PocketBase instances in the Synkra estate.

### 1.1 The shared instance — *is* the Synkra OS container

The shared instance is not a separate "Agency PocketBase" service. It is the
PocketBase binary running inside the **`synkra-os` container** (`Dockerfile` +
`docker-compose.yml` in this repo), serving on port `8090`, with its schema defined
by `pocketbase/pb_migrations/` and its server-side logic by `pocketbase/pb_hooks/`
in this repo. Referenced everywhere by `PB_URL`.

Earlier docs described "one dedicated Agency PocketBase instance" as if it were a
standalone service that Synkra OS talks to over the network. That is wrong. Synkra OS
*hosts* it. The consolidation migration
`pocketbase/pb_migrations/1735500021_website_and_agency_portal_consolidation.js`
folded the website's and the agency portal's collections onto this same instance,
which is why website collections (`form_submissions`, `waitlist`, `blog_posts`,
`integration_partner_applications`, …) and agency collections (`clients`,
`agency_client_services`, `intake_forms`, …) are all present in the single
collection list in §4.

Its clients:

| Repo | Role against the shared instance |
|---|---|
| `synkra-os` | Owner. Hosts the instance, owns schema migrations and `pb_hooks` business rules, and is the internal ops UI ("Admin Panel"). |
| `synkra--web` | Marketing site. Writes `form_submissions`, `waitlist`, `integration_partner_applications`; reads `services`, `blog_posts`, `portfolio_items`, `approved_partners`, `testimonial_clients`. |
| `synkra-agency-client-portal` | Client-facing portal. Reads/writes `clients`, `agency_client_users`, `agency_client_services`, `intake_forms`, `agency_usage_events`, `agency_usage_credits`, `agency_payments`, `agency_invites`, scoped to the signed-in client. |
| `implementation-ai` | AI employees. `internal_employees/customer_support` authenticates with its own scoped employee login and reads/writes `support_tickets`, `ai_jobs`, `audit_logs`. `agency_services` (not yet in the repo) will read `intake_forms` / `onboarding_notes` and write `implementation_reports`. |
| `synkra-utilities` | **Not a client.** The utilities API is stateless — no account, no storage, no PocketBase connection at all. It appears in this document only so nobody wires one in by assumption. |

There is no sync layer between these. Same database, same collections, direct
reads/writes with each system's own credentials, PocketBase realtime for live updates.

### 1.2 The separate instance — Client Hub

`synkra-client-hub` runs its **own** PocketBase instance at `https://pb.synkra.co.za`
(health-checked live and responding, 2026-09-04). It is deliberately separate and
stays that way:

- It is a different product line (Flow / Chat self-serve SaaS), with its own `users`
  auth collection, its own tiering (`free`/`basic`/`pro`), execution credits and
  monthly usage counters — none of which the agency/ops model shares.
- Its schema is owned by that repo's own `src/lib/setup/createCollections.ts` and
  documented in its `POCKETBASE_COLLECTIONS.md`.
- Merging it into the shared instance would collide two unrelated `users` auth
  collections and put self-serve end-user accounts in the same blast radius as
  internal ops data.

Cross-instance visibility is read-only and live (Synkra OS reads Client Hub's REST
API with a dedicated service account) — never replicated into the shared instance.

**Resolved:** `agency_quote_requests`. Older docs flagged its instance location as an
open question. It does not exist on the shared instance (see §4 — it is not in the
list). It remains a Client Hub–side concern; if the quote→client flow is ever moved,
that is a migration to plan deliberately, not an undocumented drift.

---

## 2. Identity model

**Real, in use on the shared instance:**

| Collection | Type | Who it is | Notes |
|---|---|---|---|
| `users` | auth | Every internal human login (Synkra OS staff, AI employee service accounts) | Has an `employee` relation. All permission checks in `pb_hooks` and collection rules run through `@request.auth.employee.role`. |
| `employees` | base | The staff record behind a `users` login | `role` relation → `roles` → `permissions`. `roles.is_super_admin` is the escape hatch. |
| `agency_client_users` | auth | External agency clients logging into the Client Portal | `agency_client_id` relation → `clients`. Rules are `id = @request.auth.id` — a client sees only itself. Created only through `agency_invites`. |
| `roles` / `permissions` | base | RBAC | 1 role, 38 permission keys live today. |

**Legacy, not authoritative:**

- `admin_users` (auth) — carried over from the website's pre-consolidation schema.
  **0 records live.** Nothing in `synkra-os` authenticates against it; the collection
  rules are self-scoped only. `synkra--web` still contains code paths referencing it
  (`src/routes/admin.login.tsx`, `src/routes/_admin.tsx`,
  `src/integrations/pocketbase/auth-middleware.ts`, `src/lib/admin.functions.ts`) —
  those are legacy and must migrate to `users` + `employees`. **Do not treat
  `admin_users` as the admin identity model and do not build new work against it.**
- PocketBase `_superusers` — deploy/migration tooling only. No application, adapter
  or AI employee should authenticate as an undifferentiated superuser; each gets its
  own scoped account.

The "Admin Panel" question, settled: older portal docs list an Admin Panel as
"not built". **It is built — it is `synkra-os`.** There is no separate admin-panel
repo and none is planned.

---

## 3. Credentials

Every system uses its own scoped account against the instance it needs. Env vars, by
name only:

- Shared instance: `PB_URL`, `PB_ADMIN_EMAIL`, `PB_PASSWORD` (tooling/superuser);
  apps use `VITE_POCKETBASE_URL` (browser) and `POCKETBASE_URL` +
  their own service-account pair (server).
- Client Hub instance: `POCKETBASE_URL` / `VITE_POCKETBASE_URL` inside that repo.
- Never reuse one system's credential pair for another system, and never place any
  server-side pair in browser-reachable code.

---

## 4. Live collection inventory

Shared instance, superuser API, **2026-09-04 (UTC)**. 67 application collections
(PocketBase's own `_`-prefixed system collections excluded). Record counts are a
point-in-time reading — re-run the check below rather than trusting these numbers
months from now.

| Collection | Type | Records |
|---|---|---|
| `acquisition_campaigns` | base | 0 |
| `acquisition_events` | base | 0 |
| `acquisition_targets` | base | 2 |
| `admin_audit_log` | base | 0 |
| `admin_users` | auth | 0 |
| `agency_client_services` | base | 0 |
| `agency_client_users` | auth | 0 |
| `agency_invites` | base | 0 |
| `agency_leads` | base | 0 |
| `agency_payments` | base | 0 |
| `agency_service_configs` | base | 0 |
| `agency_service_pricing` | base | 12 |
| `agency_suppressed_contacts` | base | 0 |
| `agency_usage_credits` | base | 0 |
| `agency_usage_events` | base | 0 |
| `ai_employees` | base | 0 |
| `ai_jobs` | base | 0 |
| `approved_partners` | base | 0 |
| `audit_logs` | base | 0 |
| `blog_posts` | base | 0 |
| `clients` | base | 1 |
| `conversations` | base | 0 |
| `credit_transactions` | base | 0 |
| `customers` | base | 0 |
| `deployments` | base | 0 |
| `email_events` | base | 0 |
| `email_templates` | base | 0 |
| `employees` | base | 1 |
| `follow_ups` | base | 0 |
| `form_submissions` | base | 0 |
| `health_checks` | base | 0 |
| `impersonation_sessions` | base | 0 |
| `implementation_reports` | base | 0 |
| `incidents` | base | 0 |
| `intake_forms` | base | 0 |
| `integration_partner_applications` | base | 0 |
| `integration_status` | base | 9 |
| `invoices` | base | 0 |
| `lead_activities` | base | 0 |
| `leads` | base | 0 |
| `media` | base | 0 |
| `notifications` | base | 0 |
| `onboarding_notes` | base | 0 |
| `organisations` | base | 0 |
| `partners` | base | 0 |
| `payments` | base | 0 |
| `permissions` | base | 38 |
| `portfolio_items` | base | 0 |
| `products` | base | 0 |
| `projects` | base | 0 |
| `prospect_companies` | base | 0 |
| `prospect_contacts` | base | 0 |
| `prospect_research` | base | 0 |
| `referrals` | base | 0 |
| `roles` | base | 1 |
| `servers` | base | 0 |
| `service_packages` | base | 0 |
| `services` | base | 0 |
| `subscriptions` | base | 0 |
| `support_tickets` | base | 0 |
| `suppression_list` | base | 0 |
| `testimonial_clients` | base | 0 |
| `users` | auth | 0 |
| `utilities` | base | 0 |
| `utility_events` | base | 0 |
| `utility_leads` | base | 0 |
| `waitlist` | base | 0 |

Non-empty today: `permissions` (38), `agency_service_pricing` (12),
`integration_status` (9), `acquisition_targets` (2), `clients` (1), `employees` (1),
`roles` (1). Everything else is 0 — the platform is schema-complete and
data-empty, which is expected pre-launch, not a fault.

Client Hub's instance is live but its collection inventory is not reproduced here:
this document's rule is that every number in it was read from the instance, and no
credentials for that instance are available to this repo's tooling. Its schema is
documented in `synkra-client-hub/POCKETBASE_COLLECTIONS.md`.

### Re-verifying these numbers

```bash
# needs PB_URL, PB_ADMIN_EMAIL, PB_PASSWORD in the environment — never inline them
python3 scripts/verify_architecture_doc.py
```

---

## 5. Known gaps, carried forward deliberately

These were open in the superseded docs and are still open. They are listed so they
stay visible, not because this document resolves them:

- Pause/cancel scheduled job — the portal writes `agency_client_services.pending_change`;
  nothing applies it. Waiting on the cancellation policy.
- Renewal job — advancing `current_period_end`, resetting `included` credits, charging
  a stored Paystack authorization.
- Usage-credit consumption — nothing decrements `agency_usage_credits.remaining` when
  an `agency_usage_events` row is written.
- Zoho invoice display in the portal — must proxy through the system that already holds
  the Zoho connection, not add a second integration.
- `implementation-ai/agency_services/` — referenced by the brief, not yet in the repo.
- `synkra--web`'s `admin_users` code paths — see §2.
