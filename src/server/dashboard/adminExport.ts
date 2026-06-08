import type {
  ActionRequestKind,
  ActionRequestRecord,
  ActionRequestRegistry,
  ActionRequestStatus,
} from '../../store/ActionRequestRegistry.js'
import type {
  DashboardAuditLogRecord,
  DashboardAuditLogRegistry,
} from '../../store/DashboardAuditLogRegistry.js'
import type {
  DashboardWorkspaceRecord,
  DashboardWorkspaceRegistry,
} from '../../store/DashboardWorkspaceRegistry.js'
import type {
  PaidCallRecord,
  PaidCallRegistry,
  PaidCallStatus,
} from '../../store/PaidCallRegistry.js'
import type { Env } from './shared.js'
import { ensureDashboardWorkspaceRecord } from './workspaceSettings.js'

const SECRET_KEY_PATTERN =
  /(^|_|-)(authorization|auth|cookie|password|secret|token|private.?key|api.?key|access.?key|session)(_|-|$)/i

export type DashboardAdminExport = {
  exportVersion: 1
  exportedAt: string
  workspace: DashboardWorkspaceRecord
  summary: {
    auditCount: number
    paidCallCount: number
    paidCallStatusCounts: Record<PaidCallStatus, number>
    actionRequestCount: number
    nativeActionRequestCount: number
    actionRequestStatusCounts: Partial<Record<ActionRequestStatus, number>>
    actionRequestKindCounts: Partial<Record<ActionRequestKind, number>>
  }
  audit: DashboardAuditLogRecord[]
  paidCalls: PaidCallRecord[]
  actionRequests: ActionRequestRecord[]
}

export type DashboardAdminExportWorkspace = {
  dashboardWorkspaceRegistry: DashboardWorkspaceRegistry
  dashboardAuditLogRegistry: DashboardAuditLogRegistry
  paidCallRegistry: PaidCallRegistry
  actionRequestRegistry?: ActionRequestRegistry
}

function isSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key)
}

export function redactDashboardExportSecrets(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactDashboardExportSecrets(item))
  }

  if (!value || typeof value !== 'object') {
    return value
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      isSecretKey(key) ? '[redacted]' : redactDashboardExportSecrets(item),
    ]),
  )
}

function sanitizeAuditRecord(
  record: DashboardAuditLogRecord,
): DashboardAuditLogRecord {
  return {
    ...record,
    metadata: record.metadata
      ? (redactDashboardExportSecrets(record.metadata) as Record<string, unknown>)
      : undefined,
  }
}

function sanitizePaidCallRecord(record: PaidCallRecord): PaidCallRecord {
  return {
    ...record,
    requestPayload: redactDashboardExportSecrets(
      record.requestPayload,
    ) as Record<string, unknown>,
    requestSummary: redactDashboardExportSecrets(
      record.requestSummary,
    ) as Record<string, unknown>,
    responseHeaders: record.responseHeaders
      ? (redactDashboardExportSecrets(record.responseHeaders) as Record<
          string,
          string
        >)
      : undefined,
    responsePreview: redactDashboardExportSecrets(record.responsePreview),
  }
}

function sanitizeActionRequestRecord(
  record: ActionRequestRecord,
): ActionRequestRecord {
  return {
    ...record,
    requestPayload: redactDashboardExportSecrets(
      record.requestPayload,
    ) as Record<string, unknown>,
    requestContext: record.requestContext
      ? (redactDashboardExportSecrets(record.requestContext) as Record<
          string,
          unknown
        >)
      : undefined,
  }
}

function countPaidCallsByStatus(
  paidCalls: PaidCallRecord[],
): Record<PaidCallStatus, number> {
  return paidCalls.reduce<Record<PaidCallStatus, number>>(
    (counts, paidCall) => ({
      ...counts,
      [paidCall.status]: counts[paidCall.status] + 1,
    }),
    {
      blocked: 0,
      approval_pending: 0,
      waiting_for_execution: 0,
      executed: 0,
      failed: 0,
    },
  )
}

function countActionRequestsByStatus(
  actionRequests: ActionRequestRecord[],
): Partial<Record<ActionRequestStatus, number>> {
  return actionRequests.reduce<Partial<Record<ActionRequestStatus, number>>>(
    (counts, actionRequest) => ({
      ...counts,
      [actionRequest.status]: (counts[actionRequest.status] ?? 0) + 1,
    }),
    {},
  )
}

function countActionRequestsByKind(
  actionRequests: ActionRequestRecord[],
): Partial<Record<ActionRequestKind, number>> {
  return actionRequests.reduce<Partial<Record<ActionRequestKind, number>>>(
    (counts, actionRequest) => ({
      ...counts,
      [actionRequest.kind]: (counts[actionRequest.kind] ?? 0) + 1,
    }),
    {},
  )
}

export async function buildDashboardAdminExport(input: {
  env: Env
  workspace: DashboardAdminExportWorkspace
  now?: () => string
}): Promise<DashboardAdminExport> {
  const workspace = await ensureDashboardWorkspaceRecord({
    registry: input.workspace.dashboardWorkspaceRegistry,
    env: input.env,
  })
  const audit = (await input.workspace.dashboardAuditLogRegistry.list())
    .sort((left, right) => right.at.localeCompare(left.at))
    .map(sanitizeAuditRecord)
  const paidCalls = (await input.workspace.paidCallRegistry.list())
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .map(sanitizePaidCallRecord)
  const actionRequests = (
    input.workspace.actionRequestRegistry
      ? await input.workspace.actionRequestRegistry.list()
      : []
  )
    .filter((record) => record.kind !== 'service.pay')
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .map(sanitizeActionRequestRecord)

  return {
    exportVersion: 1,
    exportedAt: input.now?.() ?? new Date().toISOString(),
    workspace,
    summary: {
      auditCount: audit.length,
      paidCallCount: paidCalls.length,
      paidCallStatusCounts: countPaidCallsByStatus(paidCalls),
      actionRequestCount: actionRequests.length,
      nativeActionRequestCount: actionRequests.length,
      actionRequestStatusCounts: countActionRequestsByStatus(actionRequests),
      actionRequestKindCounts: countActionRequestsByKind(actionRequests),
    },
    audit,
    paidCalls,
    actionRequests,
  }
}

export function createDashboardExportFilename(input: {
  workspaceId: string
  exportedAt: string
}): string {
  const workspaceId = input.workspaceId.replace(/[^a-z0-9_-]/gi, '_')
  const timestamp = input.exportedAt.replace(/[:.]/g, '-')
  return `palmos-${workspaceId}-admin-export-${timestamp}.json`
}
