-- PalmOS production schema for Supabase Postgres.
-- Run this in the Supabase SQL editor for the production project.
-- The app server should connect with the service-role key only. Do not expose it
-- to the frontend or to agent runtimes.

begin;

create extension if not exists pgcrypto;

create table if not exists palmos_schema_migrations (
  version text primary key,
  applied_at timestamptz not null default now(),
  description text not null
);

insert into palmos_schema_migrations (version, description)
values ('2026-05-14-001', 'Initial PalmOS production schema')
on conflict (version) do nothing;

create or replace function palmos_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists dashboard_workspaces (
  workspace_id text primary key,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  display_name text not null,
  status text not null check (status in ('active', 'disabled')),
  settings jsonb not null default '{}'::jsonb,
  record jsonb not null default '{}'::jsonb,
  constraint dashboard_workspaces_settings_object check (jsonb_typeof(settings) = 'object')
);

create table if not exists dashboard_operators (
  operator_id text primary key,
  workspace_id text not null references dashboard_workspaces(workspace_id) on delete cascade,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  display_name text not null,
  role text not null check (role in ('owner', 'operator', 'viewer', 'judge')),
  status text not null check (status in ('active', 'disabled')),
  source text not null check (source in ('env', 'judge')),
  last_login_at timestamptz,
  record jsonb not null default '{}'::jsonb
);

create table if not exists wallets (
  wallet_id text primary key,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  state text not null,
  organization_id text,
  treasury_id text,
  subject_id text,
  wallet_type text,
  address text,
  supported_chains text[] not null default '{}',
  signer_profile_id text,
  provider_id text,
  provider_wallet_id text,
  provider_wallet_name text,
  provider_vault_path text,
  compliance_status text not null,
  policy_attachment_status text not null,
  signer_health_status text not null,
  trust_status text not null,
  record jsonb not null default '{}'::jsonb
);

create table if not exists signer_profiles (
  signer_profile_id text primary key,
  signer_class text not null,
  adapter_id text not null,
  account_refs jsonb not null default '{}'::jsonb,
  supported_chains text[] not null default '{}',
  capabilities jsonb not null default '{}'::jsonb,
  auth_ref text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  record jsonb not null default '{}'::jsonb,
  constraint signer_profiles_account_refs_object check (jsonb_typeof(account_refs) = 'object'),
  constraint signer_profiles_capabilities_object check (jsonb_typeof(capabilities) = 'object')
);

create table if not exists agents (
  agent_id text primary key,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  display_name text not null,
  organization_id text not null,
  treasury_id text,
  environment text not null check (environment in ('production', 'staging', 'test')),
  actor_id text not null,
  session_id text not null,
  wallet_type text not null,
  settlement_mode text check (settlement_mode in ('local-demo', 'ows', 'real-solana')),
  wallet_id text references wallets(wallet_id) on delete set null,
  wallet_state text,
  signer_profile_id text references signer_profiles(signer_profile_id) on delete set null,
  policy_profile_id text,
  wallet_backend text check (wallet_backend in ('runtime', 'ows')),
  ows_wallet_id text,
  ows_wallet_name text,
  ows_api_key_id text,
  ows_vault_path text,
  policy_config jsonb not null,
  privacy_mode text generated always as (
    coalesce(
      policy_config->>'privacyMode',
      case when policy_config ? 'umbra' then 'allowed' else 'disabled' end
    )
  ) stored,
  trust_tier text not null check (trust_tier in ('new', 'healthy', 'trusted', 'restricted')),
  status text not null check (
    status in (
      'draft',
      'wallet_pending',
      'ready',
      'approval_pending',
      'restricted',
      'suspended',
      'archived',
      'stale',
      'failed'
    )
  ),
  last_check_in_at timestamptz not null,
  xmtp_inbox_id text,
  record jsonb not null default '{}'::jsonb,
  constraint agents_policy_config_object check (jsonb_typeof(policy_config) = 'object'),
  constraint agents_privacy_mode_valid check (privacy_mode in ('disabled', 'allowed', 'required'))
);

