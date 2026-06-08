import type { WalletRecord } from '../../../runtime/contracts/wallet.js'
import type {
  RunState,
  SessionState,
} from '../../../runtime/contracts/runtime.js'
import type { WalletRegistry } from '../../../runtime/wallets/WalletRegistry.js'
import type { RunRegistry } from '../../../runtime/runtime/runRegistry.js'
import type { SessionRegistry } from '../../../runtime/runtime/sessionRegistry.js'
import type {
  AgentControlEventRecord,
  AgentControlEventRegistry,
} from '../../store/AgentControlEventRegistry.js'
import type {
  AgentCredentialRecord,
  AgentCredentialRegistry,
} from '../../store/AgentCredentialRegistry.js'
import type {
  AgentRecord,
  AgentRegistry,
} from '../../store/AgentRegistry.js'
import type {
  DashboardAuditLogRecord,
  DashboardAuditLogRegistry,
  DashboardAuditPruneInput,
  DashboardAuditPruneResult,
} from '../../store/DashboardAuditLogRegistry.js'
import type {
  DashboardOperatorRecord,
  DashboardOperatorRegistry,
} from '../../store/DashboardOperatorRegistry.js'
import type {
  DashboardWorkspaceRecord,
  DashboardWorkspaceRegistry,
} from '../../store/DashboardWorkspaceRegistry.js'
import type {
  OwsAccessRecord,
  OwsAccessRegistry,
} from '../../store/OwsAccessRegistry.js'
import type {
  ActionRequestKind,
  ActionRequestQuery,
  ActionRequestQueryResult,
  ActionRequestRecord,
  ActionRequestRegistry,
  ActionRequestSource,
  ActionRequestStatus,
} from '../../store/ActionRequestRegistry.js'
import type {
  PaidCallRecord,
  PaidCallRegistry,
} from '../../store/PaidCallRegistry.js'
import type {
  RegisteredPalmosServiceRecord,
  PalmosServiceRegistry,
} from '../../store/PalmosServiceRegistry.js'
import type {
  PusdReadinessReportPruneInput,
  PusdReadinessReportPruneResult,
  PusdReadinessReportRecord,
  PusdReadinessReportRegistry,
} from '../../store/PusdReadinessReportRegistry.js'
import type {
  XMTPAlertRecord,
  XMTPAlertRegistry,
} from '../../store/XMTPAlertRegistry.js'
import { readAgentPrivacyMode } from '../../app/agentPrivacyMode.js'
import { mapPaidCallToActionRequest } from '../../store/mapPaidCallToActionRequest.js'
import { normalizeActionRequestRecord as normalizeStoredActionRequestRecord } from '../../store/ActionRequestRegistry.js'
import { readJsonRecord, type PostgresPool } from './client.js'

type JsonRow = { record: unknown }
type ActionRequestRow = { record: unknown; source: unknown }
type ActionRequestSummaryRow = {
  total_matching: number | string
  by_status: unknown
  by_kind: unknown
  by_source: unknown
}
type PostgresQueryable = Pick<PostgresPool, 'query'>

function toJson(value: unknown): string {
  return JSON.stringify(value)
}

function readDateMs(value: string | undefined): number {
  const parsed = value ? Date.parse(value) : Number.NaN
  return Number.isFinite(parsed) ? parsed : 0
}

function readCount(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10)
    return Number.isFinite(parsed) ? parsed : 0
  }

  return 0
}

function readJsonCounts<Key extends string>(
  value: unknown,
): Partial<Record<Key, number>> {
  const parsed = readJsonRecord<Record<string, unknown> | null>(value)
  if (!parsed || typeof parsed !== 'object') {
    return {}
  }

  const counts: Partial<Record<Key, number>> = {}
  for (const [key, count] of Object.entries(parsed)) {
    const parsedCount = readCount(count)
    if (parsedCount > 0) {
      counts[key as Key] = parsedCount
    }
  }
  return counts
}

function qualifyColumn(alias: string | undefined, column: string): string {
  return alias ? `${alias}.${column}` : column
}

function buildActionRequestWhereClause(
  input: ActionRequestQuery,
  alias?: string,
): {
  sql: string
  params: unknown[]
} {
  const params: unknown[] = []
  const clauses: string[] = []

  if (input.agentId) {
    clauses.push(`${qualifyColumn(alias, 'agent_id')} = $${params.length + 1}`)
    params.push(input.agentId)
  }
  if (input.status) {
    clauses.push(`${qualifyColumn(alias, 'status')} = $${params.length + 1}`)
    params.push(input.status)
  }
  if (input.kind) {
    clauses.push(`${qualifyColumn(alias, 'kind')} = $${params.length + 1}`)
    params.push(input.kind)
  }
  if (input.source) {
    clauses.push(`${qualifyColumn(alias, 'source')} = $${params.length + 1}`)
    params.push(input.source)
  }

  return {
    sql: clauses.length > 0 ? `where ${clauses.join(' and ')}` : '',
    params,
  }
}

