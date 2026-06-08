export const PALMOS_POSTGRES_MIGRATION_VERSION = '2026-06-05-001'

export const PALMOS_POSTGRES_SCHEMA_SQL = `
begin;

create extension if not exists pgcrypto;

create table if not exists palmos_schema_migrations (
  version text primary key,
  applied_at timestamptz not null default now(),
  description text not null
);

create table if not exists dashboard_workspaces (
  workspace_id text primary key,
  status text not null,
  updated_at timestamptz not null,
  record jsonb not null
);

create table if not exists dashboard_operators (
  operator_id text primary key,
  workspace_id text not null,
  role text not null,
  status text not null,
  updated_at timestamptz not null,
  record jsonb not null
);

create table if not exists wallets (
  wallet_id text primary key,
  organization_id text,
  treasury_id text,
  subject_id text,
  address text,
  updated_at timestamptz not null,
  record jsonb not null
);

create table if not exists agents (
  agent_id text primary key,
  actor_id text not null,
  wallet_id text,
  status text not null,
  privacy_mode text not null default 'disabled',
  updated_at timestamptz not null,
  record jsonb not null
);

create table if not exists agent_credentials (
  credential_id text primary key,
  agent_id text not null references agents(agent_id) on delete cascade,
  key_hash text not null,
  status text not null,
  updated_at timestamptz not null,
  record jsonb not null
);

create table if not exists registered_services (
  service_id text primary key,
  vendor_id text not null,
  status text not null,
  verification_status text,
  updated_at timestamptz not null,
  record jsonb not null
);

create table if not exists paid_calls (
  execution_id text primary key,
  agent_id text not null references agents(agent_id) on delete restrict,
  service_id text not null,
  status text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  record jsonb not null
);

create table if not exists action_requests (
  action_request_id text primary key,
  agent_id text not null references agents(agent_id) on delete restrict,
  source text,
  kind text not null,
  status text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  record jsonb not null
);

alter table action_requests add column if not exists source text;
update action_requests
set source = coalesce(source, record->>'source', 'system');
update action_requests
set record = jsonb_set(record, '{source}', to_jsonb(source), true)
where record->>'source' is distinct from source;
alter table action_requests alter column source set default 'system';
alter table action_requests alter column source set not null;

create table if not exists dashboard_audit_logs (
  audit_log_id text primary key,
  workspace_id text not null,
  at timestamptz not null,
  action text not null,
  target_type text,
  target_id text,
  record jsonb not null
);

create table if not exists agent_control_events (
  control_event_id text primary key,
  agent_id text not null references agents(agent_id) on delete cascade,
  at timestamptz not null,
  record jsonb not null
);

create table if not exists xmtp_alerts (
  alert_id text primary key,
  agent_id text,
  execution_id text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  record jsonb not null
);

create table if not exists ows_access (
  agent_id text primary key references agents(agent_id) on delete cascade,
  updated_at timestamptz not null,
  record jsonb not null
);

create table if not exists pusd_readiness_reports (
  report_id text primary key,
  agent_id text,
  service_id text,
  wallet_name text,
  ok boolean not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  record jsonb not null
);

create table if not exists runtime_sessions (
  session_id text primary key,
  updated_at timestamptz not null,
  record jsonb not null
);

create table if not exists runtime_runs (
  run_id text primary key,
  session_id text not null,
  last_updated_at timestamptz not null,
  record jsonb not null
);

create table if not exists runtime_transcript_entries (
  entry_id text primary key,
  session_id text not null,
  run_id text,
  at timestamptz not null,
  record jsonb not null
);

create table if not exists runtime_ledger_events (
  event_id text primary key,
  run_id text not null,
  at timestamptz not null,
  record jsonb not null
);

create table if not exists runtime_artifacts (
  artifact_id text primary key,
  artifact_type text not null,
  path text not null,
  hash text,
  data jsonb,
  record jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists private_settlement_requests (
  private_settlement_id text primary key,
  workspace_id text not null,
  agent_id text not null references agents(agent_id) on delete restrict,
  execution_id text references paid_calls(execution_id) on delete set null,
  status text not null,
  privacy_mode text not null,
  amount text not null,
  asset_symbol text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  record jsonb not null
);

create table if not exists sdk_idempotency_keys (
  agent_id text not null references agents(agent_id) on delete cascade,
  idempotency_key_hash text not null,
  execution_id text not null references paid_calls(execution_id) on delete cascade,
  request_hash text not null,
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  primary key (agent_id, idempotency_key_hash),
  unique (execution_id)
);

create unique index if not exists agent_credentials_key_hash_idx on agent_credentials(key_hash);
create index if not exists dashboard_operators_workspace_idx on dashboard_operators(workspace_id);
create index if not exists wallets_org_idx on wallets(organization_id);
create index if not exists wallets_treasury_idx on wallets(treasury_id);
create index if not exists agents_actor_idx on agents(actor_id);
create index if not exists agents_wallet_idx on agents(wallet_id);
create index if not exists agents_status_idx on agents(status);
create index if not exists agents_privacy_idx on agents(privacy_mode);
create index if not exists credentials_agent_idx on agent_credentials(agent_id);
create index if not exists services_status_idx on registered_services(status, verification_status);
create index if not exists paid_calls_agent_created_idx on paid_calls(agent_id, created_at desc);
create index if not exists paid_calls_status_idx on paid_calls(status);
create index if not exists action_requests_agent_created_idx on action_requests(agent_id, created_at desc);
create index if not exists action_requests_agent_updated_idx on action_requests(agent_id, updated_at desc);
create index if not exists action_requests_status_idx on action_requests(status);
create index if not exists action_requests_kind_idx on action_requests(kind);
create index if not exists action_requests_source_idx on action_requests(source);
drop index if exists action_requests_effective_source_idx;
create index if not exists audit_workspace_at_idx on dashboard_audit_logs(workspace_id, at desc);
create index if not exists audit_action_idx on dashboard_audit_logs(action);
create index if not exists control_events_agent_at_idx on agent_control_events(agent_id, at desc);
create index if not exists xmtp_alerts_agent_created_idx on xmtp_alerts(agent_id, created_at desc);
create index if not exists readiness_updated_idx on pusd_readiness_reports(updated_at desc);
create index if not exists runtime_runs_session_idx on runtime_runs(session_id);
create index if not exists transcript_session_at_idx on runtime_transcript_entries(session_id, at);
create index if not exists ledger_run_at_idx on runtime_ledger_events(run_id, at);
create index if not exists private_settlement_agent_idx on private_settlement_requests(agent_id, created_at desc);
create index if not exists private_settlement_status_idx on private_settlement_requests(status);

insert into palmos_schema_migrations (version, description)
values ('${PALMOS_POSTGRES_MIGRATION_VERSION}', 'Materialize ActionRequest source fully and simplify source-filtered query reads in the PalmOS Postgres schema')
on conflict (version) do nothing;

commit;
`
