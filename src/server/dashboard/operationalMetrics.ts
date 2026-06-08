import {
  DEFAULT_WALLET_ACTION_STALE_AFTER_MS,
  isWalletActionStale,
  readWalletActionAgeMs,
} from '../../app/walletActionLifecycle.js'
import type {
  ActionRequestRecord,
  ActionRequestRegistry,
  ActionRequestStatus,
} from '../../store/ActionRequestRegistry.js'
import type { AgentCredentialRegistry } from '../../store/AgentCredentialRegistry.js'
import type { PaidCallRecord, PaidCallRegistry } from '../../store/PaidCallRegistry.js'
import type { PusdReadinessReportRegistry } from '../../store/PusdReadinessReportRegistry.js'
import { isNativeWalletActionRequest } from './walletActions.js'

export type DashboardMetricCounter =
  | 'sdk.calls'
  | 'sdk.auth_failures'
  | 'sdk.policy_denials'
  | 'sdk.internal_failures'
  | 'dashboard.5xx'
  | 'dashboard.backup_failures'
  | 'dashboard.csrf_failures'
  | 'dashboard.db_failures'
  | 'approval.execution_failures'

export type DashboardOperationalMetricsStore = {
  increment(counter: DashboardMetricCounter): void
  recordHttpStatus(statusCode: number, atMs?: number): void
  snapshot(): Record<DashboardMetricCounter, number>
  httpSnapshot(input?: { nowMs?: number }): {
    windowMs: number
    recentRequests: number
    recent5xx: number
  }
}

export type DashboardOperationalMetricsReport = {
  ok: true
  generatedAt: string
  processCounters: Record<DashboardMetricCounter, number>
  paidCalls: {
    total: number
    byStatus: Record<PaidCallRecord['status'], number>
    byRail: Record<string, number>
    policyDenials: number
    settlementFailures: number
  }
  actionRequests: {
    total: number
    nativeTotal: number
    byStatus: Partial<Record<ActionRequestStatus, number>>
    byKind: Record<string, number>
    policyDenials: number
    executionFailures: number
  }
  walletActions: {
    total: number
    byStatus: Partial<Record<ActionRequestStatus, number>>
    byKind: Record<string, number>
    stuckThresholdMs: number
    stuckTotal: number
    stuckByStatus: Partial<Record<ActionRequestStatus, number>>
    stuckByKind: Record<string, number>
    failedTotal: number
    failedRate: number
    approvalPending: {
      total: number
      averageAgeMs?: number
      maxAgeMs?: number
    }
  }
  approvals: {
    pending: number
    resolvedSamples: number
    averageLatencyMs?: number
    maxLatencyMs?: number
    executionFailures: number
  }
  http: {
    windowMs: number
    recentRequests: number
    recent5xx: number
  }
  readiness: {
    totalReports: number
    failedReports: number
    latestOk?: boolean
    latestUpdatedAt?: string
  }
  credentials: {
    total: number
    active: number
    revoked: number
    neverUsed: number
  }
}

export function createDashboardOperationalMetricsStore(
): DashboardOperationalMetricsStore {
  const counters: Record<DashboardMetricCounter, number> = {
    'sdk.calls': 0,
    'sdk.auth_failures': 0,
    'sdk.policy_denials': 0,
    'sdk.internal_failures': 0,
    'dashboard.5xx': 0,
    'dashboard.backup_failures': 0,
    'dashboard.csrf_failures': 0,
    'dashboard.db_failures': 0,
    'approval.execution_failures': 0,
  }
  const httpWindowMs = 5 * 60 * 1000
  const httpEvents: Array<{ atMs: number; statusCode: number }> = []

  function pruneHttpEvents(nowMs: number): void {
    const cutoff = nowMs - httpWindowMs
    while (httpEvents.length && httpEvents[0]!.atMs < cutoff) {
      httpEvents.shift()
    }
  }

  return {
    increment(counter) {
      counters[counter] += 1
    },
    recordHttpStatus(statusCode, atMs = Date.now()) {
      httpEvents.push({ atMs, statusCode })
      pruneHttpEvents(atMs)
      if (statusCode >= 500) {
        counters['dashboard.5xx'] += 1
      }
    },
    snapshot() {
      return {
        ...counters,
      }
    },
    httpSnapshot(input = {}) {
      const nowMs = input.nowMs ?? Date.now()
      pruneHttpEvents(nowMs)
      return {
        windowMs: httpWindowMs,
        recentRequests: httpEvents.length,
        recent5xx: httpEvents.filter((event) => event.statusCode >= 500)
          .length,
      }
    },
  }
}

