import type { AgentRecord } from '../store/AgentRegistry.js'
import type {
  PaidCallRecord,
  PaidCallRegistry,
} from '../store/PaidCallRegistry.js'
import type { AgentRegistry } from '../store/AgentRegistry.js'
import type { PalmosClient } from '../integrations/pusd/client.js'
import type { PalmosServiceCatalog } from '../integrations/pusd/serviceCatalog.js'
import type { X402Client } from '../integrations/x402/client.js'
import type { X402ServiceCatalog } from '../integrations/x402/serviceCatalog.js'
import type { OwsClient } from '../integrations/ows/client.js'
import type { XmtpNotifier } from '../integrations/xmtp/client.js'
import {
  FileWalletRegistry,
  type SessionKernel,
} from '../../runtime/index.js'
import {
  continueRuntimeBoundPaidExecution,
  loadRuntimeRunState,
  type ExecutePaidServiceCallDependencies,
} from './executePaidServiceCall.js'
import {
  createUmbraSettlementKernelFromConfig,
  isUmbraPaidCall,
  prepareUmbraFundingForApprovedExecution,
  readUmbraRuntimeConfig,
  updateUmbraExecutionFromRun,
} from '../integrations/umbra/index.js'

export type ReviewPendingPaidCallDependencies = {
  baseDir?: string
  kernel: SessionKernel
  agentRegistry: AgentRegistry
  paidCalls: PaidCallRegistry
  palmosClient?: PalmosClient
  x402Client?: X402Client
  owsClient?: OwsClient
  serviceCatalog?: PalmosServiceCatalog | X402ServiceCatalog
  xmtpNotifier?: XmtpNotifier
  env?: Record<string, string | undefined>
  now?: () => string
}

export type PendingPaidApproval = {
  execution: PaidCallRecord
  agent?: AgentRecord
}

export type ResolvePendingPaidCallApprovalInput = {
  executionId: string
  decision: 'approved' | 'rejected' | 'expired' | 'invalidated'
  approverActorId: string
  approverRole: string
  comment?: string
  decidedAt?: string
}

export class PaidCallApprovalConflictError extends Error {
  readonly code = 'approval_conflict'
  readonly currentStatus?: PaidCallRecord['status']

  constructor(executionId: string, currentStatus?: PaidCallRecord['status']) {
    super(
      `Paid execution ${executionId} is already being reviewed or is no longer pending approval. Current status: ${currentStatus ?? 'missing'}.`,
    )
    this.name = 'PaidCallApprovalConflictError'
    this.currentStatus = currentStatus
  }
}

function updateAgent(agentRegistry: AgentRegistry, agent: AgentRecord): Promise<void> {
  return agentRegistry.put(agent)
}

function nowIso(deps: { now?: () => string }): string {
  return deps.now?.() ?? new Date().toISOString()
}

function nextAgentStatusFromReview(input: {
  agent: AgentRecord
  recordStatus: PaidCallRecord['status']
  runStatus?: string
  decision: ResolvePendingPaidCallApprovalInput['decision']
}): AgentRecord {
  const at = new Date().toISOString()
  if (input.decision === 'approved' && input.runStatus === 'waiting_for_approval') {
    return {
      ...input.agent,
      status: 'approval_pending',
      updatedAt: at,
      lastCheckInAt: at,
    }
  }

  return {
    ...input.agent,
    status: input.recordStatus === 'blocked' ? 'restricted' : 'ready',
    updatedAt: at,
    lastCheckInAt: at,
  }
}

export async function listPendingPaidApprovals(input: {
  paidCalls: PaidCallRegistry
  agentRegistry?: AgentRegistry
}): Promise<PendingPaidApproval[]> {
  const records = (await input.paidCalls.list())
    .filter((record) => record.status === 'approval_pending')
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))

  const results: PendingPaidApproval[] = []
  for (const record of records) {
    const agent = input.agentRegistry
      ? await input.agentRegistry.get(record.agentId)
      : undefined
    results.push({
      execution: record,
      agent,
    })
  }

  return results
}

