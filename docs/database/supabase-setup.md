# Supabase Postgres Setup

Status: superseded for the current PalmOS production rollout. Use
[`postgres-vps-setup.md`](./postgres-vps-setup.md) for the Tierhive VPS path.

This is the production database target for PalmOS. Keep the current file-backed
storage for local development until the Supabase adapter is wired and verified.

## Create The Database

1. Create a Supabase project.
2. Open the Supabase SQL editor.
3. Run [`supabase-schema.sql`](./supabase-schema.sql).
4. Confirm `palmos_schema_migrations` contains:

```text
2026-05-14-001
```

The schema enables RLS on every app table and intentionally creates no public
anon policies. PalmOS should access these tables from the backend only.

## Values To Send Back

Send these from Supabase Project Settings:

```env
PALMOS_SUPABASE_URL=https://<project-ref>.supabase.co
PALMOS_SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
PALMOS_SUPABASE_SCHEMA=public
```

Optional, only if you want me to run migrations from the terminal instead of
you using the SQL editor:

```env
PALMOS_SUPABASE_DATABASE_URL=postgresql://postgres.<project-ref>:<password>@aws-<region>.pooler.supabase.com:6543/postgres?sslmode=require
```

Do not send the database password unless you want terminal-driven migrations.
Do not put the service-role key in frontend env vars.

## What This Schema Covers

- dashboard workspaces and operators
- agents, wallets, signer profiles, policies, privacy mode
- SDK credentials with hashes only
- registered paid services
- paid calls and normalized settlement records
- Umbra/private settlement metadata and durable private settlement requests
- SDK payment idempotency locks
- dashboard audit logs
- control events, XMTP alerts, PUSD readiness reports
- runtime sessions, runs, transcripts, ledger events, and artifacts
- waitlist submissions

## Adapter Plan

After the project values are available:

1. Add a Supabase storage adapter behind the existing registry interfaces.
2. Keep JSON/file storage as the default local adapter.
3. Add `PALMOS_STORAGE_DRIVER=file|supabase`.
4. Wire production to Supabase only when `PALMOS_STORAGE_DRIVER=supabase`.
5. Add a migration/export command from local JSON records into Postgres.
6. Run the current test suite against file storage, then add focused adapter
   tests for agents, credentials, paid calls, services, audit, and idempotency.