function isMissingTableError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as Error & { code?: string }).code === '42P01'
  )
}

async function listRecords<T>(
  pool: PostgresPool,
  query: string,
  params: unknown[] = [],
): Promise<T[]> {
  try {
    const result = await pool.query<JsonRow>(query, params)
    return result.rows.map((row) => readJsonRecord<T>(row.record))
  } catch (error) {
    if (isMissingTableError(error)) {
      return []
    }
    throw error
  }
}

async function getRecord<T>(
  pool: PostgresPool,
  query: string,
  params: unknown[],
): Promise<T | undefined> {
  const records = await listRecords<T>(pool, query, params)
  return records[0]
}

async function getActionRequestRecord(
  queryable: PostgresQueryable,
  actionRequestId: string,
): Promise<ActionRequestRecord | undefined> {
  try {
    const result = await queryable.query<ActionRequestRow>(
      'select record, source from action_requests where action_request_id = $1',
      [actionRequestId],
    )
    const row = result.rows[0]
    return row ? readActionRequestRow(row) : undefined
  } catch (error) {
    if (isMissingTableError(error)) {
      return undefined
    }

    throw error
  }
}

function readActionRequestRow(row: ActionRequestRow): ActionRequestRecord {
  const record = normalizeStoredActionRequestRecord(
    readJsonRecord<ActionRequestRecord>(row.record),
  )
  const source =
    typeof row.source === 'string' && row.source.trim()
      ? (row.source as ActionRequestSource)
      : record.source

  return record.source === source
    ? record
    : {
        ...record,
        source,
      }
}

async function queryActionRequestRecords(
  queryable: PostgresQueryable,
  input: ActionRequestQuery,
): Promise<ActionRequestQueryResult> {
  const where = buildActionRequestWhereClause(input)
  const limit =
    input.limit == null ? undefined : Math.max(0, Math.trunc(input.limit))
  const recordParams = [...where.params]
  const limitSql =
    limit == null ? '' : ` limit $${recordParams.length + 1}`
  if (limit != null) {
    recordParams.push(limit)
  }

  try {
    const recordsResult = await queryable.query<ActionRequestRow>(
      `select record, source from action_requests
      ${where.sql}
      order by updated_at desc, created_at desc, action_request_id desc${limitSql}`,
      recordParams,
    )
    const summaryResult = await queryable.query<ActionRequestSummaryRow>(
      `with filtered as (
        select
          status,
          kind,
          source
        from action_requests
        ${where.sql}
      ),
      status_counts as (
        select jsonb_object_agg(status, entry_count) as counts
        from (
          select status, count(*)::int as entry_count
          from filtered
          group by status
        ) as grouped
      ),
      kind_counts as (
        select jsonb_object_agg(kind, entry_count) as counts
        from (
          select kind, count(*)::int as entry_count
          from filtered
          group by kind
        ) as grouped
      ),
      source_counts as (
        select jsonb_object_agg(source, entry_count) as counts
        from (
          select source, count(*)::int as entry_count
          from filtered
          where source is not null
          group by source
        ) as grouped
      )
      select
        (select count(*)::int from filtered) as total_matching,
        coalesce((select counts from status_counts), '{}'::jsonb) as by_status,
        coalesce((select counts from kind_counts), '{}'::jsonb) as by_kind,
        coalesce((select counts from source_counts), '{}'::jsonb) as by_source`,
      where.params,
    )
    const summary = summaryResult.rows[0]

    return {
      records: recordsResult.rows.map(readActionRequestRow),
      summary: {
        totalMatching: readCount(summary?.total_matching),
        byStatus: readJsonCounts<ActionRequestStatus>(summary?.by_status),
        byKind: readJsonCounts<ActionRequestKind>(summary?.by_kind),
        bySource: readJsonCounts<ActionRequestSource>(summary?.by_source),
      },
    }
  } catch (error) {
    if (isMissingTableError(error)) {
      return {
        records: [],
        summary: {
          totalMatching: 0,
          byStatus: {},
          byKind: {},
          bySource: {},
        },
      }
    }

    throw error
  }
}

async function putActionRequestRecord(
  queryable: PostgresQueryable,
  record: ActionRequestRecord,
): Promise<void> {
  await queryable.query(
    `insert into action_requests (
      action_request_id, agent_id, source, kind, status, created_at, updated_at, record
    ) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
    on conflict (action_request_id) do update set
      agent_id = excluded.agent_id,
      source = excluded.source,
      kind = excluded.kind,
      status = excluded.status,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at,
      record = excluded.record`,
    [
      record.actionRequestId,
      record.agentId,
      record.source,
      record.kind,
      record.status,
      record.createdAt,
      record.updatedAt,
      toJson(record),
    ],
  )
}