function countBy<T extends string>(
  values: T[],
  seed: Record<T, number>,
): Record<T, number> {
  return values.reduce<Record<T, number>>(
    (counts, value) => ({
      ...counts,
      [value]: counts[value] + 1,
    }),
    seed,
  )
}

function addStringCount(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1
}

function isPolicyDenial(record: PaidCallRecord): boolean {
  return (
    record.status === 'blocked' &&
    (record.errorCode?.startsWith('policy.') ||
      record.errorCode === 'service.unverified' ||
      record.errorCode === 'service.disabled' ||
      record.errorCode === 'service.unsafe_endpoint')
  )
}

function isSettlementFailure(record: PaidCallRecord): boolean {
  return (
    record.status === 'failed' &&
    !record.errorCode?.startsWith('approval.') &&
    !record.errorCode?.startsWith('policy.')
  )
}

function readResolvedApprovalLatencies(records: PaidCallRecord[]): number[] {
  return records
    .filter((record) => record.runId && record.status !== 'approval_pending')
    .map((record) => Date.parse(record.updatedAt) - Date.parse(record.createdAt))
    .filter((duration) => Number.isFinite(duration) && duration > 0)
}

function isApprovalExecutionFailure(record: PaidCallRecord): boolean {
  return (
    record.status === 'failed' &&
    Boolean(record.errorCode?.startsWith('approval.'))
  )
}

function isNativeActionRequest(record: ActionRequestRecord): boolean {
  return record.kind !== 'service.pay'
}

function isActionRequestPolicyDenial(record: ActionRequestRecord): boolean {
  return record.status === 'blocked' && Boolean(record.errorCode?.startsWith('policy.'))
}

function isActionRequestExecutionFailure(record: ActionRequestRecord): boolean {
  return (
    record.status === 'failed' &&
    !record.errorCode?.startsWith('approval.') &&
    !record.errorCode?.startsWith('policy.')
  )
}

function readResolvedActionApprovalLatencies(
  records: ActionRequestRecord[],
): number[] {
  return records
    .filter((record) => record.policy.approvalRequired)
    .filter((record) => record.status !== 'approval_pending')
    .map((record) => Date.parse(record.updatedAt) - Date.parse(record.createdAt))
    .filter((duration) => Number.isFinite(duration) && duration > 0)
}

function readAverage(values: number[]): number | undefined {
  if (values.length === 0) {
    return undefined
  }
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
}