create table if not exists agent_credentials (
  credential_id text primary key,
  agent_id text not null references agents(agent_id) on delete cascade,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  label text not null,
  key_prefix text not null,
  key_hash text not null,
  status text not null check (status in ('active', 'revoked')),
  last_used_at timestamptz,
  record jsonb not null default '{}'::jsonb
);

create table if not exists registered_services (
  service_id text primary key,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  label text not null,
  vendor_id text not null,
  destination_address text not null,
  endpoint_url text not null,
  method text not null check (method in ('GET', 'POST')),
  request_mode text not null check (request_mode in ('query', 'json')),
  expected_amount text not null,
  chain_id text not null,
  status text not null check (status in ('active', 'disabled')),
  verification_status text check (verification_status in ('verified', 'failed', 'unchecked')),
  verified_at timestamptz,
  last_verification_error text,
  record jsonb not null default '{}'::jsonb
);

create table if not exists paid_calls (
  execution_id text primary key,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  agent_id text not null references agents(agent_id) on delete restrict,
  service_id text not null,
  vendor_id text not null,
  payment_rail text not null check (payment_rail in ('x402', 'palmos-pusd', 'umbra')),
  settlement_mode text check (settlement_mode in ('local-demo', 'ows', 'real-solana', 'umbra')),
  amount text not null,
  asset_symbol text not null,
  chain_id text,
  transaction_signature text,
  transaction_explorer_url text,
  status text not null check (
    status in ('blocked', 'approval_pending', 'waiting_for_execution', 'executed', 'failed')
  ),
  run_id text,
  session_id text,
  wallet_id text,
  runtime_status text,
  runtime_phase text,
  request_payload jsonb not null default '{}'::jsonb,
  request_summary jsonb not null default '{}'::jsonb,
  request_url text,
  response_status integer,
  response_headers jsonb,
  response_preview jsonb,
  error_code text,
  error_message text,
  record jsonb not null default '{}'::jsonb,
  constraint paid_calls_request_payload_object check (jsonb_typeof(request_payload) = 'object'),
  constraint paid_calls_request_summary_object check (jsonb_typeof(request_summary) = 'object')
);

create table if not exists paid_call_settlements (
  execution_id text primary key references paid_calls(execution_id) on delete cascade,
  rail text not null check (rail in ('x402', 'palmos-pusd', 'umbra')),
  mode text,
  source text not null check (source in ('local-demo', 'real-solana', 'ows', 'x402', 'umbra', 'unknown')),
  amount text not null,
  asset_symbol text not null,
  network text,
  mint text,
  payer text,
  payer_token_account text,
  recipient text,
  recipient_token_account text,
  reference text,
  signature text,
  explorer_url text,
  confirmation_status text not null check (
    confirmation_status in ('not_applicable', 'pending', 'confirmed', 'failed', 'unknown')
  ),
  confirmed_at timestamptz,
  reconciliation_status text check (
    reconciliation_status in ('matched', 'pending', 'failed', 'not_applicable', 'not_supported')
  ),
  reconciled_at timestamptz,
  reconciliation_error text,
  settlement jsonb not null default '{}'::jsonb
);