async function putActionRequestRecordIfStatus(
  queryable: PostgresQueryable,
  record: ActionRequestRecord,
  expectedStatus: ActionRequestRecord['status'],
): Promise<boolean> {
  const result = await queryable.query(
    `update action_requests set
      agent_id = $2,
      source = $3,
      kind = $4,
      status = $5,
      created_at = $6,
      updated_at = $7,
      record = $8::jsonb
    where action_request_id = $1 and status = $9`,
    [
      record.actionRequestId,
      record.agentId,
      record.source,
      record.kind,
      record.status,
      record.createdAt,
      record.updatedAt,
      toJson(record),
      expectedStatus,
    ],
  )
  return result.rowCount === 1
}

async function deleteActionRequestRecord(
  queryable: PostgresQueryable,
  actionRequestId: string,
): Promise<void> {
  await queryable.query(
    'delete from action_requests where action_request_id = $1',
    [actionRequestId],
  )
}

async function putPaidCallRecord(
  queryable: PostgresQueryable,
  record: PaidCallRecord,
): Promise<void> {
  await queryable.query(
    `insert into paid_calls (
      execution_id, agent_id, service_id, status, created_at, updated_at, record
    ) values ($1, $2, $3, $4, $5, $6, $7::jsonb)
    on conflict (execution_id) do update set
      agent_id = excluded.agent_id,
      service_id = excluded.service_id,
      status = excluded.status,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at,
      record = excluded.record`,
    [
      record.executionId,
      record.agentId,
      record.serviceId,
      record.status,
      record.createdAt,
      record.updatedAt,
      toJson(record),
    ],
  )
}

async function putPaidCallRecordIfStatus(
  queryable: PostgresQueryable,
  record: PaidCallRecord,
  expectedStatus: PaidCallRecord['status'],
): Promise<boolean> {
  const result = await queryable.query(
    `update paid_calls set
      agent_id = $2,
      service_id = $3,
      status = $4,
      created_at = $5,
      updated_at = $6,
      record = $7::jsonb
    where execution_id = $1 and status = $8`,
    [
      record.executionId,
      record.agentId,
      record.serviceId,
      record.status,
      record.createdAt,
      record.updatedAt,
      toJson(record),
      expectedStatus,
    ],
  )
  return result.rowCount === 1
}

async function deletePaidCallRecord(
  queryable: PostgresQueryable,
  executionId: string,
): Promise<void> {
  await queryable.query('delete from paid_calls where execution_id = $1', [
    executionId,
  ])
}

export class PostgresAgentRegistry implements AgentRegistry {
  constructor(private readonly pool: PostgresPool) {}

  async get(agentId: string): Promise<AgentRecord | undefined> {
    return getRecord<AgentRecord>(
      this.pool,
      'select record from agents where agent_id = $1',
      [agentId],
    )
  }

  async put(agent: AgentRecord): Promise<void> {
    await this.pool.query(
      `insert into agents (
        agent_id, actor_id, wallet_id, status, privacy_mode, updated_at, record
      ) values ($1, $2, $3, $4, $5, $6, $7::jsonb)
      on conflict (agent_id) do update set
        actor_id = excluded.actor_id,
        wallet_id = excluded.wallet_id,
        status = excluded.status,
        privacy_mode = excluded.privacy_mode,
        updated_at = excluded.updated_at,
        record = excluded.record`,
      [
        agent.agentId,
        agent.actorId,
        agent.walletId ?? null,
        agent.status,
        readAgentPrivacyMode(agent.policyConfig),
        agent.updatedAt,
        toJson(agent),
      ],
    )
  }

  async putIfUpdatedAt(
    agent: AgentRecord,
    expectedUpdatedAt: string,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `update agents set
        actor_id = $2,
        wallet_id = $3,
        status = $4,
        privacy_mode = $5,
        updated_at = $6,
        record = $7::jsonb
      where agent_id = $1 and updated_at = $8::timestamptz`,
      [
        agent.agentId,
        agent.actorId,
        agent.walletId ?? null,
        agent.status,
        readAgentPrivacyMode(agent.policyConfig),
        agent.updatedAt,
        toJson(agent),
        expectedUpdatedAt,
      ],
    )
    return result.rowCount === 1
  }

  async list(): Promise<AgentRecord[]> {
    return listRecords<AgentRecord>(
      this.pool,
      'select record from agents order by updated_at desc',
    )
  }

  async getByActorId(actorId: string): Promise<AgentRecord | undefined> {
    return getRecord<AgentRecord>(
      this.pool,
      'select record from agents where actor_id = $1 order by updated_at desc limit 1',
      [actorId],
    )
  }

  async getByWalletId(walletId: string): Promise<AgentRecord | undefined> {
    return getRecord<AgentRecord>(
      this.pool,
      'select record from agents where wallet_id = $1 order by updated_at desc limit 1',
      [walletId],
    )
  }

  async remove(agentId: string): Promise<void> {
    await this.pool.query('delete from agents where agent_id = $1', [agentId])
  }
}

