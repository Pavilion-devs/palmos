import { parsePusdAmountToBaseUnits } from '../integrations/pusd/amount.js'
import type {
  ActionRequestRecord,
  ActionRequestRegistry,
} from '../store/ActionRequestRegistry.js'
import type { AgentRecord, AgentRegistry } from '../store/AgentRegistry.js'

export type WalletPolicyUpdatePatch = {
  sessionBudget?: string
  maxPerTransaction?: string
  autoApproveUnder?: string
  heartbeatTimeoutSeconds?: number
}

export type RequestWalletPolicyUpdateDependencies = {
  agentRegistry: AgentRegistry
  actionRequests?: ActionRequestRegistry
  now?: () => string
  createId?: (prefix: string) => string
}

export type WalletPolicyUpdatePlan = {
  nextBudget?: string
  nextMax: string
  nextAuto: string
  nextHeartbeatTimeoutSeconds: number
}

export type RequestWalletPolicyUpdateResult =
  | {
      kind: 'not_found'
      agentId: string
      message: string
    }
  | {
      kind: 'blocked'
      agent: AgentRecord
      actionRequest?: ActionRequestRecord
      code: 'policy.invalid_wallet_policy_update' | 'agent.archived'
      message: string
      httpStatus: 400 | 409
    }
  | {
      kind: 'conflict'
      agent: AgentRecord
      currentAgent?: AgentRecord
      actionRequest?: ActionRequestRecord
      code: 'agent_conflict'
      message: string
    }
  | {
      kind: 'executed'
      agent: AgentRecord
      actionRequest?: ActionRequestRecord
      plan: WalletPolicyUpdatePlan
    }

