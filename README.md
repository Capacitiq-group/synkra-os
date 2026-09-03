# Synkra OS

Synkra's internal operations control plane. React + TypeScript frontend,
PocketBase backend (SQLite + Go, single binary), deployed as one Docker
container via Coolify.

## Status of this delivery — read this first

This codebase was written and debugged by hand, file by file, in an
environment with **no network access** — no `npm install`, no
`docker build`, no ability to actually run PocketBase or the frontend, and
**no access to the real Flow or Chat repositories** (confirmed by
searching this environment — see "Integration honesty" below). That is
still true as of this revision.

### What this revision added

- **Growth/CRM layer**: Leads (with the utility-user → utility-lead →
  product-customer → agency-client distinction preserved as separate
  collections, never collapsed into one record), Follow-ups (overdue/due
  today/upcoming/unassigned/completed views), Email (Resend-backed send +
  template management), and an **Acquisition Engine** module implementing
  the Direct Acquisition Engine spec's CRM/state layer (prospect
  companies/contacts/research dossiers, per-contact campaign state
  machine, suppression list, real-time event log, Month 1 = 3,000 / Month
  2+ = 2,000 initial-email targets with live progress).
- **Integration adapters**: Flow (real adapter + honest connection states;
  field-mapping is a placeholder pending Flow's actual schema — see
  below), Chat (pure boundary — no Chat backend exists to inspect, so
  nothing beyond the interface was built), Resend (real send + webhook
  receiver).
- **AI job contract**: `/api/ai-jobs/submit|result|review` — a hard
  global denylist (refunds, impersonation, employee/permission
  management, infra/deployment control) that no AI employee configuration
  can override, plus a human-review gate for sensitive actions. This is
  the connection point for a future Python AI worker project.
- **Security fixes from a second audit pass**: several collections
  (`customers`, `subscriptions`, `support_tickets`, `agency_leads`,
  `employees`, `invoices`, `payments`) had base PocketBase rules that only
  checked "is logged in," not the actual permission — meaning any
  employee could read/write them directly via the REST API regardless of
  role. Fixed to check real permission keys. `/api/search` used a
  superuser-context query that bypassed collection rules entirely,
  meaning search results ignored permissions — fixed with an explicit
  per-entity-type permission check. `findRecordById`/
  `findFirstRecordByFilter` throw rather than return null in the
  PocketBase JSVM API; several routes assumed null-on-miss — fixed via
  `findOrNotFound`/`tryFindFirst` helpers.
- Dangerous mutations (suspend, refund, impersonation, AI job review) now
  write their record change and audit-log entry inside a single
  `app.runInTransaction(...)` call.

### Integration honesty — what's real vs. a placeholder

- **Flow**: corrected against the real "How the Admin Platform Should
  Talk to Flow" handover doc (Flow is itself a PocketBase backend).
  `pb_hooks/flow_adapter.pb.js` now uses Flow's actual `users` field list
  (tier, business_name, executions_used_this_month, etc.) and real
  collection names (workspaces, billing_subscriptions, billing_payments,
  execution_credits, integrations, pending_approvals,
  student_verifications). Field-level mapping is only confirmed for
  `users` — the billing/workspace collections are exposed as labeled raw
  passthroughs until their field names are confirmed. Two channels, per
  the doc: **Channel A** (reads) hits Flow's PocketBase REST API directly
  with a dedicated service-account token; **Channel B** (suspend,
  reactivate, impersonate, magic-link) always returns 501 naming the
  exact synkra-core endpoint that needs to be built first — per the doc,
  almost none of those exist yet, and writing directly to Flow's
  PocketBase to fake them would bypass Flow's own audit trail and
  enforcement. Flow uses passwordless magic-link auth, not passwords —
  "resend verification"/"password reset" don't apply and are marked as
  such rather than silently no-op'ing.
- **Coolify (infrastructure monitoring)**: `pb_hooks/coolify_adapter.pb.js`
  calls Coolify's real API (`GET /servers`, `GET /servers/{uuid}/resources`
  — confirmed against Coolify's docs, not guessed), syncing server and
  per-resource status every 5 minutes plus an on-demand "Sync now" button.
  This works the same regardless of what's deployed (PocketBase,
  PostgreSQL, anything Docker-based) since it reports container status,
  not database internals. CPU/RAM/disk percentages only populate if
  Coolify's Sentinel agent is enabled per-server — Coolify's own docs say
  Sentinel metrics don't work for Docker Compose or Service-Template
  deployments, so a blank figure means "not available," never "zero load."
- **Chat**: no Chat backend was found anywhere in this environment (no
  repo, no docs, no config). Only the interface boundary was built —
  `/api/chat/status` and `/api/chat/conversations` return
  `not_configured` honestly. No conversations, agents, or CSAT data is
  fabricated.