export class PostgresAgentCredentialRegistry
  implements AgentCredentialRegistry
{
  constructor(private readonly pool: PostgresPool) {}

  async get(credentialId: string): Promise<AgentCredentialRecord | undefined> {
    return getRecord<AgentCredentialRecord>(
      this.pool,
      'select record from agent_credentials where credential_id = $1',
      [credentialId],
    )
  }

  async put(record: AgentCredentialRecord): Promise<void> {
    await this.pool.query(
      `insert into agent_credentials (
        credential_id, agent_id, key_hash, status, updated_at, record
      ) values ($1, $2, $3, $4, $5, $6::jsonb)
      on conflict (credential_id) do update set
        agent_id = excluded.agent_id,
        key_hash = excluded.key_hash,
        status = excluded.status,
        updated_at = excluded.updated_at,
        record = excluded.record`,
      [
        record.credentialId,
        record.agentId,
        record.keyHash,
        record.status,
        record.updatedAt,
        toJson(record),
      ],
    )
  }

  async putIfStatus(
    record: AgentCredentialRecord,
    expectedStatus: AgentCredentialRecord['status'],
  ): Promise<boolean> {
    const result = await this.pool.query(
      `update agent_credentials set
        agent_id = $2,
        key_hash = $3,
        status = $4,
        updated_at = $5,
        record = $6::jsonb
      where credential_id = $1 and status = $7`,
      [
        record.credentialId,
        record.agentId,
        record.keyHash,
        record.status,
        record.updatedAt,
        toJson(record),
        expectedStatus,
      ],
    )
    return result.rowCount === 1
  }

  async list(): Promise<AgentCredentialRecord[]> {
    return listRecords<AgentCredentialRecord>(
      this.pool,
      'select record from agent_credentials order by updated_at desc',
    )
  }

  async listByAgent(agentId: string): Promise<AgentCredentialRecord[]> {
    return listRecords<AgentCredentialRecord>(
      this.pool,
      'select record from agent_credentials where agent_id = $1 order by updated_at desc',
      [agentId],
    )
  }

  async remove(credentialId: string): Promise<void> {
    await this.pool.query(
      'delete from agent_credentials where credential_id = $1',
      [credentialId],
    )
  }
}

export class PostgresPalmosServiceRegistry implements PalmosServiceRegistry {
  constructor(private readonly pool: PostgresPool) {}

  async get(
    serviceId: string,
  ): Promise<RegisteredPalmosServiceRecord | undefined> {
    return getRecord<RegisteredPalmosServiceRecord>(
      this.pool,
      'select record from registered_services where service_id = $1',
      [serviceId],
    )
  }

  async put(record: RegisteredPalmosServiceRecord): Promise<void> {
    await this.pool.query(
      `insert into registered_services (
        service_id, vendor_id, status, verification_status, updated_at, record
      ) values ($1, $2, $3, $4, $5, $6::jsonb)
      on conflict (service_id) do update set
        vendor_id = excluded.vendor_id,
        status = excluded.status,
        verification_status = excluded.verification_status,
        updated_at = excluded.updated_at,
        record = excluded.record`,
      [
        record.serviceId,
        record.vendorId,
        record.status,
        record.verificationStatus ?? null,
        record.updatedAt,
        toJson(record),
      ],
    )
  }

  async putIfUpdatedAt(
    record: RegisteredPalmosServiceRecord,
    expectedUpdatedAt: string,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `update registered_services set
        vendor_id = $2,
        status = $3,
        verification_status = $4,
        updated_at = $5,
        record = $6::jsonb
      where service_id = $1 and updated_at = $7::timestamptz`,
      [
        record.serviceId,
        record.vendorId,
        record.status,
        record.verificationStatus ?? null,
        record.updatedAt,
        toJson(record),
        expectedUpdatedAt,
      ],
    )
    return result.rowCount === 1
  }

  async list(): Promise<RegisteredPalmosServiceRecord[]> {
    return listRecords<RegisteredPalmosServiceRecord>(
      this.pool,
      'select record from registered_services order by updated_at desc',
    )
  }

  async remove(serviceId: string): Promise<void> {
    await this.pool.query('delete from registered_services where service_id = $1', [
      serviceId,
    ])
  }
}

export class PostgresActionRequestRegistry implements ActionRequestRegistry {
  constructor(private readonly pool: PostgresPool) {}

  async get(actionRequestId: string): Promise<ActionRequestRecord | undefined> {
    return getActionRequestRecord(this.pool, actionRequestId)
  }

  async put(record: ActionRequestRecord): Promise<void> {
    await putActionRequestRecord(this.pool, record)
  }