function createActionRequestId(
  deps: Pick<RequestWalletPolicyUpdateDependencies, 'createId'>,
): string {
  return deps.createId
    ? deps.createId('action_request')
    : `action_request_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function nowIso(
  deps: Pick<RequestWalletPolicyUpdateDependencies, 'now'>,
): string {
  return deps.now?.() ?? new Date().toISOString()
}

function buildWalletPolicyUpdateActionRequest(input: {
  actionRequestId: string
  at: string
  agent: AgentRecord
  patch: WalletPolicyUpdatePatch
  actorId?: string
  operatorRole?: string
}): ActionRequestRecord {
  return {
    actionRequestId: input.actionRequestId,
    createdAt: input.at,
    updatedAt: input.at,
    agentId: input.agent.agentId,
    organizationId: input.agent.organizationId,
    treasuryId: input.agent.treasuryId,
    walletId: input.agent.walletId,
    source: 'dashboard',
    kind: 'wallet.policy_update',
    status: 'created',
    target: {
      kind: 'wallet',
      walletId: input.agent.walletId ?? `agent:${input.agent.agentId}`,
      chainId: input.agent.policyConfig.allowedChains?.[0],
    },
    title: 'Update wallet policy',
    summary: `Requested wallet policy update for ${input.agent.displayName}.`,
    requestPayload: {
      ...input.patch,
    },
    requestContext: {
      nativeActionRequest: true,
      requestSource: 'dashboard',
      intakeStage: 'created',
      actorId: input.actorId,
      operatorRole: input.operatorRole,
      previousPolicy: {
        sessionBudget: input.agent.policyConfig.sessionBudget,
        maxPerTransaction: input.agent.policyConfig.maxPerTransaction,
        autoApproveUnder: input.agent.policyConfig.autoApproveUnder,
        heartbeatTimeoutSeconds:
          input.agent.policyConfig.heartbeatTimeoutSeconds,
      },
    },
    policy: {
      approvalRequired: false,
      limitsApplied: {
        nativeActionRequest: true,
        policyUpdate: true,
      },
    },
    executionPlan: {
      connectorKind: 'direct',
      privacyMode: 'off',
      executionMode: 'connector',
    },
  }
}

function markWalletPolicyUpdateBlocked(input: {
  record: ActionRequestRecord
  at: string
  errorCode: string
  errorMessage: string
}): ActionRequestRecord {
  return {
    ...input.record,
    updatedAt: input.at,
    status: 'blocked',
    requestContext: {
      ...input.record.requestContext,
      intakeStage: 'blocked',
    },
    errorCode: input.errorCode,
    errorMessage: input.errorMessage,
  }
}

function markWalletPolicyUpdateExecuted(input: {
  record: ActionRequestRecord
  at: string
  agent: AgentRecord
  plan: WalletPolicyUpdatePlan
}): ActionRequestRecord {
  return {
    ...input.record,
    updatedAt: input.at,
    status: 'executed',
    requestContext: {
      ...input.record.requestContext,
      intakeStage: 'executed',
      appliedPolicy: {
        sessionBudget: input.agent.policyConfig.sessionBudget,
        maxPerTransaction: input.agent.policyConfig.maxPerTransaction,
        autoApproveUnder: input.agent.policyConfig.autoApproveUnder,
        heartbeatTimeoutSeconds:
          input.agent.policyConfig.heartbeatTimeoutSeconds,
      },
    },
    policy: {
      ...input.record.policy,
      limitsApplied: {
        ...input.record.policy.limitsApplied,
        policyUpdate: true,
        nextBudget: input.plan.nextBudget,
        nextMaxPerTransaction: input.plan.nextMax,
        nextAutoApproveUnder: input.plan.nextAuto,
        nextHeartbeatTimeoutSeconds: input.plan.nextHeartbeatTimeoutSeconds,
      },
    },
    resultRef: `agent:${input.agent.agentId}:wallet_policy:${input.at}`,
  }
}

function markWalletPolicyUpdateFailed(input: {
  record: ActionRequestRecord
  at: string
  errorCode: string
  errorMessage: string
}): ActionRequestRecord {
  return {
    ...input.record,
    updatedAt: input.at,
    status: 'failed',
    requestContext: {
      ...input.record.requestContext,
      intakeStage: 'failed',
    },
    errorCode: input.errorCode,
    errorMessage: input.errorMessage,
  }
}

function planWalletPolicyUpdate(input: {
  agent: AgentRecord
  patch: WalletPolicyUpdatePatch
}): WalletPolicyUpdatePlan {
  return {
    nextBudget: input.patch.sessionBudget ?? input.agent.policyConfig.sessionBudget,
    nextMax:
      input.patch.maxPerTransaction ?? input.agent.policyConfig.maxPerTransaction,
    nextAuto:
      input.patch.autoApproveUnder ?? input.agent.policyConfig.autoApproveUnder,
    nextHeartbeatTimeoutSeconds:
      input.patch.heartbeatTimeoutSeconds ??
      input.agent.policyConfig.heartbeatTimeoutSeconds,
  }
}

function validateWalletPolicyUpdatePlan(
  plan: WalletPolicyUpdatePlan,
): { ok: true } | { ok: false; message: string } {
  if (parsePusdAmountToBaseUnits(plan.nextAuto) > parsePusdAmountToBaseUnits(plan.nextMax)) {
    return {
      ok: false,
      message: 'Auto-approve threshold cannot exceed max per call.',
    }
  }

  if (
    plan.nextBudget &&
    parsePusdAmountToBaseUnits(plan.nextBudget) <
      parsePusdAmountToBaseUnits(plan.nextMax)
  ) {
    return {
      ok: false,
      message: 'Session budget must be greater than or equal to max per call.',
    }
  }

  return { ok: true }
}

function applyWalletPolicyUpdate(input: {
  agent: AgentRecord
  at: string
  plan: WalletPolicyUpdatePlan
}): AgentRecord {
  return {
    ...input.agent,
    updatedAt: input.at,
    policyConfig: {
      ...input.agent.policyConfig,
      sessionBudget: input.plan.nextBudget,
      maxPerTransaction: input.plan.nextMax,
      autoApproveUnder: input.plan.nextAuto,
      heartbeatTimeoutSeconds: input.plan.nextHeartbeatTimeoutSeconds,
    },
  }
}

async function putActionRequest(
  registry: ActionRequestRegistry | undefined,
  record: ActionRequestRecord | undefined,
): Promise<void> {
  if (!registry || !record) {
    return
  }
  await registry.put(record)
}

export async function requestWalletPolicyUpdate(
  deps: RequestWalletPolicyUpdateDependencies,
  input: {
    agentId: string
    patch: WalletPolicyUpdatePatch
    actorId?: string
    operatorRole?: string
  },
): Promise<RequestWalletPolicyUpdateResult> {
  const agent = await deps.agentRegistry.get(input.agentId)
  if (!agent) {
    return {
      kind: 'not_found',
      agentId: input.agentId,
      message: `Agent ${input.agentId} was not found.`,
    }
  }

  const createdAt = nowIso(deps)
  const actionRequest = deps.actionRequests
    ? buildWalletPolicyUpdateActionRequest({
        actionRequestId: createActionRequestId(deps),
        at: createdAt,
        agent,
        patch: input.patch,
        actorId: input.actorId,
        operatorRole: input.operatorRole,
      })
    : undefined
  await putActionRequest(deps.actionRequests, actionRequest)

  if (agent.status === 'archived') {
    const blocked = actionRequest
      ? markWalletPolicyUpdateBlocked({
          record: actionRequest,
          at: nowIso(deps),
          errorCode: 'agent.archived',
          errorMessage: 'Archived agents cannot be edited.',
        })
      : undefined
    await putActionRequest(deps.actionRequests, blocked)
    return {
      kind: 'blocked',
      agent,
      actionRequest: blocked,
      code: 'agent.archived',
      message: 'Archived agents cannot be edited.',
      httpStatus: 409,
    }
  }

  const plan = planWalletPolicyUpdate({
    agent,
    patch: input.patch,
  })
  const validation = validateWalletPolicyUpdatePlan(plan)
  if (!validation.ok) {
    const blocked = actionRequest
      ? markWalletPolicyUpdateBlocked({
          record: actionRequest,
          at: nowIso(deps),
          errorCode: 'policy.invalid_wallet_policy_update',
          errorMessage: validation.message,
        })
      : undefined
    await putActionRequest(deps.actionRequests, blocked)
    return {
      kind: 'blocked',
      agent,
      actionRequest: blocked,
      code: 'policy.invalid_wallet_policy_update',
      message: validation.message,
      httpStatus: 400,
    }
  }

  const updatedAgent = applyWalletPolicyUpdate({
    agent,
    at: nowIso(deps),
    plan,
  })
  const saved = await deps.agentRegistry.putIfUpdatedAt(updatedAgent, agent.updatedAt)
  if (!saved) {
    const currentAgent = await deps.agentRegistry.get(input.agentId)
    const failed = actionRequest
      ? markWalletPolicyUpdateFailed({
          record: actionRequest,
          at: nowIso(deps),
          errorCode: 'agent_conflict',
          errorMessage:
            'Agent changed while the wallet policy update was in progress.',
        })
      : undefined
    await putActionRequest(deps.actionRequests, failed)
    return {
      kind: 'conflict',
      agent,
      currentAgent,
      actionRequest: failed,
      code: 'agent_conflict',
      message: 'Agent changed while the policy update was in progress.',
    }
  }

  const executed = actionRequest
    ? markWalletPolicyUpdateExecuted({
        record: actionRequest,
        at: updatedAgent.updatedAt,
        agent: updatedAgent,
        plan,
      })
    : undefined
  await putActionRequest(deps.actionRequests, executed)
  return {
    kind: 'executed',
    agent: updatedAgent,
    actionRequest: executed,
    plan,
  }
}