export async function buildDashboardOperationalMetrics(input: {
  paidCalls: PaidCallRegistry
  actionRequests?: ActionRequestRegistry
  credentials: AgentCredentialRegistry
  readinessReports: PusdReadinessReportRegistry
  processMetrics?: DashboardOperationalMetricsStore
  now?: () => string
}): Promise<DashboardOperationalMetricsReport> {
  const [paidCalls, actionRequests, credentials, readinessReports] = await Promise.all([
    input.paidCalls.list(),
    input.actionRequests?.list() ?? Promise.resolve([]),
    input.credentials.list(),
    input.readinessReports.list(),
  ])
  const nativeActionRequests = actionRequests.filter(isNativeActionRequest)
  const walletActions = nativeActionRequests.filter(isNativeWalletActionRequest)
  const statusCounts = countBy(
    paidCalls.map((record) => record.status),
    {
      blocked: 0,
      approval_pending: 0,
      waiting_for_execution: 0,
      executed: 0,
      failed: 0,
    },
  )
  const railCounts: Record<string, number> = {}
  for (const record of paidCalls) {
    addStringCount(railCounts, record.paymentRail)
  }
  const actionRequestStatusCounts: Partial<Record<ActionRequestStatus, number>> = {}
  const actionRequestKindCounts: Record<string, number> = {}
  for (const record of nativeActionRequests) {
    actionRequestStatusCounts[record.status] =
      (actionRequestStatusCounts[record.status] ?? 0) + 1
    addStringCount(actionRequestKindCounts, record.kind)
  }
  const walletActionStatusCounts: Partial<Record<ActionRequestStatus, number>> = {}
  const walletActionKindCounts: Record<string, number> = {}
  const stuckWalletActionStatusCounts: Partial<Record<ActionRequestStatus, number>> = {}
  const stuckWalletActionKindCounts: Record<string, number> = {}
  for (const record of walletActions) {
    walletActionStatusCounts[record.status] =
      (walletActionStatusCounts[record.status] ?? 0) + 1
    addStringCount(walletActionKindCounts, record.kind)
  }

  const approvalLatencies = [
    ...readResolvedApprovalLatencies(paidCalls),
    ...readResolvedActionApprovalLatencies(nativeActionRequests),
  ]
  const latestReadiness = readinessReports[0]
  const generatedAt = input.now?.() ?? new Date().toISOString()
  const generatedAtMs = Date.parse(generatedAt)
  const stuckThresholdMs = DEFAULT_WALLET_ACTION_STALE_AFTER_MS
  const stuckWalletActions = walletActions.filter((record) =>
    isWalletActionStale({
      record,
      now: generatedAt,
      staleAfterMs: stuckThresholdMs,
    }),
  )
  for (const record of stuckWalletActions) {
    stuckWalletActionStatusCounts[record.status] =
      (stuckWalletActionStatusCounts[record.status] ?? 0) + 1
    addStringCount(stuckWalletActionKindCounts, record.kind)
  }
  const failedWalletActions = walletActions.filter((record) => record.status === 'failed')
  const approvalPendingAges = walletActions
    .filter((record) => record.status === 'approval_pending')
    .map((record) =>
      readWalletActionAgeMs({
        record,
        now: generatedAt,
      }),
    )
    .filter((age): age is number => Number.isFinite(age))

  return {
    ok: true,
    generatedAt,
    processCounters: input.processMetrics?.snapshot() ?? {
      'sdk.calls': 0,
      'sdk.auth_failures': 0,
      'sdk.policy_denials': 0,
      'sdk.internal_failures': 0,
      'dashboard.5xx': 0,
      'dashboard.backup_failures': 0,
      'dashboard.csrf_failures': 0,
      'dashboard.db_failures': 0,
      'approval.execution_failures': 0,
    },
    paidCalls: {
      total: paidCalls.length,
      byStatus: statusCounts,
      byRail: railCounts,
      policyDenials: paidCalls.filter(isPolicyDenial).length,
      settlementFailures: paidCalls.filter(isSettlementFailure).length,
    },
    actionRequests: {
      total: actionRequests.length,
      nativeTotal: nativeActionRequests.length,
      byStatus: actionRequestStatusCounts,
      byKind: actionRequestKindCounts,
      policyDenials: nativeActionRequests.filter(isActionRequestPolicyDenial).length,
      executionFailures: nativeActionRequests.filter(
        isActionRequestExecutionFailure,
      ).length,
    },
    walletActions: {
      total: walletActions.length,
      byStatus: walletActionStatusCounts,
      byKind: walletActionKindCounts,
      stuckThresholdMs,
      stuckTotal: stuckWalletActions.length,
      stuckByStatus: stuckWalletActionStatusCounts,
      stuckByKind: stuckWalletActionKindCounts,
      failedTotal: failedWalletActions.length,
      failedRate:
        walletActions.length === 0
          ? 0
          : Number((failedWalletActions.length / walletActions.length).toFixed(4)),
      approvalPending: {
        total: approvalPendingAges.length,
        averageAgeMs: readAverage(approvalPendingAges),
        maxAgeMs: approvalPendingAges.length
          ? Math.max(...approvalPendingAges)
          : undefined,
      },
    },
    approvals: {
      pending:
        statusCounts.approval_pending +
        (actionRequestStatusCounts.approval_pending ?? 0),
      resolvedSamples: approvalLatencies.length,
      averageLatencyMs: readAverage(approvalLatencies),
      maxLatencyMs: approvalLatencies.length
        ? Math.max(...approvalLatencies)
        : undefined,
      executionFailures:
        paidCalls.filter(isApprovalExecutionFailure).length +
        nativeActionRequests.filter((record) =>
          record.errorCode?.startsWith('approval.'),
        ).length,
    },
    http: input.processMetrics?.httpSnapshot({
      nowMs: Number.isFinite(generatedAtMs) ? generatedAtMs : undefined,
    }) ?? {
      windowMs: 5 * 60 * 1000,
      recentRequests: 0,
      recent5xx: 0,
    },
    readiness: {
      totalReports: readinessReports.length,
      failedReports: readinessReports.filter((record) => !record.ok).length,
      latestOk: latestReadiness?.ok,
      latestUpdatedAt: latestReadiness?.updatedAt,
    },
    credentials: {
      total: credentials.length,
      active: credentials.filter((record) => record.status === 'active').length,
      revoked: credentials.filter((record) => record.status === 'revoked').length,
      neverUsed: credentials.filter((record) => !record.lastUsedAt).length,
    },
  }
}
