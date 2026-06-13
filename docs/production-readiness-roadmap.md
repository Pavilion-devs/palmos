# PalmOS Production Readiness Roadmap

PalmOS already proves the core product loop: an external agent can authenticate with PalmOS, request a paid service, pass through policy, pause for approval when needed, settle in PUSD, and leave an audit trail.

This document is the next-phase plan for turning the hackathon MVP into a production-grade product without losing the working foundation.

## Guiding Principle

Do not rewrite PalmOS from scratch.

The current architecture has the right shape:

- external agents stay outside PalmOS,
- PalmOS owns credentials, policy, approvals, settlement, and audit,
- PUSD is the primary payment rail,
- OWS and Umbra can remain optional settlement layers,
- the dashboard is the operator control surface,
- the SDK/API is the agent integration surface.

The production path is to harden each layer in place.

## Phase 1: Secure The Demo Surface

Goal: make the current deployed app safe enough for controlled early users.

Priorities:

- Make dashboard authentication default-on outside local development.
- Replace judge-only access with real workspace/operator sessions.
- Keep judge/demo access as an explicit mode, not the default deployed posture.
- Add basic rate limits to dashboard, SDK, onboarding, waitlist, and credential routes.
- Add request body size limits.
- Add structured API error responses for auth, validation, policy denial, and settlement failure.
- Review all env vars and document which are local-only, demo-only, and production-safe.
- Remove stale public fixture data from `frontend/public/showcase-snapshot.json`.
- Stop exporting legacy x402/demo surfaces from the main product API unless intentionally supported.

Definition of done:

- A deployed backend cannot create agents, rotate credentials, approve payments, or register services without authenticated operator access.
- Local development remains easy through an explicit dev mode.

Current progress:

- Dashboard requests now use an explicit JSON body size limit, defaulting to `256kb`.
- In-memory rate limits now protect dashboard auth, judge access, waitlist, onboarding, SDK pay, credential lifecycle, and service registration routes with env-configurable limits.
- Rate limit responses use structured `429` JSON errors with retry metadata.
- Auth, SDK pay, service registration, credential lifecycle, and approval decision failures now use stable API error codes plus human-readable messages.
- Cookie-authenticated dashboard mutations now enforce CSRF origin checks against configured frontend origins and the API origin. Cross-site mutation attempts return `csrf_check_failed`.
- Operational metrics now surface recent HTTP 5xx counts, CSRF rejects, Postgres health failures, backup health failures, and approval execution failures.
- Operational alerts now evaluate those signals from the health/metrics endpoints, dedupe repeated alerts, log structured alert events, and optionally deliver to `PALMOS_ALERT_WEBHOOK_URL`.

## Phase 2: Fix Payment And Policy Correctness

Goal: make money handling strict and predictable.

Priorities:

- Replace `Number`-based amount handling in policy and session budgets with PUSD base-unit parsing.
- Reject malformed, negative, empty, or over-precision amounts before policy evaluation.
- Ensure SDK-provided `amount` cannot silently become `0`.
- Make onboarding preserve the correct recipient wallet per registered service.
- Record the actual payer wallet identity on every real settlement record.
- Separate local-demo receipts from real Solana settlement more explicitly in API responses.
- Add policy tests for:
  - max per call,
  - auto-approval threshold,
  - session budget exhaustion,
  - malformed amount rejection,
  - vendor allowlist denial,
  - registered service recipient binding.

Definition of done:

- Every payment amount is represented internally as validated base units.
- A service cannot change amount, mint, network, recipient, or reference after approval without PalmOS blocking settlement.

## Phase 3: Replace File Persistence

Goal: support concurrent users and reliable state transitions.

Priorities:

- Move agents, credentials, services, paid calls, approvals, readiness reports, alerts, sessions, runs, and wallets to SQLite or Postgres.
- Add migrations.
- Add unique constraints for agent IDs, credential IDs, service IDs, and execution IDs.
- Add transaction boundaries around approval resolution and paid-call continuation.
- Add optimistic concurrency or row locks for credential rotation and approval decisions.
- Store audit events append-only.
- Add backup/export commands for workspaces.

Current progress:

- File-backed registries now use atomic writes with `.bak` recovery support.
- Dashboard storage health, maintenance, backup, restore dry-run, and confirmed restore commands exist for the current file-storage phase.
- Restore validates archive paths before writing and refuses accidental overwrites unless explicitly requested.
- Database selection is now VPS-hosted Postgres for production, with file storage retained for local development.
- Postgres setup notes live in `docs/database/postgres-vps-setup.md`.
- Optional Postgres registry adapters now exist behind the current storage interfaces, selected with `PALMOS_STORAGE_DRIVER=file|postgres`.
- The VPS now has a private `palmos-postgres` container, schema migration `2026-05-15-001`, nightly `pg_dump` backups, and an imported copy of the current file workspace.
- A gated Postgres integration test now covers adapter write/read paths and passed against a dedicated `palmos_test` database on the VPS.
- A Postgres-backed smoke API on `127.0.0.1:4031` passed dashboard judge auth, protected readiness, paid-call reads, and SDK auth with a temporary credential.
- Rollback rehearsal passed by recreating the same isolated API container from Postgres storage back to file storage with matching health counts.
- Production `palmos-api` has been switched to `PALMOS_STORAGE_DRIVER=postgres`, with a final file backup and post-switch dashboard/SDK smoke passing locally on the VPS.
- Postgres backups are now scheduled through `palmos-postgres-backup.timer`, with 14-day retention and a verified manual backup run.
- Restore drill passed on May 16, 2026: `/var/backups/palmos-postgres/palmos-20260516T031702Z.sql.gz` restored into disposable database `palmos_restore_drill_20260516`, app-level verify/migrate passed, key table counts matched production, and the disposable database/env file were removed.
- Dashboard system health now reports Postgres connectivity/schema status and Postgres backup freshness when the Postgres storage driver is enabled.
- Production `palmos-api` now runs the production-facing image tag `palmos-api:postgres-prod-20260517-alerts`.
- The VPS API image now uses `node:24-trixie-slim`; `@xmtp/node-sdk` imports cleanly, but real XMTP client/send testing still fails at gRPC transport, so runtime startup validation disables XMTP until a working gateway/network config is provided.
- Approval resolution now atomically claims pending paid calls before resuming execution, preventing duplicate dashboard approval requests from double-executing the same paid call.
- Duplicate or stale approval decisions now return an explicit `approval_conflict` response and write a failed audit log record instead of disappearing into a generic server error.
- Credential label updates, revoke, rotate, and SDK token last-used updates now use conditional status writes. Stale or duplicate credential mutations return `credential_conflict` and write failed audit records instead of reviving or double-rotating keys.
- Agent policy, settlement, privacy, service allow/unallow, and registered service verify/enable/disable/update mutations now use `updatedAt` compare-and-swap writes. Stale mutations return `agent_conflict` or `service_conflict` and are audit logged as failed.
- Operator update/enable/disable, workspace update, and env operator login last-used updates now use `updatedAt` compare-and-swap writes. Stale admin mutations return `operator_conflict` or `workspace_conflict`; a concurrent disable during login remains blocked as `operator_disabled`.
- Agent lifecycle actions now commit the agent and wallet updates in one Postgres transaction. If the wallet row changed while suspend/reactivate/archive was in progress, the agent update is rolled back and the route returns `wallet_conflict` with a failed audit log.
- Dashboard mutation idempotency now covers approval decisions, agent lifecycle actions, and credential revoke/rotate requests. Duplicate retries with the same idempotency key replay the original response instead of creating ambiguous second mutations; mismatched key reuse returns `idempotency_conflict`.
- Public HTTPS for `api.getpalmos.xyz` is healthy from outside the VPS. TLS appears to terminate upstream before origin nginx, while origin nginx serves the API over HTTP locally.

Recommended path:

- Keep file storage as the local adapter.
- Continue hardening the Postgres adapter behind the existing registry interfaces.
- Document the public HTTPS/proxy topology for `api.getpalmos.xyz`.

Definition of done:

- Two simultaneous approval or credential actions cannot corrupt state or double-execute a paid call.

## Phase 4: Harden Registered Services

Goal: safely let users register arbitrary paid API endpoints.

