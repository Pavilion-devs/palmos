import type {
  KernelTurnResult,
  SessionKernel,
} from '../../runtime/index.js'
import {
  evaluateSpendRequest,
  type AgentVendorRule,
} from '../policies/compileAgentPolicy.js'
import type { AgentRegistry, AgentRecord } from '../store/AgentRegistry.js'

export type RequestPaidActionInput = {
  agentId: string
  serviceId: string
  amount: string
  assetSymbol: string
  vendorId?: string
  destinationAddress?: string
  chainId?: string
  note?: string
}

export type RequestPaidActionDependencies = {
  kernel: SessionKernel
  agentRegistry: AgentRegistry
  now?: () => string
}

function resolveVendor(
  agent: AgentRecord,
  input: RequestPaidActionInput,
): AgentVendorRule | undefined {
  if (input.vendorId) {
    return agent.policyConfig.allowedVendors.find(
      (vendor) => vendor.vendorId === input.vendorId,
    )
  }

  if (input.destinationAddress) {
    return agent.policyConfig.allowedVendors.find(
      (vendor) => vendor.destinationAddress === input.destinationAddress,
    )
  }

  return undefined
}

function updateAgentStatusFromRun(agent: AgentRecord, run?: KernelTurnResult['run']): AgentRecord {
  if (!run) {
    return agent
  }

  if (run.status === 'waiting_for_approval') {
    return {
      ...agent,
      status: 'approval_pending',
    }
  }

  if (run.status === 'failed') {
    return {
      ...agent,
      status: 'restricted',
    }
  }

  return {
    ...agent,
    status: 'ready',
  }
}

export async function requestPaidAction(
  deps: RequestPaidActionDependencies,
  input: RequestPaidActionInput,
): Promise<
  | {
      kind: 'submitted'
      agent: AgentRecord
      spendDecision: ReturnType<typeof evaluateSpendRequest>
      turn: KernelTurnResult
    }
  | {
      kind: 'blocked'
      reason: string
      agent: AgentRecord
    }
> {
  const agent = await deps.agentRegistry.get(input.agentId)
  if (!agent) {
    throw new Error(`Unknown agent: ${input.agentId}`)
  }

  if (!agent.walletId) {
    throw new Error(`Agent ${input.agentId} does not have a wallet yet.`)
  }

  if (agent.status !== 'ready') {
    return {
      kind: 'blocked',
      reason: `Agent ${input.agentId} is not spend-ready. Current status: ${agent.status}.`,
      agent,
    }
  }

  const vendor = resolveVendor(agent, input)
  const spendDecision = evaluateSpendRequest({
    policy: agent.policyConfig,
    amount: input.amount,
    vendorId: input.vendorId ?? vendor?.vendorId,
    trustTier: agent.trustTier,
  })

  const at = deps.now?.() ?? new Date().toISOString()
  const baseAgent: AgentRecord = {
    ...agent,
    updatedAt: at,
    lastCheckInAt: at,
  }

  if (!vendor && !input.destinationAddress) {
    const blockedAgent: AgentRecord = {
      ...baseAgent,
      status: 'restricted',
    }
    await deps.agentRegistry.put(blockedAgent)
    return {
      kind: 'blocked',
      reason: 'No allowed vendor or destination was resolved for the paid action.',
      agent: blockedAgent,
    }
  }

  if (spendDecision.status === 'denied' && !vendor && input.vendorId) {
    const blockedAgent: AgentRecord = {
      ...baseAgent,
      status: 'restricted',
    }
    await deps.agentRegistry.put(blockedAgent)
    return {
      kind: 'blocked',
      reason: spendDecision.reasonCode,
      agent: blockedAgent,
    }
  }

  const session = await deps.kernel.loadOrCreateSession({
    sessionId: agent.sessionId,
    mode: 'api',
    environment: agent.environment,
    orgContext: {
      organizationId: agent.organizationId,
      treasuryIds: agent.treasuryId ? [agent.treasuryId] : undefined,
      walletIds: [agent.walletId],
    },
    actorContext: {
      actorId: agent.actorId,
      roleIds: ['agent'],
    },
  })

  const turn = await deps.kernel.handleInput({
    sessionId: session.sessionId,
    source: 'api',
    requestedActionType: 'asset.transfer',
    payload: {
      sourceWalletId: agent.walletId,
      destinationAddress: input.destinationAddress ?? vendor?.destinationAddress,
      chainId: input.chainId ?? vendor?.chainId ?? agent.policyConfig.allowedChains[0],
      assetSymbol: input.assetSymbol,
      amount: input.amount,
      counterpartyId: input.vendorId ?? vendor?.vendorId,
      note: input.note ?? `paid:${input.serviceId}`,
    },
  })

  const updatedAgent = updateAgentStatusFromRun(baseAgent, turn.run)
  await deps.agentRegistry.put(updatedAgent)

  return {
    kind: 'submitted',
    agent: updatedAgent,
    spendDecision,
    turn,
  }
}
