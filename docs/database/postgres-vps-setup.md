# VPS Postgres Setup

PalmOS now targets plain Postgres for production storage on the Tierhive VPS.
Supabase is no longer required.

## Runtime Env

Use file storage by default:

```env
PALMOS_STORAGE_DRIVER=file
```

Use Postgres only after migrations, import, and rollback checks pass:

```env
PALMOS_STORAGE_DRIVER=postgres
PALMOS_DATABASE_URL=postgresql://palmos_app:<password>@palmos-postgres:5432/palmos
```

`PALMOS_DATABASE_URL` is backend-only. Never expose it to frontend builds.

## Migration Commands

Verify DB connectivity:

```bash
npm run palmos:postgres -- verify
```

Create/update tables:

```bash
npm run palmos:postgres -- migrate
```

Import the existing file workspace without deleting it:

```bash
AGENT_SPEND_OS_BASE_DIR=/var/lib/palmos/judge npm run palmos:postgres -- import-file
```

The migration SQL lives in [`src/storage/postgres/schema.ts`](../../src/storage/postgres/schema.ts).
It creates JSON-backed tables with indexed lookup columns for the current
registry interfaces.

## Integration Test

Normal local tests skip Postgres unless a dedicated test database is supplied:

```bash
PALMOS_TEST_DATABASE_URL=postgresql://palmos_app:<password>@palmos-postgres:5432/palmos_test \
  node --import tsx --test tests/postgres.test.ts
```

The test refuses to run destructively unless `current_database()` contains
`test`.

## VPS Rollout Order

1. Back up `/var/lib/palmos/judge`.
2. Start Postgres on a private Docker network.
3. Create database `palmos` and user `palmos_app`.
4. Generate a strong password on the VPS.
5. Add `PALMOS_DATABASE_URL` only to the backend env.
6. Run `migrate`.
7. Run `import-file`.
8. Start a test backend container with `PALMOS_STORAGE_DRIVER=postgres`.
9. Verify health, dashboard data, SDK auth, and paid-call reads.
10. Switch the production container only after verification.

Rollback is intentionally simple: set `PALMOS_STORAGE_DRIVER=file` and restart
the API container. The file workspace remains untouched.

## Backups

Use nightly `pg_dump` into:

```text
/var/backups/palmos-postgres
```

The VPS uses a systemd timer:

```bash
systemctl status palmos-postgres-backup.timer
systemctl list-timers palmos-postgres-backup.timer
```

The backup service runs:

```bash
/usr/local/sbin/palmos-postgres-backup
```

Backups are retained for 14 days. Postgres must not expose port `5432`
publicly.

The backup service should also write a non-secret freshness marker to the
mounted PalmOS workspace so API health can report whether the latest backup is
fresh:

```text
/var/lib/palmos/judge/postgres-backup-status.json
```

## Current VPS Verification

- `palmos-postgres` is running on Docker network `palmos-private`.
- No Postgres port is published publicly.
- `/var/lib/palmos/judge` was backed up before import.
- Migration `2026-05-15-001` was applied.
- The file workspace was imported into Postgres.
- A separate `palmos-api-postgres-test` container was started on
  `127.0.0.1:4031`, returned healthy data, and was stopped.
- `tests/postgres.test.ts` passed against dedicated database `palmos_test`.
- Postgres-backed API smoke passed for judge dashboard auth, protected
  settlement-readiness access, paid-call reads, and SDK auth with a temporary
  credential that was removed after the test.
- Rollback rehearsal passed with an isolated localhost-only API container:
  `PALMOS_STORAGE_DRIVER=postgres` returned healthy data, then the same
  container was recreated with `PALMOS_STORAGE_DRIVER=file` and returned the
  same health counts from the JSON workspace.
- Production `palmos-api` is now running with `PALMOS_STORAGE_DRIVER=postgres`
  on image `palmos-api:postgres-prod-20260517-alerts`.
- Nightly Postgres backup is scheduled through
  `palmos-postgres-backup.timer`; a manual run created
  `/var/backups/palmos-postgres/palmos-20260515T214118Z.sql.gz`.