export async function resolvePendingPaidCallApproval(
  deps: ReviewPendingPaidCallDependencies,
  input: ResolvePendingPaidCallApprovalInput,
): Promise<
  | {
      kind: 'still_pending'
      execution: PaidCallRecord
      agent: AgentRecord
    }
  | {
      kind: 'rejected'
      execution: PaidCallRecord
      agent: AgentRecord
    }
  | {
      kind: 'approved'
      execution: PaidCallRecord
      agent: AgentRecord
    }
  | {
      kind: 'waiting_for_execution'
      execution: PaidCallRecord
      agent: AgentRecord
    }
  | {
      kind: 'executed'
      execution: PaidCallRecord
      agent: AgentRecord
    }
  | {
      kind: 'execution_failed'
      execution: PaidCallRecord
      agent: AgentRecord
      error: string
    }
> {
  const execution = await deps.paidCalls.get(input.executionId)
  if (!execution) {
    throw new Error(`Unknown paid execution: ${input.executionId}`)
  }

  if (execution.status !== 'approval_pending') {
    throw new PaidCallApprovalConflictError(input.executionId, execution.status)
  }

  const agent = await deps.agentRegistry.get(execution.agentId)
  if (!agent) {
    throw new Error(`Unknown agent for paid execution ${input.executionId}.`)
  }

  if (!execution.runId) {
    throw new Error(`Paid execution ${input.executionId} has no runtime runId.`)
  }
  const runId = execution.runId

  const claimedExecution: PaidCallRecord = {
    ...execution,
    status: 'waiting_for_execution',
    updatedAt: nowIso(deps),
    runtimeStatus: 'approval_decision_processing',
  }
  const claimed = await deps.paidCalls.putIfStatus(
    claimedExecution,
    'approval_pending',
  )
  if (!claimed) {
    const current = await deps.paidCalls.get(input.executionId)
    throw new PaidCallApprovalConflictError(input.executionId, current?.status)
  }

  try {
    const currentRun = await loadRuntimeRunState({
      deps: deps as ExecutePaidServiceCallDependencies,
      sessionId: claimedExecution.sessionId,
      runId,
    })

    let approvalKernel = deps.kernel
    if (input.decision === 'approved' && isUmbraPaidCall(claimedExecution)) {
      if (!deps.baseDir) {
        throw new Error(
          `Umbra approval for ${input.executionId} requires ReviewPendingPaidCallDependencies.baseDir.`,
        )
      }
      const umbraConfig = readUmbraRuntimeConfig(deps.env ?? process.env)
      await prepareUmbraFundingForApprovedExecution({
        baseDir: deps.baseDir,
        execution: claimedExecution,
        config: umbraConfig,
        prefundWrappedSol: (deps.env ?? process.env).UMBRA_PREFUND_WSOL !== 'false',
        now: deps.now,
      })
      approvalKernel = await createUmbraSettlementKernelFromConfig({
        baseDir: deps.baseDir,
        agentRegistry: deps.agentRegistry,
        walletRegistry: new FileWalletRegistry(deps.baseDir),
        config: umbraConfig,
        now: deps.now,
      })
    }

    await approvalKernel.ingestCallback({
      type: 'approval_decision',
      runId,
      status: input.decision,
      approvalStateRef: currentRun?.approvalStateRef,
      approvalRecord: {
        approver: {
          actorId: input.approverActorId,
          role: input.approverRole,
        },
        comment: input.comment,
        decidedAt: input.decidedAt ?? nowIso(deps),
      },
      summary:
        input.decision === 'approved'
          ? 'Manager approved the pending paid spend request.'
          : `Manager marked the pending paid spend request as ${input.decision}.`,
    })

    const refreshedRun = await loadRuntimeRunState({
      deps: {
        ...(deps as ExecutePaidServiceCallDependencies),
        kernel: approvalKernel,
      },
      sessionId: claimedExecution.sessionId,
      runId,
    })

    if (input.decision !== 'approved') {
      const rejectedRecord: PaidCallRecord = {
        ...claimedExecution,
        status: 'failed',
        updatedAt: nowIso(deps),
        runtimeStatus: refreshedRun?.status ?? execution.runtimeStatus,
        runtimePhase: refreshedRun?.currentPhase ?? execution.runtimePhase,
        errorCode: `approval.${input.decision}`,
        errorMessage: `Paid execution ${input.executionId} was ${input.decision} during terminal approval review.`,
      }
      await deps.paidCalls.put(rejectedRecord)
      const updatedAgent = nextAgentStatusFromReview({
        agent,
        recordStatus: rejectedRecord.status,
        runStatus: refreshedRun?.status,
        decision: input.decision,
      })
      await updateAgent(deps.agentRegistry, updatedAgent)
      await deps.xmtpNotifier?.sendApprovalResolved({
        agent: updatedAgent,
        execution: rejectedRecord,
        decision: input.decision,
      })
      return {
        kind: 'rejected',
        execution: rejectedRecord,
        agent: updatedAgent,
      }
    }

    if (refreshedRun?.status === 'waiting_for_approval') {
      const pendingRecord: PaidCallRecord = {
        ...claimedExecution,
        status: 'approval_pending',
        updatedAt: nowIso(deps),
        runtimeStatus: refreshedRun.status,
        runtimePhase: refreshedRun.currentPhase,
      }
      await deps.paidCalls.put(pendingRecord)
      const updatedAgent = nextAgentStatusFromReview({
        agent,
        recordStatus: pendingRecord.status,
        runStatus: refreshedRun.status,
        decision: input.decision,
      })
      await updateAgent(deps.agentRegistry, updatedAgent)
      return {
        kind: 'still_pending',
        execution: pendingRecord,
        agent: updatedAgent,
      }
    }

    if (input.decision === 'approved' && isUmbraPaidCall(claimedExecution)) {
      const updatedExecution = await updateUmbraExecutionFromRun({
        paidCallRegistry: deps.paidCalls,
        execution: claimedExecution,
        run: refreshedRun,
        now: deps.now,
      })
      const updatedAgent = nextAgentStatusFromReview({
        agent,
        recordStatus: updatedExecution.status,
        runStatus: updatedExecution.runtimeStatus,
        decision: input.decision,
      })
      await updateAgent(deps.agentRegistry, updatedAgent)
      await deps.xmtpNotifier?.sendApprovalResolved({
        agent: updatedAgent,
        execution: updatedExecution,
        decision: input.decision,
      })

      if (updatedExecution.status === 'executed') {
        return {
          kind: 'executed',
          execution: updatedExecution,
          agent: updatedAgent,
        }
      }
      if (updatedExecution.status === 'waiting_for_execution') {
        return {
          kind: 'waiting_for_execution',
          execution: updatedExecution,
          agent: updatedAgent,
        }
      }
      return {
        kind: 'execution_failed',
        execution: updatedExecution,
        agent: updatedAgent,
        error:
          updatedExecution.errorMessage ??
          'Umbra private settlement did not complete after approval.',
      }
    }

    const executionResult = await continueRuntimeBoundPaidExecution(
      deps as ExecutePaidServiceCallDependencies,
      {
        agent,
        execution: {
          ...claimedExecution,
          updatedAt: nowIso(deps),
          runtimeStatus: refreshedRun?.status ?? execution.runtimeStatus,
          runtimePhase: refreshedRun?.currentPhase ?? execution.runtimePhase,
        },
        requestPayload: claimedExecution.requestPayload ?? claimedExecution.requestSummary,
      },
    )

    const updatedAgent = nextAgentStatusFromReview({
      agent,
      recordStatus: executionResult.execution.status,
      runStatus: executionResult.execution.runtimeStatus,
      decision: input.decision,
    })
    await updateAgent(deps.agentRegistry, updatedAgent)
    await deps.xmtpNotifier?.sendApprovalResolved({
      agent: updatedAgent,
      execution: executionResult.execution,
      decision: input.decision,
    })

    if (executionResult.kind === 'waiting_for_execution') {
      return {
        kind: 'waiting_for_execution',
        execution: executionResult.execution,
        agent: updatedAgent,
      }
    }

    if (executionResult.kind === 'executed') {
      return {
        kind: 'executed',
        execution: executionResult.execution,
        agent: updatedAgent,
      }
    }

    if (executionResult.kind === 'execution_failed') {
      return {
        kind: 'execution_failed',
        execution: executionResult.execution,
        agent: updatedAgent,
        error: executionResult.error,
      }
    }

    throw new Error('Unexpected paid execution result after approval.')
  } catch (error) {
    const current = await deps.paidCalls.get(input.executionId)
    if (current?.status === 'waiting_for_execution') {
      await deps.paidCalls.put({
        ...current,
        status: 'failed',
        updatedAt: nowIso(deps),
        errorCode: 'approval.review_failed',
        errorMessage:
          error instanceof Error
            ? error.message
            : 'Approval review failed before execution completed.',
      })
    }
    throw error
  }
}
