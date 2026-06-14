import type {
  ActionRequestKind,
  ActionRequestRecord,
  ActionRequestSource,
  ActionRequestStatus,
} from '../../store/ActionRequestRegistry.js'
import type { AgentSpendWorkspace } from '../../workspace/loadWorkspace.js'

export type DashboardWalletAction = {
  walletActionId: string
  actionRequestId: string
  agentId: string
  walletId?: string
  source: ActionRequestSource
  kind: ActionRequestKind
  status: ActionRequestStatus
  title: string
  summary: string
  createdAt: string
  updatedAt: string
  target: ActionRequestRecord['target']
  value?: ActionRequestRecord['value']
  approval: {
    required: boolean
    reason?: string
    approvalStateRef?: string
  }
  execution: {
    connectorKind?: string
    connectorId?: string
    executionMode?: string
    privacyMode?: string
    resultRef?: string
    transactionRef?: string
    runId?: string
    sessionId?: string
    intentIds: string[]
    simulationRefs: string[]
    broadcastRefs: string[]
    errorCode?: string
    errorMessage?: string
  }
  /**
   * Mantle decision-log stamp (set by the additive Mantle audit layer when MANTLE_RECORD_LIVE=1).
   * Lets the dashboard surface "Recorded on Mantle" + a Mantlescan link on governed actions.
   */
  mantle?: {
    recorded?: boolean
    simulated?: boolean
    verdict?: string
    outcome?: string
    txHash?: string
    txUrl?: string
    agentId?: string
  }
}

export type DashboardWalletActionHistory = {
  projectionMode: 'shadow' | 'transactional_mirror'
  summary: {
    totalMatching: number
    returned: number
    byKind: Partial<Record<ActionRequestKind, number>>
    byStatus: Partial<Record<ActionRequestStatus, number>>
    bySource: Partial<Record<ActionRequestSource, number>>
  }
  walletActions: DashboardWalletAction[]
}

export type DashboardWalletActionQuery = {
  agentId?: string
  walletId?: string
  kind?: ActionRequestKind
  status?: ActionRequestStatus
  limit?: number
}

function incrementCount<Key extends string>(
  counts: Partial<Record<Key, number>>,
  key: Key,
): void {
  counts[key] = (counts[key] ?? 0) + 1
}

function sortActionRequestsByRecency(
  left: ActionRequestRecord,
  right: ActionRequestRecord,
): number {
  return (
    right.updatedAt.localeCompare(left.updatedAt) ||
    right.createdAt.localeCompare(left.createdAt) ||
    right.actionRequestId.localeCompare(left.actionRequestId)
  )
}

export function isNativeWalletActionRequest(
  record: ActionRequestRecord,
): boolean {
  if (record.kind === 'service.pay' && record.target.kind === 'service') {
    return false
  }

  return (
    record.kind === 'asset.transfer' ||
    record.kind === 'asset.swap' ||
    record.kind === 'asset.liquidity' ||
    record.kind === 'asset.bridge' ||
    record.kind === 'portfolio.rebalance' ||
    record.kind === 'wallet.create' ||
    record.kind === 'wallet.policy_update' ||
    record.target.kind === 'address' ||
    record.target.kind === 'wallet' ||
    record.target.kind === 'portfolio'
  )
}

function matchesWalletActionQuery(
  record: ActionRequestRecord,
  query: DashboardWalletActionQuery,
): boolean {
  if (!isNativeWalletActionRequest(record)) {
    return false
  }
  if (query.agentId && record.agentId !== query.agentId) {
    return false
  }
  if (query.walletId && record.walletId !== query.walletId) {
    return false
  }
  if (query.kind && record.kind !== query.kind) {
    return false
  }
  if (query.status && record.status !== query.status) {
    return false
  }
  return true
}

export function projectWalletAction(
  record: ActionRequestRecord,
): DashboardWalletAction {
  const broadcastRefs = record.runtimeRefs?.broadcastRefs ?? []
  const approvalStateRef =
    typeof record.requestContext?.approvalStateRef === 'string'
      ? record.requestContext.approvalStateRef
      : undefined

  const ctx = record.requestContext ?? {}
  const ctxString = (key: string): string | undefined =>
    typeof ctx[key] === 'string' && (ctx[key] as string).length > 0 ? (ctx[key] as string) : undefined
  const mantle =
    ctx.mantleRecorded != null || ctx.mantleTxUrl != null || ctx.mantleVerdict != null
      ? {
          recorded: typeof ctx.mantleRecorded === 'boolean' ? ctx.mantleRecorded : undefined,
          simulated: typeof ctx.mantleSimulated === 'boolean' ? ctx.mantleSimulated : undefined,
          verdict: ctxString('mantleVerdict'),
          outcome: ctxString('mantleOutcome'),
          txHash: ctxString('mantleTxHash'),
          txUrl: ctxString('mantleTxUrl'),
          agentId: ctxString('mantleAgentId'),
        }
      : undefined

  return {
    walletActionId: record.actionRequestId,
    actionRequestId: record.actionRequestId,
    agentId: record.agentId,
    walletId: record.walletId,
    source: record.source,
    kind: record.kind,
    status: record.status,
    title: record.title,
    summary: record.summary,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    target: record.target,
    value: record.value,
    approval: {
      required: Boolean(record.policy?.approvalRequired),
      reason: record.policy?.approvalReason,
      approvalStateRef,
    },
    execution: {
      connectorKind: record.executionPlan?.connectorKind,
      connectorId: record.executionPlan?.connectorId,
      executionMode: record.executionPlan?.executionMode,
      privacyMode: record.executionPlan?.privacyMode,
      resultRef: record.resultRef,
      transactionRef: record.resultRef ?? broadcastRefs.at(-1),
      runId: record.runtimeRefs?.runId,
      sessionId: record.runtimeRefs?.sessionId,
      intentIds: record.runtimeRefs?.intentIds ?? [],
      simulationRefs: record.runtimeRefs?.simulationRefs ?? [],
      broadcastRefs,
      errorCode: record.errorCode,
      errorMessage: record.errorMessage,
    },
    mantle,
  }
}

export async function buildDashboardWalletActionHistory(input: {
  workspace: AgentSpendWorkspace
  query?: DashboardWalletActionQuery
}): Promise<DashboardWalletActionHistory> {
  const query = input.query ?? {}
  const registry = input.workspace.actionRequestRegistry
  if (!registry) {
    throw new Error('ActionRequest registry is not available in this workspace.')
  }

  const listed = await registry.query({
    agentId: query.agentId,
    kind: query.kind,
    status: query.status,
    limit: 500,
  })
  const matching = listed.records
    .filter((record) => matchesWalletActionQuery(record, query))
    .sort(sortActionRequestsByRecency)
  const limit = query.limit ?? 20
  const byKind: Partial<Record<ActionRequestKind, number>> = {}
  const byStatus: Partial<Record<ActionRequestStatus, number>> = {}
  const bySource: Partial<Record<ActionRequestSource, number>> = {}

  for (const record of matching) {
    incrementCount(byKind, record.kind)
    incrementCount(byStatus, record.status)
    incrementCount(bySource, record.source)
  }

  return {
    projectionMode:
      input.workspace.storageDriver === 'postgres'
        ? 'transactional_mirror'
        : 'shadow',
    summary: {
      totalMatching: matching.length,
      returned: Math.min(matching.length, limit),
      byKind,
      byStatus,
      bySource,
    },
    walletActions: matching.slice(0, limit).map(projectWalletAction),
  }
}