- Restore drill passed on May 16, 2026:
  - restored `/var/backups/palmos-postgres/palmos-20260516T031702Z.sql.gz`
    into disposable database `palmos_restore_drill_20260516`;
  - `npm run palmos:postgres -- verify` passed against the restored database;
  - `npm run palmos:postgres -- migrate` was idempotent against the restored
    database;
  - exact counts matched production for workspaces, operators, wallets, agents,
    credentials, services, paid calls, audit logs, runtime sessions, runtime
    runs, XMTP alerts, and readiness reports;
  - app-read smoke against the restored database returned `agents=4`,
    `wallets=4`, `paidCalls=4`, and `workspaces=1`;
  - disposable restore database and temporary restore env file were removed.
- Dashboard system health reports Postgres connectivity/schema status and reads
  backup freshness from `postgres-backup-status.json`.
- Postgres credential writes now use conditional status updates for label
  changes, revoke, rotate, and token last-used touches. Stale credential
  mutations return `credential_conflict` and are audit logged as failed.
- Agent and registered service mutations now use Postgres `updated_at`
  compare-and-swap updates for policy, settlement, privacy, service allow,
  service unallow, service verify, service enable, service disable, and
  registered service updates. Stale writes return `agent_conflict` or
  `service_conflict` and are audit logged as failed.
- Operator update, operator enable, operator disable, workspace update, and env
  operator login last-used writes now use Postgres `updated_at`
  compare-and-swap updates. Stale admin writes return `operator_conflict` or
  `workspace_conflict`; concurrent operator disables during login remain blocked
  as `operator_disabled`.
- Agent lifecycle actions now update the agent row and linked wallet row inside
  one Postgres transaction. If the wallet row is stale, the transaction rolls
  back the agent update and the API returns `wallet_conflict` with a failed
  audit log.
- Dashboard mutation idempotency now covers approval decisions, agent lifecycle
  actions, and credential revoke/rotate requests. Duplicate retries with the
  same idempotency key replay the original response; mismatched key reuse
  returns `idempotency_conflict`.
- Cookie-authenticated dashboard mutations now enforce CSRF origin checks
  against configured frontend origins and the API origin. Cross-site mutation
  attempts return `csrf_check_failed`.
- Operational metrics now expose recent HTTP 5xx counts, CSRF rejects,
  Postgres connection health failures, backup health failures, and approval
  execution failures.
- Operational alerts now evaluate health/metrics signals, dedupe repeated
  alerts, log structured `dashboard.alert` events, and optionally deliver to
  `PALMOS_ALERT_WEBHOOK_URL`.
- A post-deploy public HTTPS smoke confirmed
  `https://api.getpalmos.xyz/api/dashboard/health` returns healthy data and
  unauthenticated dashboard snapshots remain blocked.
- Final pre-switch file backup:
  `/var/backups/palmos-file-workspace/palmos-judge-prod-flip-20260515T200544Z.tgz`.
- Post-switch production smoke passed over localhost/nginx for dashboard judge
  auth, protected readiness, paid-call reads, and SDK auth with a temporary
  credential that was removed after the test.
- Public HTTPS to `https://api.getpalmos.xyz/api/dashboard/health` is healthy.
  TLS appears to be terminated upstream before requests reach origin nginx;
  origin nginx currently serves the API over HTTP on the VPS.

## Production Switch

The live `palmos-api` container has been switched to Postgres storage. Future
production switches should:

1. Back up `/var/lib/palmos/judge` again.
2. Run `npm run palmos:postgres -- import-file` one final time so Postgres has
   the latest file workspace state.
3. Recreate `palmos-api` from the Postgres-ready image with:

```env
PALMOS_STORAGE_DRIVER=postgres
PALMOS_DATABASE_URL=postgresql://palmos_app:<password>@palmos-postgres:5432/palmos
```

4. Keep the same volume mount for rollback:

```text
/var/lib/palmos/judge:/var/data/palmos-live
```

5. Verify `https://api.getpalmos.xyz/api/dashboard/health`.

Rollback is to recreate `palmos-api` with:

```env
PALMOS_STORAGE_DRIVER=file
```

and the same `/var/lib/palmos/judge:/var/data/palmos-live` mount.
