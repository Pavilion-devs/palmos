import type {
  ActionRequestKind,
  ActionRequestRecord,
  ActionRequestQuery,
  ActionRequestSource,
  ActionRequestStatus,
} from '../../store/ActionRequestRegistry.js'
import type { AgentSpendWorkspace } from '../../workspace/loadWorkspace.js'

export const DASHBOARD_ACTION_REQUEST_STATUSES = [
  'created',
  'policy_checked',
  'blocked',
  'approval_pending',
  'approved',
  'waiting_for_execution',
  'executing',
  'executed',
  'failed',
  'cancelled',
  'expired',
] as const satisfies readonly ActionRequestStatus[]

export const DASHBOARD_ACTION_REQUEST_KINDS = [
  'service.pay',
  'asset.transfer',
  'asset.swap',
  'asset.liquidity',
  'asset.bridge',
  'portfolio.rebalance',
  'wallet.create',
  'wallet.policy_update',
] as const satisfies readonly ActionRequestKind[]

export const DASHBOARD_ACTION_REQUEST_SOURCES = [
  'dashboard',
  'sdk',
  'worker',
  'mcp',
  'system',
] as const satisfies readonly ActionRequestSource[]

export type DashboardActionRequestHistoryQuery = {
  agentId?: string
  status?: ActionRequestStatus
  kind?: ActionRequestKind
  source?: ActionRequestSource
  limit: number
}

export type DashboardActionRequestHistoryItem = {
  actionRequestId: string
  createdAt: string
  updatedAt: string
  agentId: string
  walletId?: string
  source: ActionRequestSource
  kind: ActionRequestKind
  status: ActionRequestStatus
  title: string
  summary: string
  target: ActionRequestRecord['target']
  value?: ActionRequestRecord['value']
  policy: {
    approvalRequired: boolean
    approvalReason?: string
  }
  executionPlan?: ActionRequestRecord['executionPlan']
  runtime: {
    sessionId?: string
    runId?: string
    resultRef?: string
  }
  errorCode?: string
  errorMessage?: string
}

export type DashboardActionRequestHistory = {
  projectionMode: 'shadow' | 'transactional_mirror'
  filters: Omit<DashboardActionRequestHistoryQuery, 'limit'> & {
    limit: number
  }
  summary: {
    totalMatching: number
    returned: number
    byStatus: Partial<Record<ActionRequestStatus, number>>
    byKind: Partial<Record<ActionRequestKind, number>>
    bySource: Partial<Record<ActionRequestSource, number>>
  }
  actionRequests: DashboardActionRequestHistoryItem[]
}

function projectActionRequest(
  record: ActionRequestRecord,
): DashboardActionRequestHistoryItem {
  return {
    actionRequestId: record.actionRequestId,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    agentId: record.agentId,
    walletId: record.walletId,
    source: record.source,
    kind: record.kind,
    status: record.status,
    title: record.title,
    summary: record.summary,
    target: record.target,
    value: record.value,
    policy: {
      approvalRequired: record.policy.approvalRequired,
      approvalReason: record.policy.approvalReason,
    },
    executionPlan: record.executionPlan,
    runtime: {
      sessionId: record.runtimeRefs?.sessionId,
      runId: record.runtimeRefs?.runId,
      resultRef: record.resultRef,
    },
    errorCode: record.errorCode,
    errorMessage: record.errorMessage,
  }
}

export async function buildDashboardActionRequestHistory(input: {
  workspace: AgentSpendWorkspace
  query: DashboardActionRequestHistoryQuery
}): Promise<DashboardActionRequestHistory> {
  const registry = input.workspace.actionRequestRegistry
  if (!registry) {
    throw new Error('ActionRequest registry is not available in this workspace.')
  }

  const query: ActionRequestQuery = {
    agentId: input.query.agentId,
    status: input.query.status,
    kind: input.query.kind,
    source: input.query.source,
    limit: input.query.limit,
  }
  const result = await registry.query(query)
  const limited = result.records.map(projectActionRequest)

  return {
    projectionMode:
      input.workspace.storageDriver === 'postgres'
        ? 'transactional_mirror'
        : 'shadow',
    filters: {
      agentId: input.query.agentId,
      status: input.query.status,
      kind: input.query.kind,
      source: input.query.source,
      limit: input.query.limit,
    },
    summary: {
      totalMatching: result.summary.totalMatching,
      returned: limited.length,
      byStatus: result.summary.byStatus,
      byKind: result.summary.byKind,
      bySource: result.summary.bySource,
    },
    actionRequests: limited,
  }
}
