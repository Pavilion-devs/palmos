import type { WalletRecord } from '../../../runtime/contracts/wallet.js'
import type {
  ActionRequestKind,
  ActionRequestRecord,
  ActionRequestStatus,
} from '../../store/ActionRequestRegistry.js'
import type {
  AgentControlEventRecord,
} from '../../store/AgentControlEventRegistry.js'
import type { AgentRecord } from '../../store/AgentRegistry.js'
import type { AgentSpendWorkspace } from '../../workspace/loadWorkspace.js'

export type DashboardAgentWalletCycle = {
  projectionMode: 'shadow' | 'transactional_mirror'
  agent: {
    agentId: string
    displayName: string
    status: AgentRecord['status']
    trustTier: AgentRecord['trustTier']
  }
  wallet: {
    walletId?: string
    address?: string
    state?: WalletRecord['state'] | AgentRecord['walletState']
    walletType?: WalletRecord['walletType'] | AgentRecord['walletType']
    backend?: AgentRecord['walletBackend']
    settlementMode?: AgentRecord['settlementMode']
    complianceStatus?: WalletRecord['complianceStatus']
    policyAttachmentStatus?: WalletRecord['policyAttachmentStatus']
    signerHealthStatus?: WalletRecord['signerHealthStatus']
    trustStatus?: WalletRecord['trustStatus']
    supportedChains: string[]
  }
  readiness: {
    lifecycleStage:
      | 'wallet_missing'
      | 'provisioning'
      | 'policy_pending'
      | 'compliance_pending'
      | 'receive_only'
      | 'signer_attention'
      | 'active'
      | 'blocked'
    outboundReady: boolean
    blockers: string[]
    nextStep: string
  }
  policyScope: {
    allowedActionKinds: ActionRequestKind[]
    allowedAssets: string[]
    allowedChains: string[]
    allowedSignerClasses: string[]
    approvalThreshold?: string
    maxTransferAmount?: string
    privacyMode: 'required' | 'optional' | 'off'
  }
  actions: {
    total: number
    byKind: Partial<Record<ActionRequestKind, number>>
    byStatus: Partial<Record<ActionRequestStatus, number>>
    recent: Array<{
      actionRequestId: string
      kind: ActionRequestKind
      status: ActionRequestStatus
      title: string
      summary: string
      updatedAt: string
      value?: ActionRequestRecord['value']
      target: ActionRequestRecord['target']
      resultRef?: string
      errorCode?: string
      errorMessage?: string
    }>
  }
  controls: {
    total: number
    applied: number
    noop: number
    lastEventAt?: string
    recent: Array<{
      controlEventId: string
      at: string
      type: AgentControlEventRecord['type']
      status: AgentControlEventRecord['status']
      summary: string
      refs?: AgentControlEventRecord['refs']
      metadata?: AgentControlEventRecord['metadata']
    }>
  }
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

function sortControlEventsByRecency(
  left: AgentControlEventRecord,
  right: AgentControlEventRecord,
): number {
  return right.at.localeCompare(left.at) ||
    right.controlEventId.localeCompare(left.controlEventId)
}

function isWalletCycleAction(input: {
  record: ActionRequestRecord
  walletId?: string
}): boolean {
  if (
    input.record.kind === 'service.pay' &&
    input.record.target.kind === 'service'
  ) {
    return false
  }

  if (input.walletId && input.record.walletId === input.walletId) {
    return true
  }

  if (
    input.record.target.kind === 'address' ||
    input.record.target.kind === 'wallet' ||
    input.record.target.kind === 'portfolio'
  ) {
    return true
  }

  return (
    input.record.kind === 'asset.transfer' ||
    input.record.kind === 'asset.swap' ||
    input.record.kind === 'asset.bridge' ||
    input.record.kind === 'portfolio.rebalance' ||
    input.record.kind === 'wallet.create' ||
    input.record.kind === 'wallet.policy_update'
  )
}

function readPrivacyMode(agent: AgentRecord): 'required' | 'optional' | 'off' {
  const umbra = agent.policyConfig.umbra
  if (umbra?.mixerRequired) {
    return 'required'
  }
  if (umbra) {
    return 'optional'
  }
  return 'off'
}

function deriveWalletReadiness(input: {
  agent: AgentRecord
  wallet?: WalletRecord
}): DashboardAgentWalletCycle['readiness'] {
  const walletId = input.wallet?.walletId ?? input.agent.walletId
  if (!walletId) {
    return {
      lifecycleStage: 'wallet_missing',
      outboundReady: false,
      blockers: ['wallet_missing'],
      nextStep: 'create_wallet',
    }
  }

  const state = input.wallet?.state ?? input.agent.walletState
  const complianceStatus = input.wallet?.complianceStatus
  const policyAttachmentStatus = input.wallet?.policyAttachmentStatus
  const signerHealthStatus = input.wallet?.signerHealthStatus
  const trustStatus = input.wallet?.trustStatus
  const blockers: string[] = []

  if (state !== 'active_full' && state !== 'active_limited') {
    blockers.push('wallet_not_outbound_ready')
  }
  if (complianceStatus && complianceStatus !== 'approved') {
    blockers.push('wallet_compliance_not_approved')
  }
  if (policyAttachmentStatus && policyAttachmentStatus !== 'attached') {
    blockers.push('wallet_policy_not_attached')
  }
  if (signerHealthStatus && signerHealthStatus !== 'healthy') {
    blockers.push('wallet_signer_not_healthy')
  }
  if (
    trustStatus &&
    trustStatus !== 'sufficient' &&
    trustStatus !== 'limited'
  ) {
    blockers.push('wallet_trust_not_sufficient')
  }

  if (
    state === 'restricted' ||
    state === 'suspended' ||
    state === 'closed' ||
    state === 'failed_incomplete' ||
    complianceStatus === 'rejected' ||
    complianceStatus === 'restricted' ||
    trustStatus === 'blocked'
  ) {
    return {
      lifecycleStage: 'blocked',
      outboundReady: false,
      blockers,
      nextStep: 'operator_review',
    }
  }

  if (
    state === 'draft' ||
    state === 'provisioning' ||
    state === 'created_unlinked'
  ) {
    return {
      lifecycleStage: 'provisioning',
      outboundReady: false,
      blockers,
      nextStep: 'finish_wallet_provisioning',
    }
  }

  if (
    state === 'linked_pending_policy' ||
    policyAttachmentStatus === 'pending' ||
    policyAttachmentStatus === 'unassigned' ||
    policyAttachmentStatus === 'stale'
  ) {
    return {
      lifecycleStage: 'policy_pending',
      outboundReady: false,
      blockers,
      nextStep: 'attach_wallet_policy',
    }
  }

  if (
    state === 'pending_compliance' ||
    complianceStatus === 'not_started' ||
    complianceStatus === 'pending'
  ) {
    return {
      lifecycleStage: 'compliance_pending',
      outboundReady: false,
      blockers,
      nextStep: 'complete_wallet_compliance',
    }
  }

  if (state === 'active_receive_only') {
    return {
      lifecycleStage: 'receive_only',
      outboundReady: false,
      blockers,
      nextStep: 'enable_outbound_permissions',
    }
  }

  if (
    state === 'rotating' ||
    signerHealthStatus === 'degraded' ||
    signerHealthStatus === 'unavailable'
  ) {
    return {
      lifecycleStage: 'signer_attention',
      outboundReady: false,
      blockers,
      nextStep: 'repair_signer_health',
    }
  }

  return {
    lifecycleStage: 'active',
    outboundReady: blockers.length === 0,
    blockers,
    nextStep: blockers.length === 0 ? 'monitor_wallet_cycle' : 'operator_review',
  }
}

function buildAllowedActionKinds(agent: AgentRecord): ActionRequestKind[] {
  const kinds: ActionRequestKind[] = ['asset.transfer']
  if (agent.policyConfig.umbra) {
    kinds.push('service.pay')
  }
  return kinds
}

export async function buildDashboardAgentWalletCycle(input: {
  workspace: AgentSpendWorkspace
  agentId: string
  limit?: number
}): Promise<DashboardAgentWalletCycle | undefined> {
  const agent = await input.workspace.agentRegistry.get(input.agentId)
  if (!agent) {
    return undefined
  }

  const [wallet, actionRequestQuery, controlEvents] = await Promise.all([
    agent.walletId
      ? input.workspace.walletRegistry.get(agent.walletId)
      : Promise.resolve(undefined),
    input.workspace.actionRequestRegistry
      ? input.workspace.actionRequestRegistry.query({
          agentId: agent.agentId,
          limit: 500,
        })
      : Promise.resolve({
          records: [],
          summary: {
            totalMatching: 0,
            byStatus: {},
            byKind: {},
            bySource: {},
          },
        }),
    input.workspace.controlEventRegistry.list(),
  ])

  const limit = input.limit ?? 10
  const walletActions = actionRequestQuery.records
    .filter((record) =>
      isWalletCycleAction({
        record,
        walletId: wallet?.walletId ?? agent.walletId,
      }),
    )
    .sort(sortActionRequestsByRecency)
  const walletControlEvents = controlEvents
    .filter(
      (record) =>
        record.agentId === agent.agentId ||
        (agent.walletId != null && record.refs?.walletId === agent.walletId),
    )
    .sort(sortControlEventsByRecency)
  const byKind: Partial<Record<ActionRequestKind, number>> = {}
  const byStatus: Partial<Record<ActionRequestStatus, number>> = {}

  for (const record of walletActions) {
    incrementCount(byKind, record.kind)
    incrementCount(byStatus, record.status)
  }

  return {
    projectionMode:
      input.workspace.storageDriver === 'postgres'
        ? 'transactional_mirror'
        : 'shadow',
    agent: {
      agentId: agent.agentId,
      displayName: agent.displayName,
      status: agent.status,
      trustTier: agent.trustTier,
    },
    wallet: {
      walletId: wallet?.walletId ?? agent.walletId,
      address: wallet?.address,
      state: wallet?.state ?? agent.walletState,
      walletType: wallet?.walletType ?? agent.walletType,
      backend: agent.walletBackend,
      settlementMode: agent.settlementMode,
      complianceStatus: wallet?.complianceStatus,
      policyAttachmentStatus: wallet?.policyAttachmentStatus,
      signerHealthStatus: wallet?.signerHealthStatus,
      trustStatus: wallet?.trustStatus,
      supportedChains: wallet?.supportedChains ?? [],
    },
    readiness: deriveWalletReadiness({
      agent,
      wallet,
    }),
    policyScope: {
      allowedActionKinds: buildAllowedActionKinds(agent),
      allowedAssets: agent.policyConfig.allowedAssets ?? [],
      allowedChains: agent.policyConfig.allowedChains ?? [],
      allowedSignerClasses: agent.policyConfig.allowedSignerClasses ?? [],
      approvalThreshold:
        agent.policyConfig.transferPolicy?.autoApproveUnder ??
        agent.policyConfig.autoApproveUnder,
      maxTransferAmount:
        agent.policyConfig.transferPolicy?.maxPerTransfer ??
        agent.policyConfig.maxPerTransaction,
      privacyMode: readPrivacyMode(agent),
    },
    actions: {
      total: walletActions.length,
      byKind,
      byStatus,
      recent: walletActions.slice(0, limit).map((record) => ({
        actionRequestId: record.actionRequestId,
        kind: record.kind,
        status: record.status,
        title: record.title,
        summary: record.summary,
        updatedAt: record.updatedAt,
        value: record.value,
        target: record.target,
        resultRef: record.resultRef,
        errorCode: record.errorCode,
        errorMessage: record.errorMessage,
      })),
    },
    controls: {
      total: walletControlEvents.length,
      applied: walletControlEvents.filter((record) => record.status === 'applied')
        .length,
      noop: walletControlEvents.filter((record) => record.status === 'noop')
        .length,
      lastEventAt: walletControlEvents[0]?.at,
      recent: walletControlEvents.slice(0, limit).map((record) => ({
        controlEventId: record.controlEventId,
        at: record.at,
        type: record.type,
        status: record.status,
        summary: record.summary,
        refs: record.refs,
        metadata: record.metadata,
      })),
    },
  }
}