  async putIfStatus(
    record: ActionRequestRecord,
    expectedStatus: ActionRequestRecord['status'],
  ): Promise<boolean> {
    return putActionRequestRecordIfStatus(this.pool, record, expectedStatus)
  }

  async query(input: ActionRequestQuery): Promise<ActionRequestQueryResult> {
    const client = await this.pool.connect()
    try {
      await client.query('begin isolation level repeatable read read only')
      const result = await queryActionRequestRecords(client, input)
      await client.query('commit')
      return result
    } catch (error) {
      await client.query('rollback').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  async list(): Promise<ActionRequestRecord[]> {
    try {
      const result = await this.pool.query<ActionRequestRow>(
        'select record, source from action_requests order by updated_at desc, created_at desc, action_request_id desc',
      )
      return result.rows.map(readActionRequestRow)
    } catch (error) {
      if (isMissingTableError(error)) {
        return []
      }
      throw error
    }
  }

  async remove(actionRequestId: string): Promise<void> {
    await deleteActionRequestRecord(this.pool, actionRequestId)
  }
}

export class PostgresPaidCallRegistry implements PaidCallRegistry {
  constructor(
    private readonly pool: PostgresPool,
    _actionRequests: ActionRequestRegistry = new PostgresActionRequestRegistry(pool),
  ) {}

  async get(executionId: string): Promise<PaidCallRecord | undefined> {
    return getRecord<PaidCallRecord>(
      this.pool,
      'select record from paid_calls where execution_id = $1',
      [executionId],
    )
  }

  async put(record: PaidCallRecord): Promise<void> {
    const client = await this.pool.connect()
    try {
      await client.query('begin')
      await putPaidCallRecord(client, record)
      const currentActionRequest = await getActionRequestRecord(
        client,
        record.executionId,
      )
      await putActionRequestRecord(
        client,
        mapPaidCallToActionRequest(record, currentActionRequest),
      )
      await client.query('commit')
    } catch (error) {
      await client.query('rollback').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  async putIfStatus(
    record: PaidCallRecord,
    expectedStatus: PaidCallRecord['status'],
  ): Promise<boolean> {
    const client = await this.pool.connect()
    try {
      await client.query('begin')
      const updated = await putPaidCallRecordIfStatus(
        client,
        record,
        expectedStatus,
      )
      if (!updated) {
        await client.query('rollback')
        return false
      }

      const currentActionRequest = await getActionRequestRecord(
        client,
        record.executionId,
      )
      await putActionRequestRecord(
        client,
        mapPaidCallToActionRequest(record, currentActionRequest),
      )
      await client.query('commit')
      return true
    } catch (error) {
      await client.query('rollback').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  async list(): Promise<PaidCallRecord[]> {
    return listRecords<PaidCallRecord>(
      this.pool,
      'select record from paid_calls order by created_at desc',
    )
  }

  async remove(executionId: string): Promise<void> {
    const client = await this.pool.connect()
    try {
      await client.query('begin')
      await deletePaidCallRecord(client, executionId)
      await deleteActionRequestRecord(client, executionId)
      await client.query('commit')
    } catch (error) {
      await client.query('rollback').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }
}

export class PostgresDashboardAuditLogRegistry
  implements DashboardAuditLogRegistry
{
  constructor(private readonly pool: PostgresPool) {}

  async get(auditLogId: string): Promise<DashboardAuditLogRecord | undefined> {
    return getRecord<DashboardAuditLogRecord>(
      this.pool,
      'select record from dashboard_audit_logs where audit_log_id = $1',
      [auditLogId],
    )
  }

  async put(record: DashboardAuditLogRecord): Promise<void> {
    await this.pool.query(
      `insert into dashboard_audit_logs (
        audit_log_id, workspace_id, at, action, target_type, target_id, record
      ) values ($1, $2, $3, $4, $5, $6, $7::jsonb)
      on conflict (audit_log_id) do update set
        workspace_id = excluded.workspace_id,
        at = excluded.at,
        action = excluded.action,
        target_type = excluded.target_type,
        target_id = excluded.target_id,
        record = excluded.record`,
      [
        record.auditLogId,
        record.workspaceId,
        record.at,
        record.action,
        record.target?.type ?? null,
        record.target?.id ?? null,
        toJson(record),
      ],
    )
  }

  async list(): Promise<DashboardAuditLogRecord[]> {
    return listRecords<DashboardAuditLogRecord>(
      this.pool,
      'select record from dashboard_audit_logs order by at desc',
    )
  }

  async prune(
    input: DashboardAuditPruneInput,
  ): Promise<DashboardAuditPruneResult> {
    const records = await this.list()
    const now = input.now ?? Date.now()
    const keep = new Set<string>()

    for (const [index, record] of records.entries()) {
      const tooMany = input.maxRecords != null && index >= input.maxRecords
      const tooOld =
        input.maxAgeMs != null && readDateMs(record.at) < now - input.maxAgeMs
      if (!tooMany && !tooOld) {
        keep.add(record.auditLogId)
      }
    }

    const remove = records.filter((record) => !keep.has(record.auditLogId))
    for (const record of remove) {
      await this.remove(record.auditLogId)
    }

    return { kept: keep.size, removed: remove.length }
  }

  async remove(auditLogId: string): Promise<void> {
    await this.pool.query(
      'delete from dashboard_audit_logs where audit_log_id = $1',
      [auditLogId],
    )
  }
}

export class PostgresDashboardOperatorRegistry
  implements DashboardOperatorRegistry
{
  constructor(private readonly pool: PostgresPool) {}

  async get(operatorId: string): Promise<DashboardOperatorRecord | undefined> {
    return getRecord<DashboardOperatorRecord>(
      this.pool,
      'select record from dashboard_operators where operator_id = $1',
      [operatorId],
    )
  }

  async put(record: DashboardOperatorRecord): Promise<void> {
    await this.pool.query(
      `insert into dashboard_operators (
        operator_id, workspace_id, role, status, updated_at, record
      ) values ($1, $2, $3, $4, $5, $6::jsonb)
      on conflict (operator_id) do update set
        workspace_id = excluded.workspace_id,
        role = excluded.role,
        status = excluded.status,
        updated_at = excluded.updated_at,
        record = excluded.record`,
      [
        record.operatorId,
        record.workspaceId,
        record.role,
        record.status,
        record.updatedAt,
        toJson(record),
      ],
    )
  }

  async putIfUpdatedAt(
    record: DashboardOperatorRecord,
    expectedUpdatedAt: string,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `update dashboard_operators set
        workspace_id = $2,
        role = $3,
        status = $4,
        updated_at = $5,
        record = $6::jsonb
      where operator_id = $1 and updated_at = $7::timestamptz`,
      [
        record.operatorId,
        record.workspaceId,
        record.role,
        record.status,
        record.updatedAt,
        toJson(record),
        expectedUpdatedAt,
      ],
    )
    return result.rowCount === 1
  }

  async list(): Promise<DashboardOperatorRecord[]> {
    return listRecords<DashboardOperatorRecord>(
      this.pool,
      'select record from dashboard_operators order by updated_at desc',
    )
  }

  async remove(operatorId: string): Promise<void> {
    await this.pool.query(
      'delete from dashboard_operators where operator_id = $1',
      [operatorId],
    )
  }
}

export class PostgresDashboardWorkspaceRegistry
  implements DashboardWorkspaceRegistry
{
  constructor(private readonly pool: PostgresPool) {}

  async get(workspaceId: string): Promise<DashboardWorkspaceRecord | undefined> {
    return getRecord<DashboardWorkspaceRecord>(
      this.pool,
      'select record from dashboard_workspaces where workspace_id = $1',
      [workspaceId],
    )
  }

  async put(record: DashboardWorkspaceRecord): Promise<void> {
    await this.pool.query(
      `insert into dashboard_workspaces (
        workspace_id, status, updated_at, record
      ) values ($1, $2, $3, $4::jsonb)
      on conflict (workspace_id) do update set
        status = excluded.status,
        updated_at = excluded.updated_at,
        record = excluded.record`,
      [record.workspaceId, record.status, record.updatedAt, toJson(record)],
    )
  }

  async putIfUpdatedAt(
    record: DashboardWorkspaceRecord,
    expectedUpdatedAt: string,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `update dashboard_workspaces set
        status = $2,
        updated_at = $3,
        record = $4::jsonb
      where workspace_id = $1 and updated_at = $5::timestamptz`,
      [
        record.workspaceId,
        record.status,
        record.updatedAt,
        toJson(record),
        expectedUpdatedAt,
      ],
    )
    return result.rowCount === 1
  }

  async list(): Promise<DashboardWorkspaceRecord[]> {
    return listRecords<DashboardWorkspaceRecord>(
      this.pool,
      'select record from dashboard_workspaces order by updated_at desc',
    )
  }

  async remove(workspaceId: string): Promise<void> {
    await this.pool.query(
      'delete from dashboard_workspaces where workspace_id = $1',
      [workspaceId],
    )
  }
}

export class PostgresAgentControlEventRegistry
  implements AgentControlEventRegistry
{
  constructor(private readonly pool: PostgresPool) {}

  async get(controlEventId: string): Promise<AgentControlEventRecord | undefined> {
    return getRecord<AgentControlEventRecord>(
      this.pool,
      'select record from agent_control_events where control_event_id = $1',
      [controlEventId],
    )
  }

  async put(record: AgentControlEventRecord): Promise<void> {
    await this.pool.query(
      `insert into agent_control_events (
        control_event_id, agent_id, at, record
      ) values ($1, $2, $3, $4::jsonb)
      on conflict (control_event_id) do update set
        agent_id = excluded.agent_id,
        at = excluded.at,
        record = excluded.record`,
      [record.controlEventId, record.agentId, record.at, toJson(record)],
    )
  }

  async list(): Promise<AgentControlEventRecord[]> {
    return listRecords<AgentControlEventRecord>(
      this.pool,
      'select record from agent_control_events order by at desc',
    )
  }

  async remove(controlEventId: string): Promise<void> {
    await this.pool.query(
      'delete from agent_control_events where control_event_id = $1',
      [controlEventId],
    )
  }
}

export class PostgresXMTPAlertRegistry implements XMTPAlertRegistry {
  constructor(private readonly pool: PostgresPool) {}

  async get(alertId: string): Promise<XMTPAlertRecord | undefined> {
    return getRecord<XMTPAlertRecord>(
      this.pool,
      'select record from xmtp_alerts where alert_id = $1',
      [alertId],
    )
  }

  async put(record: XMTPAlertRecord): Promise<void> {
    await this.pool.query(
      `insert into xmtp_alerts (
        alert_id, agent_id, execution_id, created_at, updated_at, record
      ) values ($1, $2, $3, $4, $5, $6::jsonb)
      on conflict (alert_id) do update set
        agent_id = excluded.agent_id,
        execution_id = excluded.execution_id,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        record = excluded.record`,
      [
        record.alertId,
        record.agentId ?? null,
        record.executionId ?? null,
        record.createdAt,
        record.updatedAt,
        toJson(record),
      ],
    )
  }

  async list(): Promise<XMTPAlertRecord[]> {
    return listRecords<XMTPAlertRecord>(
      this.pool,
      'select record from xmtp_alerts order by created_at desc',
    )
  }

  async remove(alertId: string): Promise<void> {
    await this.pool.query('delete from xmtp_alerts where alert_id = $1', [
      alertId,
    ])
  }
}

export class PostgresOwsAccessRegistry implements OwsAccessRegistry {
  constructor(private readonly pool: PostgresPool) {}

  async get(agentId: string): Promise<OwsAccessRecord | undefined> {
    return getRecord<OwsAccessRecord>(
      this.pool,
      'select record from ows_access where agent_id = $1',
      [agentId],
    )
  }

  async put(record: OwsAccessRecord): Promise<void> {
    await this.pool.query(
      `insert into ows_access (agent_id, updated_at, record)
      values ($1, $2, $3::jsonb)
      on conflict (agent_id) do update set
        updated_at = excluded.updated_at,
        record = excluded.record`,
      [record.agentId, record.updatedAt, toJson(record)],
    )
  }

  async list(): Promise<OwsAccessRecord[]> {
    return listRecords<OwsAccessRecord>(
      this.pool,
      'select record from ows_access order by updated_at desc',
    )
  }

  async remove(agentId: string): Promise<void> {
    await this.pool.query('delete from ows_access where agent_id = $1', [agentId])
  }
}

export class PostgresPusdReadinessReportRegistry
  implements PusdReadinessReportRegistry
{
  constructor(private readonly pool: PostgresPool) {}

  async put(record: PusdReadinessReportRecord): Promise<void> {
    await this.pool.query(
      `insert into pusd_readiness_reports (
        report_id, agent_id, service_id, wallet_name, ok, created_at, updated_at, record
      ) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
      on conflict (report_id) do update set
        agent_id = excluded.agent_id,
        service_id = excluded.service_id,
        wallet_name = excluded.wallet_name,
        ok = excluded.ok,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        record = excluded.record`,
      [
        record.reportId,
        record.agentId ?? null,
        record.serviceId ?? null,
        record.walletName ?? null,
        record.ok,
        record.createdAt,
        record.updatedAt,
        toJson(record),
      ],
    )
  }

  async list(): Promise<PusdReadinessReportRecord[]> {
    return listRecords<PusdReadinessReportRecord>(
      this.pool,
      'select record from pusd_readiness_reports order by updated_at desc',
    )
  }

  async latest(): Promise<PusdReadinessReportRecord | undefined> {
    return getRecord<PusdReadinessReportRecord>(
      this.pool,
      'select record from pusd_readiness_reports order by updated_at desc limit 1',
      [],
    )
  }

  async prune(
    input: PusdReadinessReportPruneInput,
  ): Promise<PusdReadinessReportPruneResult> {
    const records = await this.list()
    const now = input.now ?? Date.now()
    const keep = new Set<string>()

    for (const [index, record] of records.entries()) {
      const tooMany = input.maxRecords != null && index >= input.maxRecords
      const tooOld =
        input.maxAgeMs != null &&
        readDateMs(record.updatedAt) < now - input.maxAgeMs
      if (!tooMany && !tooOld) {
        keep.add(record.reportId)
      }
    }

    const remove = records.filter((record) => !keep.has(record.reportId))
    for (const record of remove) {
      await this.pool.query(
        'delete from pusd_readiness_reports where report_id = $1',
        [record.reportId],
      )
    }

    return { kept: keep.size, removed: remove.length }
  }
}

export class PostgresWalletRegistry implements WalletRegistry {
  constructor(private readonly pool: PostgresPool) {}

  async get(walletId: string): Promise<WalletRecord | undefined> {
    return getRecord<WalletRecord>(
      this.pool,
      'select record from wallets where wallet_id = $1',
      [walletId],
    )
  }

  async put(wallet: WalletRecord): Promise<void> {
    await this.pool.query(
      `insert into wallets (
        wallet_id, organization_id, treasury_id, subject_id, address, updated_at, record
      ) values ($1, $2, $3, $4, $5, $6, $7::jsonb)
      on conflict (wallet_id) do update set
        organization_id = excluded.organization_id,
        treasury_id = excluded.treasury_id,
        subject_id = excluded.subject_id,
        address = excluded.address,
        updated_at = excluded.updated_at,
        record = excluded.record`,
      [
        wallet.walletId,
        wallet.organizationId ?? null,
        wallet.treasuryId ?? null,
        wallet.subjectId ?? null,
        wallet.address ?? null,
        wallet.updatedAt,
        toJson(wallet),
      ],
    )
  }

  async putIfUpdatedAt(
    wallet: WalletRecord,
    expectedUpdatedAt: string,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `update wallets set
        organization_id = $2,
        treasury_id = $3,
        subject_id = $4,
        address = $5,
        updated_at = $6,
        record = $7::jsonb
      where wallet_id = $1 and updated_at = $8::timestamptz`,
      [
        wallet.walletId,
        wallet.organizationId ?? null,
        wallet.treasuryId ?? null,
        wallet.subjectId ?? null,
        wallet.address ?? null,
        wallet.updatedAt,
        toJson(wallet),
        expectedUpdatedAt,
      ],
    )
    return result.rowCount === 1
  }

  async list(): Promise<WalletRecord[]> {
    return listRecords<WalletRecord>(
      this.pool,
      'select record from wallets order by updated_at desc',
    )
  }

  async listByOrganization(organizationId: string): Promise<WalletRecord[]> {
    return listRecords<WalletRecord>(
      this.pool,
      'select record from wallets where organization_id = $1 order by updated_at desc',
      [organizationId],
    )
  }

  async listByTreasury(treasuryId: string): Promise<WalletRecord[]> {
    return listRecords<WalletRecord>(
      this.pool,
      'select record from wallets where treasury_id = $1 order by updated_at desc',
      [treasuryId],
    )
  }
}

export class PostgresSessionRegistry implements SessionRegistry {
  constructor(private readonly pool: PostgresPool) {}

  async get(sessionId: string): Promise<SessionState | undefined> {
    return getRecord<SessionState>(
      this.pool,
      'select record from runtime_sessions where session_id = $1',
      [sessionId],
    )
  }

  async put(session: SessionState): Promise<void> {
    await this.pool.query(
      `insert into runtime_sessions (session_id, updated_at, record)
      values ($1, $2, $3::jsonb)
      on conflict (session_id) do update set
        updated_at = excluded.updated_at,
        record = excluded.record`,
      [session.sessionId, session.updatedAt, toJson(session)],
    )
  }

  async list(): Promise<SessionState[]> {
    return listRecords<SessionState>(
      this.pool,
      'select record from runtime_sessions order by updated_at desc',
    )
  }

  async remove(sessionId: string): Promise<void> {
    await this.pool.query('delete from runtime_sessions where session_id = $1', [
      sessionId,
    ])
  }
}

export class PostgresRunRegistry implements RunRegistry {
  constructor(private readonly pool: PostgresPool) {}

  async get(runId: string): Promise<RunState | undefined> {
    return getRecord<RunState>(
      this.pool,
      'select record from runtime_runs where run_id = $1',
      [runId],
    )
  }

  async put(run: RunState): Promise<void> {
    await this.pool.query(
      `insert into runtime_runs (run_id, session_id, last_updated_at, record)
      values ($1, $2, $3, $4::jsonb)
      on conflict (run_id) do update set
        session_id = excluded.session_id,
        last_updated_at = excluded.last_updated_at,
        record = excluded.record`,
      [run.runId, run.sessionId, run.lastUpdatedAt, toJson(run)],
    )
  }

  async listBySession(sessionId: string): Promise<RunState[]> {
    return listRecords<RunState>(
      this.pool,
      'select record from runtime_runs where session_id = $1 order by last_updated_at desc',
      [sessionId],
    )
  }

  async remove(runId: string): Promise<void> {
    await this.pool.query('delete from runtime_runs where run_id = $1', [runId])
  }
}