- **Acquisition Engine**: per the spec's own architecture, the discovery
  bots, AI research agents, and outreach generation are a **separate
  Python project** (`synkra_outbound/` in the spec) — not part of this
  codebase. What's built here is the CRM/state layer that project calls
  into via `/api/acquisition/*`, worker-authenticated. Until that project
  exists, every number on the Acquisition Engine dashboard is genuinely
  zero — not a bug.

- **Agency Platform**: per `ARCHITECTURE.md` (a separate, dedicated Agency
  PocketBase instance already used by a built Client Portal), Synkra OS
  now implements the "Admin Panel" role that document describes as not
  yet built. `pb_hooks/agency_platform_adapter.pb.js` implements exactly
  the Create/Read/Update/Delete matrix that document's Section 3 grants
  Admin Panel — not more (e.g. it never writes `agency_payments`, which
  only the Client Portal's checkout route and a Paystack webhook may
  touch). Synkra OS's own pre-existing `agency_leads` pipeline (this
  repo's pre-sale pipeline: lead → quotation → paid) now bridges into
  that real instance: the moment NO PAYMENT = NO ONBOARDING clears and a
  lead enters "onboarding," `provisionAgencyPlatformClient()` creates the
  real `clients` + `agency_client_services` rows there, and the returned
  IDs are stored back on the `agency_leads` record for traceability
  (`agency_platform_client_id`/`agency_platform_service_id`). **Known
  gap, stated plainly**: `service_slug`/`tier`/pricing-currency-unit
  mapping in that bridge is a best-effort placeholder — this environment
  has no access to Synkra's real service catalog to confirm those values
  against. Also carried over from that document and not resolved here:
  its own flagged inconsistency that `agency_quote_requests` currently
  lives on a *different* PocketBase instance (Client Hub's) than this one,
  and its explicitly deferred items (pause/cancel job, renewal job,
  usage-credit consumption).

**This still has not been compiled or run.** Treat "Build & verify" below
as the real next step.

### What's implemented

- **Schema**: all collections from the original spec, plus leads/
  follow-ups/email templates & events/integration status/AI job contract/
  acquisition engine CRM. See `pocketbase/pb_migrations/`.
- **Server-side authorization**: permission checks scoped correctly on
  every collection (not just custom routes), atomic mutation+audit
  logging, the "View as Customer" flow, the hard **NO PAYMENT = NO
  ONBOARDING** gate, and a **quotation pricing-exception gate**
  (`AGENCY_STANDARD_PRICING_CEILING_CENTS`) requiring explicit manual
  review before a quote above the ceiling can proceed past "quotation" —
  all enforced in `pocketbase/pb_hooks/`, unbypassable from the client.
- **Every module has a real frontend screen** querying PocketBase or the
  relevant adapter directly (no mock data anywhere): Login, Executive
  Dashboard, Leads, Follow-ups, Customers (search + Customer 360 with
  Communications/Agency relationship/external references/Activity feed),
  Support (including real ticket creation, not just a list), Billing,
  Agency Operations, Email, Flow, Chat, Acquisition Engine, AI Employees
  (with a working human-review queue), Infrastructure, Incidents,
  Deployments, Utilities, Partners, Audit Logs, Integrations (connection
  status for every external system), Settings, and a Quick Actions
  command palette (⌘K/Ctrl+K) where every action is real navigation or a
  real operation.
- **Integration boundaries** for Paystack refunds, Flow, Chat, Resend,
  and the AI worker: each returns an explicit `501` with a clear message
  when credentials aren't configured, rather than faking success.

### Honestly-empty screens (not fake data, not hidden — just no data source yet)

- **Infrastructure**: real Coolify adapter now (see "Integration honesty"
  above) — servers/resource status sync automatically every 5 minutes,
  plus an on-demand "Sync now" button. The "Restart" button stays
  permanently disabled with a tooltip, since no generic restart action is
  wired to Coolify's API yet.
- **Billing**: the invoices/payments screens and the refund action are
  fully wired; refunds work end-to-end IF `PAYSTACK_SECRET_KEY` is set,
  and fail with a clear `501` if not. Invoice/payment *rows* only appear
  once a Zoho Books/Paystack sync worker (not built) populates them.
- **Deployments**: populates once a GitHub/Coolify webhook handler (not
  built) is connected.
- **Flow**: real adapter against Flow's real schema (see "Integration
  honesty" above) for reads; every admin action (suspend, reactivate,
  impersonate, magic-link) honestly refuses until synkra-core builds the
  corresponding endpoint — see the Flow handover doc's Section 4.
- **Chat**: nothing beyond the connection boundary — no backend exists to
  connect to yet.
- **Acquisition Engine**: the CRM/state layer is real and enforced
  (suppression checks, reply-stops-followups, dedup); the numbers are
  zero because the separate Python/AI-agent project that feeds it doesn't
  exist in this codebase.

---

## Architecture

