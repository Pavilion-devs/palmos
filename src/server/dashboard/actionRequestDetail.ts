import type { RunState } from '../../../runtime/index.js'
import type { ActionRequestRecord } from '../../store/ActionRequestRegistry.js'
import type { AgentRecord } from '../../store/AgentRegistry.js'
import type { DashboardAuditLogRecord } from '../../store/DashboardAuditLogRegistry.js'
import type { AgentSpendWorkspace } from '../../workspace/loadWorkspace.js'

export type DashboardActionRequestDetail = {
  projectionMode: 'shadow' | 'transactional_mirror'
  actionRequest: {
    actionRequestId: string
    createdAt: string
    updatedAt: string
    agentId: string
    organizationId?: string
    treasuryId?: string
    walletId?: string
    source: ActionRequestRecord['source']
    kind: ActionRequestRecord['kind']
    status: ActionRequestRecord['status']
    title: string
    summary: string
    target: ActionRequestRecord['target']
    value?: ActionRequestRecord['value']
    requestPayload: ActionRequestRecord['requestPayload']
    requestContext?: ActionRequestRecord['requestContext']
    policy: ActionRequestRecord['policy']
    executionPlan?: ActionRequestRecord['executionPlan']
    resultRef?: string
    errorCode?: string
    errorMessage?: string
  }
  agent?: {
    agentId: string
    displayName: string
    status: AgentRecord['status']
    trustTier: AgentRecord['trustTier']
    walletId?: string
    walletState?: AgentRecord['walletState']
    settlementMode?: AgentRecord['settlementMode']
    walletBackend?: AgentRecord['walletBackend']
    lastCheckInAt: string
  }
  runtime?: {
    sessionId?: string
    runId?: string
    found: boolean
    actionType?: RunState['actionType']
    status?: RunState['status']
    currentPhase?: RunState['currentPhase']
    lastUpdatedAt?: string
    approvalStateRef?: string
    reportRef?: string
    intentRef?: RunState['intentRef']
    policyRef?: RunState['policyRef']
    refs: {
      simulationRefs: string[]
      signatureRequestRefs: string[]
      signatureResultRefs: string[]
      broadcastRefs: string[]
    }
  }
  compatibility: {
    derivedFromLegacyPaidCall: boolean
    legacyRecordType?: string
  }
  auditTrail: Array<{
    auditLogId: string
    at: string
    action: DashboardAuditLogRecord['action']
    status: DashboardAuditLogRecord['status']
    actorId: string
    operatorId: string
    operatorRole: DashboardAuditLogRecord['operatorRole']
    source: DashboardAuditLogRecord['source']
    summary: string
    metadata?: DashboardAuditLogRecord['metadata']
  }>
}

function projectActionRequestDetail(input: {
  record: ActionRequestRecord
  agent?: AgentRecord
  run?: RunState
  auditTrail?: DashboardAuditLogRecord[]
  projectionMode: DashboardActionRequestDetail['projectionMode']
}): DashboardActionRequestDetail {
  const legacyRecordType =
    typeof input.record.requestContext?.legacyRecordType === 'string'
      ? input.record.requestContext.legacyRecordType
      : undefined

  return {
    projectionMode: input.projectionMode,
    actionRequest: {
      actionRequestId: input.record.actionRequestId,
      createdAt: input.record.createdAt,
      updatedAt: input.record.updatedAt,
      agentId: input.record.agentId,
      organizationId: input.record.organizationId,
      treasuryId: input.record.treasuryId,
      walletId: input.record.walletId,
      source: input.record.source,
      kind: input.record.kind,
      status: input.record.status,
      title: input.record.title,
      summary: input.record.summary,
      target: input.record.target,
      value: input.record.value,
      requestPayload: input.record.requestPayload,
      requestContext: input.record.requestContext,
      policy: input.record.policy,
      executionPlan: input.record.executionPlan,
      resultRef: input.record.resultRef,
      errorCode: input.record.errorCode,
      errorMessage: input.record.errorMessage,
    },
    agent: input.agent
      ? {
          agentId: input.agent.agentId,
          displayName: input.agent.displayName,
          status: input.agent.status,
          trustTier: input.agent.trustTier,
          walletId: input.agent.walletId,
          walletState: input.agent.walletState,
          settlementMode: input.agent.settlementMode,
          walletBackend: input.agent.walletBackend,
          lastCheckInAt: input.agent.lastCheckInAt,
        }
      : undefined,
    runtime: {
      sessionId: input.record.runtimeRefs?.sessionId,
      runId: input.record.runtimeRefs?.runId,
      found: Boolean(input.run),
      actionType: input.run?.actionType,
      status: input.run?.status,
      currentPhase: input.run?.currentPhase,
      lastUpdatedAt: input.run?.lastUpdatedAt,
      approvalStateRef: input.run?.approvalStateRef,
      reportRef: input.run?.reportRef,
      intentRef: input.run?.intentRef,
      policyRef: input.run?.policyRef,
      refs: {
        simulationRefs: input.run?.simulationRefs ?? [],
        signatureRequestRefs: input.run?.signatureRequestRefs ?? [],
        signatureResultRefs: input.run?.signatureResultRefs ?? [],
        broadcastRefs: input.run?.broadcastRefs ?? [],
      },
    },
    compatibility: {
      derivedFromLegacyPaidCall: legacyRecordType === 'PaidCall',
      legacyRecordType,
    },
    auditTrail: (input.auditTrail ?? [])
      .sort((left, right) => left.at.localeCompare(right.at))
      .map((entry) => ({
        auditLogId: entry.auditLogId,
        at: entry.at,
        action: entry.action,
        status: entry.status,
        actorId: entry.actorId,
        operatorId: entry.operatorId,
        operatorRole: entry.operatorRole,
        source: entry.source,
        summary: entry.summary,
        metadata: entry.metadata,
      })),
  }
}

export async function buildDashboardActionRequestDetail(input: {
  workspace: AgentSpendWorkspace
  actionRequestId: string
}): Promise<DashboardActionRequestDetail | undefined> {
  const registry = input.workspace.actionRequestRegistry
  if (!registry) {
    throw new Error('ActionRequest registry is not available in this workspace.')
  }

  const record = await registry.get(input.actionRequestId)
  if (!record) {
    return undefined
  }

  const [agent, run, auditTrail] = await Promise.all([
    input.workspace.agentRegistry.get(record.agentId),
    record.runtimeRefs?.runId
      ? input.workspace.runRegistry.get(record.runtimeRefs.runId)
      : Promise.resolve(undefined),
    input.workspace.dashboardAuditLogRegistry
      ?.list()
      .then((records) =>
        records.filter(
          (entry) =>
            entry.target?.type === 'action_request' &&
            entry.target.id === record.actionRequestId,
        ),
      ) ?? Promise.resolve([]),
  ])

  return projectActionRequestDetail({
    record,
    agent,
    run,
    auditTrail,
    projectionMode:
      input.workspace.storageDriver === 'postgres'
        ? 'transactional_mirror'
        : 'shadow',
  })
}