Priorities:

- Move service registration validation out of `dashboardApi.ts` into a dedicated module.
- Add DNS resolution checks for registered endpoint hosts.
- Block private, loopback, metadata, link-local, and internal networks after DNS resolution.
- Consider an allowlist mode for early production deployments.
- Add outbound request timeouts.
- Add max response body size.
- Disable redirects or revalidate redirect targets.
- Store and show service verification status.
- Add service recipient readiness checks before allowing real payments.
- Add tests for unsafe URLs, redirect behavior, malformed recipients, and disabled services.

Current progress:

- Service registration validation is isolated from `dashboardApi.ts`.
- Registered endpoint validation blocks unsafe hostnames, unsafe IPs, and DNS records resolving to private/internal networks.
- Paid service requests use timeouts, response body limits, and centralized redirect blocking.
- Registered services now carry verification metadata; real settlement is blocked when a registered service is not verified.
- Disabled services are omitted from the executable service catalog.
- Service readiness is centralized for recipient, amount, chain, rail, verification, and endpoint checks before allow-listing and real registered-service settlement.
- Optional endpoint hostname allowlisting is available through `PALMOS_SERVICE_ENDPOINT_ALLOWLIST` for stricter early production deployments.
- Registered services now have explicit backend lifecycle endpoints for verification, disable, and enable, with audit records and persisted verification metadata.

Definition of done:

- A malicious or mistaken registered service cannot make PalmOS call internal infrastructure or silently redirect to unsafe targets.

## Phase 5: Real Workspace And Operator Model

Goal: move from judge/demo access to a real multi-operator product.

Priorities:

- Introduce first-class `Workspace` or `Organization` records.
- Scope agents, services, credentials, approvals, and transactions by workspace.
- Add operator users and roles.
- Add workspace-level settings:
  - default policy templates,
  - default approval route,
  - default settlement preference,
  - SDK/API base URL,
  - system health.
- Add credential ownership and "last used by" context.
- Add audit entries for operator actions, not only agent payment actions.

Definition of done:

- PalmOS can support more than one real customer workspace without shared state or shared secrets.

Current progress:

- Dashboard operators are persisted with workspace ids and roles.
- Owner-only backend operator lifecycle endpoints now exist for create, update, disable, and enable, with audit logging.
- Dashboard audit events include workspace/operator context.
- First-class workspace records now exist in file storage with display name, status, and workspace-level settings.
- `/api/dashboard/session` returns workspace metadata, and `PATCH /api/dashboard/workspace` updates workspace settings with audit logging.

## Phase 6: Production SDK And Agent Integrations

Goal: make PalmOS easy and safe for external agents to adopt.

Priorities:

- Publish `@getpalmos/agent` when the API contract stabilizes.
- Add typed result models for executed, blocked, pending, and failed payments.
- Add retries with idempotency keys for SDK payment requests.
- Add SDK examples for:
  - Claude Code,
  - Codex,
  - plain Node.js agents,
  - server-side research workers.
- Add a minimal MCP/tool-server interface:
  - `list_services`,
  - `request_paid_service`,
  - `check_policy`,
  - `get_agent_status`.
- Document token storage guidance for agent runtimes.

Definition of done:

- An external developer can integrate PalmOS from a clean project without reading the PalmOS repo.

Current progress:

- SDK payment requests now support `Idempotency-Key`/`idempotencyKey`; retries from the same agent replay the existing paid-call execution instead of creating duplicate settlement attempts.
- SDK pay responses now expose typed result models for blocked, approval-pending, waiting, executed, and failed outcomes.
- `@getpalmos/agent` now ships examples for plain Node.js, Claude Code, Codex, and research workers, plus token storage guidance for agent runtimes.
- The SDK API now exposes a minimal named-tool interface for `list_services`, `request_paid_service`, `check_policy`, and `get_agent_status`, with matching `@getpalmos/agent` client helpers.

## Phase 7: Settlement Rail Maturity

Goal: make each settlement mode clear, reliable, and auditable.

Priorities:

- Keep local-demo settlement as local-only.
- Make `real-solana` and `ows` settlement setup explicit per agent.
- Add per-agent funding/readiness views.
- Add per-service recipient readiness views.
- Track payer, recipient, token account, mint, network, signature, confirmation status, and explorer URL in a normalized settlement record.
- Add reconciliation jobs that can refresh settlement status after initial execution.
- Make private settlement a first-class operator-controlled agent mode, backed by Umbra where configured.

Definition of done:

- Operators can tell exactly which rail moved money, which wallet paid, what transaction settled, and whether reconciliation succeeded.

Current progress:

- Paid-call records now include a normalized `settlement` object for completed payments, including rail, mode/source, amount, asset, network, mint, payer/recipient, derived PUSD token accounts when possible, payment reference, signature, confirmation status, confirmation timestamp, and explorer URL.
- Settlement reconciliation helpers and `npm run palmos:settlements` now refresh `confirmationStatus`, `reconciliationStatus`, `reconciledAt`, and reconciliation errors for existing paid-call records, with optional Solana signature verification.
- Authenticated settlement-readiness reporting now summarizes agent settlement setup and per-service readiness for local-demo, real-solana, and OWS modes through `/api/dashboard/system/settlement-readiness`.
- Agent settlement mode can now be changed explicitly through `PATCH /api/dashboard/agents/:agentId/settlement`, with validation, audit logging, and an immediate readiness summary.
- Local-demo settlement is now centrally marked local/development-only and is blocked for production-like execution unless `PALMOS_ALLOW_LOCAL_DEMO_SETTLEMENT_IN_PRODUCTION=1` is deliberately set for a controlled demo.
- Agents now support `privacyMode` (`disabled`, `allowed`, `required`), with an audited `PATCH /api/dashboard/agents/:agentId/privacy` route and fail-closed SDK behavior when private settlement is required but no private route is configured.

## Phase 8: Observability And Operations

Goal: make PalmOS diagnosable when real users depend on it.

Priorities:

- Add structured logs with request IDs.
- Add health checks for database, Solana RPC, PUSD readiness, OWS, XMTP, and local service server.
- Add metrics for:
  - SDK calls,
  - policy denials,
  - approval latency,
  - settlement failures,
  - readiness failures,
  - credential failures.
- Add admin export for audit and transaction history.
- Add runbooks for stuck approvals, failed settlement, bad service registration, and insufficient funds.

Definition of done:

- A failed payment can be debugged from logs, dashboard records, and health checks without guessing.

Current progress:

- Owner-only admin export now returns redacted audit and paid-call history with summary counts for incident review, migration prep, and customer support.
- Dashboard API requests now receive `X-Request-Id` values before body parsing, structured request logs are emitted by default, and structured API errors include request ids for correlation.
- Operations runbooks now exist under `docs/runbooks/` for stuck approvals, failed settlement, bad service registration, insufficient PUSD funds, file storage recovery, unsafe endpoint rejection, and dashboard auth/session issues.
- Authenticated system health now reports file storage, PUSD/Solana config, local PUSD server, OWS, XMTP, and dashboard auth posture without performing network calls.
- Authenticated operational metrics now report process-local SDK counters plus stored paid-call, policy-denial, settlement-failure, approval-latency, readiness-failure, and credential posture metrics.

## Recommended First Sprint

Start with the smallest set of changes that meaningfully moves PalmOS toward production:

1. Default-on dashboard auth outside local dev.
2. Base-unit amount validation in policy and session budgets.
3. Correct per-service recipient handling during onboarding.
4. Remove stale public fixture data and legacy product exports.
5. Add integration tests for SDK pay, approval resume, blocked vendor, and registered service payment.
6. Extract service registration validation into a tested module.

This keeps the current product working while removing the sharpest edges.

## Non-Goals For The Next Sprint

Do not do these yet:

- full rewrite,
- redesign the dashboard from scratch,
- replace the runtime kernel,
- support every chain or token,
- make Umbra the default rail,
- build enterprise admin features before basic auth, persistence, and payment correctness are solved.

## Product North Star

PalmOS should become the payment operating system for external AI agents:

```text
Bring your agent.
Give it a governed PUSD wallet.
Define what it can pay for.
Approve sensitive spend.
Audit every paid action.
```