create table if not exists umbra_settlement_metadata (
  execution_id text primary key references paid_calls(execution_id) on delete cascade,
  settlement_rail text not null check (settlement_rail = 'umbra'),
  privacy_path text not null,
  network text not null,
  asset_symbol text not null,
  mint text not null,
  amount text not null,
  final_transaction_signature text,
  funding_transaction_signatures text[] not null default '{}',
  create_utxo_transaction_signatures text[] not null default '{}',
  claim_transaction_signatures text[] not null default '{}',
  report_id text,
  reconciliation_status text check (reconciliation_status in ('matched', 'unmatched', 'pending', 'failed')),
  disclosure_posture text check (
    disclosure_posture in ('artifact_only', 'viewing_key_available', 'not_supported')
  ),
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists private_settlement_requests (
  private_settlement_id text primary key,
  workspace_id text not null references dashboard_workspaces(workspace_id) on delete cascade,
  agent_id text not null references agents(agent_id) on delete restrict,
  execution_id text references paid_calls(execution_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  privacy_mode text not null check (privacy_mode in ('allowed', 'required')),
  status text not null check (
    status in ('requested', 'approval_pending', 'settling', 'settled', 'failed', 'cancelled')
  ),
  payment_rail text not null default 'umbra' check (payment_rail = 'umbra'),
  amount text not null,
  asset_symbol text not null,
  network text,
  recipient_commitment text,
  disclosure_posture text,
  public_metadata jsonb not null default '{}'::jsonb,
  private_metadata jsonb not null default '{}'::jsonb
);

create table if not exists sdk_idempotency_keys (
  agent_id text not null references agents(agent_id) on delete cascade,
  idempotency_key_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  execution_id text not null references paid_calls(execution_id) on delete cascade,
  request_hash text not null,
  status text not null check (status in ('in_progress', 'completed', 'failed')),
  expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  primary key (agent_id, idempotency_key_hash),
  unique (execution_id)
);

create table if not exists dashboard_audit_logs (
  audit_log_id text primary key,
  at timestamptz not null,
  workspace_id text not null references dashboard_workspaces(workspace_id) on delete cascade,
  actor_id text not null,
  operator_id text not null,
  operator_role text not null check (operator_role in ('owner', 'operator', 'viewer', 'judge')),
  source text not null check (source in ('env', 'judge')),
  action text not null,
  status text not null check (status = 'succeeded'),
  target_type text,
  target_id text,
  summary text not null,
  metadata jsonb not null default '{}'::jsonb,
  record jsonb not null default '{}'::jsonb
);

create table if not exists agent_control_events (
  control_event_id text primary key,
  at timestamptz not null,
  agent_id text not null references agents(agent_id) on delete cascade,
  type text not null check (type = 'dead_man_switch.triggered'),
  status text not null check (status in ('applied', 'noop')),
  summary text not null,
  refs jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  record jsonb not null default '{}'::jsonb
);

create table if not exists xmtp_alerts (
  alert_id text primary key,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  type text not null check (
    type in ('approval.requested', 'approval.resolved', 'dead_man_switch.triggered')
  ),
  status text not null check (status in ('sent', 'skipped', 'failed')),
  agent_id text references agents(agent_id) on delete set null,
  run_id text,
  execution_id text references paid_calls(execution_id) on delete set null,
  control_event_id text references agent_control_events(control_event_id) on delete set null,
  recipient_inbox_id text,
  recipient_address text,
  conversation_id text,
  message_id text,
  message_preview text not null,
  reason text,
  record jsonb not null default '{}'::jsonb
);

create table if not exists ows_access (
  agent_id text primary key references agents(agent_id) on delete cascade,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  runtime_wallet_id text not null,
  ows_wallet_id text not null,
  ows_wallet_name text not null,
  vault_path text not null,
  api_key_id text,
  api_key_name text,
  api_key_token_secret_ref text,
  api_key_token_ciphertext text,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists pusd_readiness_reports (
  report_id text primary key,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  agent_id text references agents(agent_id) on delete set null,
  service_id text,
  wallet_name text,
  ok boolean not null,
  report jsonb not null,
  record jsonb not null default '{}'::jsonb
);

create table if not exists waitlist_submissions (
  id text primary key,
  created_at timestamptz not null,
  name text not null,
  email text not null,
  role_company text not null,
  agent_use_case text not null,
  source text not null check (source = 'landing'),
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists runtime_sessions (
  session_id text primary key,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  mode text not null,
  environment text not null check (environment in ('production', 'staging', 'test')),
  organization_id text,
  treasury_ids text[] not null default '{}',
  wallet_ids text[] not null default '{}',
  actor_id text not null,
  role_ids text[] not null default '{}',
  active_run_id text,
  run_ids text[] not null default '{}',
  pending_approval_run_ids text[] not null default '{}',
  pending_signature_run_ids text[] not null default '{}',
  pending_confirmation_run_ids text[] not null default '{}',
  halted boolean not null default false,
  transcript_ref text not null,
  state jsonb not null default '{}'::jsonb
);

create table if not exists runtime_runs (
  run_id text primary key,
  session_id text not null references runtime_sessions(session_id) on delete cascade,
  action_type text not null,
  status text not null,
  current_phase text not null,
  intent_ref jsonb,
  policy_ref jsonb,
  approval_state_ref text,
  simulation_refs text[] not null default '{}',
  signature_request_refs text[] not null default '{}',
  signature_result_refs text[] not null default '{}',
  broadcast_refs text[] not null default '{}',
  artifact_paths jsonb not null default '{}'::jsonb,
  report_ref text,
  last_updated_at timestamptz not null,
  state jsonb not null default '{}'::jsonb
);

create table if not exists runtime_transcript_entries (
  entry_id text primary key,
  at timestamptz not null,
  session_id text not null references runtime_sessions(session_id) on delete cascade,
  run_id text references runtime_runs(run_id) on delete set null,
  role text not null check (role in ('operator', 'assistant', 'system')),
  content text not null,
  entry jsonb not null default '{}'::jsonb
);

create table if not exists runtime_ledger_events (
  ledger_event_id text primary key default encode(gen_random_bytes(16), 'hex'),
  run_id text not null references runtime_runs(run_id) on delete cascade,
  at timestamptz not null default now(),
  event_type text,
  event jsonb not null,
  event_hash text
);

create table if not exists runtime_artifacts (
  artifact_id text primary key,
  run_id text references runtime_runs(run_id) on delete cascade,
  artifact_type text not null,
  path text,
  hash text,
  data jsonb,
  created_at timestamptz not null default now(),
  ref jsonb not null default '{}'::jsonb
);

create index if not exists dashboard_operators_workspace_idx on dashboard_operators(workspace_id);
create index if not exists agents_actor_id_idx on agents(actor_id);
create index if not exists agents_wallet_id_idx on agents(wallet_id);
create index if not exists agents_status_idx on agents(status);
create index if not exists agents_privacy_mode_idx on agents(privacy_mode);
create index if not exists agent_credentials_agent_id_idx on agent_credentials(agent_id);
create unique index if not exists agent_credentials_key_hash_idx on agent_credentials(key_hash);
create index if not exists services_vendor_idx on registered_services(vendor_id);
create index if not exists services_status_idx on registered_services(status, verification_status);
create index if not exists paid_calls_agent_created_idx on paid_calls(agent_id, created_at desc);
create index if not exists paid_calls_status_idx on paid_calls(status);
create index if not exists paid_calls_service_idx on paid_calls(service_id);
create index if not exists paid_calls_run_idx on paid_calls(run_id);
create index if not exists settlements_signature_idx on paid_call_settlements(signature);
create index if not exists umbra_final_signature_idx on umbra_settlement_metadata(final_transaction_signature);
create index if not exists private_settlement_agent_idx on private_settlement_requests(agent_id, created_at desc);
create index if not exists private_settlement_status_idx on private_settlement_requests(status);
create index if not exists audit_workspace_at_idx on dashboard_audit_logs(workspace_id, at desc);
create index if not exists audit_action_idx on dashboard_audit_logs(action);
create index if not exists control_events_agent_at_idx on agent_control_events(agent_id, at desc);
create index if not exists xmtp_alerts_agent_created_idx on xmtp_alerts(agent_id, created_at desc);
create index if not exists pusd_readiness_updated_idx on pusd_readiness_reports(updated_at desc);
create unique index if not exists waitlist_submissions_email_idx on waitlist_submissions(lower(email));
create index if not exists runtime_runs_session_idx on runtime_runs(session_id);
create index if not exists runtime_transcript_session_idx on runtime_transcript_entries(session_id, at);
create index if not exists runtime_ledger_run_idx on runtime_ledger_events(run_id, at);
create index if not exists runtime_artifacts_run_idx on runtime_artifacts(run_id);

create index if not exists agents_policy_config_gin_idx on agents using gin (policy_config);
create index if not exists paid_calls_request_payload_gin_idx on paid_calls using gin (request_payload);
create index if not exists audit_metadata_gin_idx on dashboard_audit_logs using gin (metadata);

drop trigger if exists dashboard_workspaces_set_updated_at on dashboard_workspaces;
create trigger dashboard_workspaces_set_updated_at
before update on dashboard_workspaces
for each row execute function palmos_set_updated_at();

drop trigger if exists dashboard_operators_set_updated_at on dashboard_operators;
create trigger dashboard_operators_set_updated_at
before update on dashboard_operators
for each row execute function palmos_set_updated_at();

drop trigger if exists wallets_set_updated_at on wallets;
create trigger wallets_set_updated_at
before update on wallets
for each row execute function palmos_set_updated_at();

drop trigger if exists signer_profiles_set_updated_at on signer_profiles;
create trigger signer_profiles_set_updated_at
before update on signer_profiles
for each row execute function palmos_set_updated_at();

drop trigger if exists agents_set_updated_at on agents;
create trigger agents_set_updated_at
before update on agents
for each row execute function palmos_set_updated_at();

drop trigger if exists agent_credentials_set_updated_at on agent_credentials;
create trigger agent_credentials_set_updated_at
before update on agent_credentials
for each row execute function palmos_set_updated_at();

drop trigger if exists registered_services_set_updated_at on registered_services;
create trigger registered_services_set_updated_at
before update on registered_services
for each row execute function palmos_set_updated_at();

drop trigger if exists paid_calls_set_updated_at on paid_calls;
create trigger paid_calls_set_updated_at
before update on paid_calls
for each row execute function palmos_set_updated_at();

drop trigger if exists private_settlement_requests_set_updated_at on private_settlement_requests;
create trigger private_settlement_requests_set_updated_at
before update on private_settlement_requests
for each row execute function palmos_set_updated_at();

drop trigger if exists sdk_idempotency_keys_set_updated_at on sdk_idempotency_keys;
create trigger sdk_idempotency_keys_set_updated_at
before update on sdk_idempotency_keys
for each row execute function palmos_set_updated_at();

drop trigger if exists xmtp_alerts_set_updated_at on xmtp_alerts;
create trigger xmtp_alerts_set_updated_at
before update on xmtp_alerts
for each row execute function palmos_set_updated_at();

drop trigger if exists ows_access_set_updated_at on ows_access;
create trigger ows_access_set_updated_at
before update on ows_access
for each row execute function palmos_set_updated_at();

drop trigger if exists pusd_readiness_reports_set_updated_at on pusd_readiness_reports;
create trigger pusd_readiness_reports_set_updated_at
before update on pusd_readiness_reports
for each row execute function palmos_set_updated_at();

alter table dashboard_workspaces enable row level security;
alter table dashboard_operators enable row level security;
alter table wallets enable row level security;
alter table signer_profiles enable row level security;
alter table agents enable row level security;
alter table agent_credentials enable row level security;
alter table registered_services enable row level security;
alter table paid_calls enable row level security;
alter table paid_call_settlements enable row level security;
alter table umbra_settlement_metadata enable row level security;
alter table private_settlement_requests enable row level security;
alter table sdk_idempotency_keys enable row level security;
alter table dashboard_audit_logs enable row level security;
alter table agent_control_events enable row level security;
alter table xmtp_alerts enable row level security;
alter table ows_access enable row level security;
alter table pusd_readiness_reports enable row level security;
alter table waitlist_submissions enable row level security;
alter table runtime_sessions enable row level security;
alter table runtime_runs enable row level security;
alter table runtime_transcript_entries enable row level security;
alter table runtime_ledger_events enable row level security;
alter table runtime_artifacts enable row level security;

comment on table agent_credentials is 'Stores only SDK credential hashes and prefixes. Never store raw agent tokens.';
comment on table ows_access is 'Production should store OWS API tokens through a secret reference or encrypted ciphertext, not plaintext.';
comment on table private_settlement_requests is 'Durable queue/state table for operator-enabled private settlement execution.';
comment on table sdk_idempotency_keys is 'Durable idempotency locks for SDK payment retries; store hashes, not raw idempotency keys.';

commit;