```
┌─────────────────────────────────────────────┐
│  Docker container                            │
│  ┌─────────────────────────────────────────┐ │
│  │ PocketBase (Go binary, port 8090)        │ │
│  │  - serves REST + realtime API            │ │
│  │  - serves pb_hooks/*.pb.js (JS runtime)  │ │
│  │  - serves the built React app as static  │ │
│  │    files from pb_public/ (no nginx)      │ │
│  │  - SQLite data + uploads in pb_data/     │ │
│  │    (mounted as a volume)                 │ │
│  └─────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

One container, one process, one exposed port. This is deliberate: fewer
moving parts to misconfigure in Coolify, and PocketBase's built-in static
file serving means no separate nginx/reverse-proxy container is needed.

## Repository layout

```
pocketbase/
  pb_migrations/   PocketBase schema, as versioned JS migrations
  pb_hooks/        Server-side routes & authorization logic (JS)
frontend/
  src/
    auth/          Auth context (PocketBase session + permission checks)
    components/    Shared UI: AppShell, DataTable, StatusBadge, dialogs
    pages/         One folder per module
    lib/           PocketBase client
    types/         TypeScript types mirroring the schema
Dockerfile         Multi-stage build: frontend -> static files, PocketBase binary
docker-compose.yml Local dev / reference compose file
scripts/
  bootstrap.sh     Creates the first Super Administrator login
  smoke_test.sh    Post-deploy sanity checks
.env.example       All configurable secrets/integration endpoints
```

## Local development

Requires Node 20+ and either a local PocketBase binary or Docker.

```bash
# 1. Get PocketBase running with the schema migrated
docker compose up --build -d
# Migrations in pocketbase/pb_migrations run automatically on first boot.

# 2. Bootstrap the first login
cp .env.example .env   # edit BOOTSTRAP_ADMIN_EMAIL / PASSWORD first
docker exec -it $(docker compose ps -q synkra-os) \
  pocketbase superuser upsert admin@synkra.example 'change-me'
./scripts/bootstrap.sh

# 3. Run the frontend in dev mode (hot reload, proxies /api to :8090)
cd frontend
npm install
npm run dev
# open http://localhost:5173 and log in with the bootstrap credentials
```

## Build & verify (do this before considering it "done")

```bash
# Type-check and build the frontend standalone
cd frontend && npm install && npm run build
cd ..

# Build the full production image
docker build -t synkra-os:latest .

# Run it
docker run -d --name synkra-os -p 8090:8090 \
  -v synkra_pb_data:/pb/pb_data \
  --env-file .env \
  synkra-os:latest

# Bootstrap the first login (see above), then:
PB_URL=http://localhost:8090 ./scripts/smoke_test.sh
```

Fix anything the smoke tests catch before deploying. Watch `docker logs
synkra-os` for migration errors on first boot — PocketBase applies
`pb_migrations/*.js` automatically in filename order.

## Deploying on Coolify

1. Push this repository to GitHub (see `.gitignore` — nothing sensitive is
   tracked).
2. In Coolify: **New Resource → Docker Compose** (or Dockerfile), point it
   at this repo.
3. Set the environment variables from `.env.example` in Coolify's
   environment panel — do not commit a real `.env`.
4. Attach a persistent volume at `/pb/pb_data` (Coolify does this via the
   "Storage" tab) so customer/audit/schema data survives redeploys.
5. Set the health check path to `/health` (Coolify reads the Dockerfile
   `HEALTHCHECK` automatically in most setups, but confirm it in the
   resource's health check settings).
6. First deploy: exec into the running container and run
   `pocketbase superuser upsert <email> <password>`, then run
   `scripts/bootstrap.sh` from a machine that can reach the deployed URL.
7. Run `scripts/smoke_test.sh` against the live URL.

## Security notes

- No public signup: `users.createRule` requires an existing Super
  Administrator. Employee accounts are provisioned deliberately.
- Every dangerous action (suspend, refund, impersonation start/end, agency
  stage change) is a dedicated server route with its own permission check
  and audit-log write — never a raw PATCH the frontend could shape.
- `audit_logs` and `impersonation_sessions` have `createRule: null`:
  nothing can write to them except server-side hook code running with
  superuser context. They cannot be forged via the API.
- Secrets (Paystack, Flow/Chat API keys) are read from environment
  variables at request time inside `pb_hooks/`, never returned to the
  client, never logged, never committed (`.env` is git-ignored).

## Known gaps / honest limitations

- The billing sync worker that would pull real invoice/payment state from
  Zoho Books / Paystack is described in code comments
  (`pocketbase/pb_migrations/1735500004_billing.js`) but not implemented —
  `invoices`/`payments` currently have `createRule: null` and will stay
  empty until that worker exists.
- The infrastructure health-check worker that would populate `servers` /
  `health_checks` is not implemented; the Dashboard correctly shows an
  empty state ("No servers reporting yet") rather than fake data.
- GitHub Actions / CI config was not created in this pass — `npm run
  build` and `docker build` above are the manual equivalent.
