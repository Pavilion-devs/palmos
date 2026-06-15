/**
 * requestAssetSwap — governed Byreal swap as a PalmOS `asset.swap` action request.
 *
 * This is C3 of the Byreal integration (see byrealintegration.md, Appendix A.3). It is the
 * governance spine that turns a raw swap into a *governed* action, mirroring the create → policy →
 * settle skeleton of `settleAssetTransferViaOws` (src/app/requestAssetTransfer.ts):
 *
 *   create asset.swap request  ->  evaluateSwapRequest (policy gate)
 *        -> denied            => blocked
 *        -> requiresApproval  => approval_pending  (surfaces in the operator approval queue)
 *        -> auto-approved     => C1 buildSwapUnsigned -> C2 signAndBroadcastSolanaTx -> executed
 *
 * Unlike a transfer it does NOT go through the runtime kernel (which only knows asset.transfer);
 * settlement is the keyless Byreal build + OWS vault signature ("Byreal proposes, OWS signs").
 * On any settlement error the record flips to `failed` — never a faked success. Deps are
 * structurally typed so the real registries/clients and in-memory test fakes both satisfy them.
 */
import type {
  ActionRequestRecord,
  ActionRequestSource,
  ActionRequestStatus,
} from '../store/ActionRequestRegistry.js'
import type { AgentRecord } from '../store/AgentRegistry.js'
import { evaluateSwapRequest, type SwapDecision } from '../policies/compileAgentPolicy.js'
import type { ByrealClient } from '../integrations/byreal/client.js'
import type { OwsClient } from '../integrations/ows/client.js'
import type { MantleRecorder } from '../integrations/mantle/client.js'
import { recordGovernedDecisionOnMantle } from './mantleDecisionRecording.js'

export type RequestAssetSwapInput = {
  agentId: string
  inputMint: string
  outputMint: string
  inputAssetSymbol: string
  outputAssetSymbol: string
  /** UI amount of the input token to swap, e.g. "0.5". */
  amount: string
  swapMode?: 'in' | 'out'
  slippageBps?: number
  /** Defaults to "solana" (Byreal is Solana-native); must match the agent's policy chain. */
  chainId?: string
  note?: string
  source?: ActionRequestSource
  eligibleAgentStatuses?: AgentRecord['status'][]
}

export type RequestAssetSwapDependencies = {
  agentRegistry: {
    get(agentId: string): Promise<AgentRecord | undefined>
    put(agent: AgentRecord): Promise<unknown>
  }
  actionRequests: { put(record: ActionRequestRecord): Promise<unknown> }
  byrealClient?: Pick<ByrealClient, 'buildSwapUnsigned'>
  owsClient?: Pick<OwsClient, 'signAndBroadcastSolanaTx' | 'getSolanaAddress'>
  /**
   * Optional Mantle decision-log recorder. After the decision resolves, the verdict + outcome
   * (incl. denied/blocked) are recorded on Mantle and the tx ref stamped onto the action request.
   * Best-effort: a recorder failure never affects the Solana settlement. Gated by MANTLE_RECORD_LIVE.
   */
  mantleRecorder?: MantleRecorder
  /** Sign but do not broadcast — for dry runs / tests. */
  simulateSettlement?: boolean
  now?: () => string
  createId?: (prefix: string) => string
}

export type RequestAssetSwapResult =
  | { kind: 'blocked'; agent: AgentRecord; actionRequest: ActionRequestRecord; reason: string }
  | { kind: 'approval_pending'; agent: AgentRecord; actionRequest: ActionRequestRecord }
  | { kind: 'executed'; agent: AgentRecord; actionRequest: ActionRequestRecord }
  | { kind: 'waiting_for_execution'; agent: AgentRecord; actionRequest: ActionRequestRecord }
  | { kind: 'execution_failed'; agent: AgentRecord; actionRequest: ActionRequestRecord; error: string }

function nowIso(deps: Pick<RequestAssetSwapDependencies, 'now'>): string {
  return deps.now?.() ?? new Date().toISOString()
}

function createActionRequestId(deps: Pick<RequestAssetSwapDependencies, 'createId'>): string {
  return deps.createId
    ? deps.createId('action_request')
    : `action_request_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function describeSwapPolicyFailure(decision: SwapDecision, input: RequestAssetSwapInput): string {
  switch (decision.reasonCode) {
    case 'policy.swap_chain_not_allowed':
      return `Chain ${input.chainId ?? 'solana'} is not allowed for this agent's swap policy.`
    case 'policy.swap_asset_not_allowed':
      return `Asset ${decision.disallowedAsset ?? ''} is not allowed for this agent's swap policy.`
    case 'policy.swap_slippage_exceeds_cap':
      return `Swap slippage ${input.slippageBps ?? ''}bps exceeds this agent's risk policy cap.`
    case 'policy.swap_amount_exceeds_limit':
      return `Swap amount ${input.amount} ${input.inputAssetSymbol} exceeds the effective limit of ${decision.effectiveMaxSwapAmount}.`
    case 'policy.agent_restricted':
      return `Agent ${input.agentId} is restricted from initiating swaps.`
    case 'policy.invalid_amount':
      return `Swap amount ${input.amount} is invalid for this agent's swap policy.`
    default:
      return decision.reasonCode
  }
}

function applyAgentStatus(
  agent: AgentRecord,
  status: ActionRequestStatus,
  at: string,
): AgentRecord {
  const nextStatus: AgentRecord['status'] =
    status === 'approval_pending'
      ? 'approval_pending'
      : status === 'blocked' || status === 'failed'
        ? 'restricted'
        : 'ready'
  return { ...agent, status: nextStatus, updatedAt: at, lastCheckInAt: at }
}

function buildInitialSwapRecord(input: {
  actionRequestId: string
  at: string
  agent: AgentRecord
  request: RequestAssetSwapInput
  chainId: string
}): ActionRequestRecord {
  const source = input.request.source ?? 'system'
  const { request } = input
  return {
    actionRequestId: input.actionRequestId,
    createdAt: input.at,
    updatedAt: input.at,
    agentId: input.agent.agentId,
    organizationId: input.agent.organizationId,
    treasuryId: input.agent.treasuryId,
    walletId: input.agent.walletId,
    source,
    kind: 'asset.swap',
    status: 'created',
    target: { kind: 'wallet', walletId: input.agent.walletId ?? input.agent.agentId, chainId: input.chainId },
    value: { assetSymbol: request.inputAssetSymbol, amount: request.amount, chainId: input.chainId },
    title: `Swap ${request.amount} ${request.inputAssetSymbol} → ${request.outputAssetSymbol}`,
    summary: `Requested swap of ${request.amount} ${request.inputAssetSymbol} to ${request.outputAssetSymbol} on Byreal.`,
    requestPayload: {
      inputMint: request.inputMint,
      outputMint: request.outputMint,
      inputAssetSymbol: request.inputAssetSymbol,
      outputAssetSymbol: request.outputAssetSymbol,
      amount: request.amount,
      swapMode: request.swapMode,
      slippageBps: request.slippageBps,
      note: request.note,
    },
    requestContext: {
      requestSource: source,
      intakeStage: 'created',
      nativeActionRequest: true,
      settlementVia: 'byreal',
    },
    policy: { approvalRequired: false },
    executionPlan: {
      connectorKind: 'direct',
      settlementAsset: request.inputAssetSymbol,
      privacyMode: 'off',
      executionMode: 'ows',
    },
    runtimeRefs: { sessionId: input.agent.sessionId, intentIds: [] },
  }
}

function withSwapPolicySnapshot(input: {
  record: ActionRequestRecord
  at: string
  status: ActionRequestStatus
  decision: SwapDecision
  errorCode?: string
  errorMessage?: string
}): ActionRequestRecord {
  return {
    ...input.record,
    updatedAt: input.at,
    status: input.status,
    policy: {
      approvalRequired: input.decision.requiresApproval,
      approvalReason: input.decision.requiresApproval ? input.decision.reasonCode : undefined,
      limitsApplied: {
        nativeActionRequest: true,
        effectiveMaxSwapAmount: input.decision.effectiveMaxSwapAmount,
        swapDecisionStatus: input.decision.status,
        reasonCode: input.decision.reasonCode,
      },
    },
    requestContext: { ...input.record.requestContext, intakeStage: input.status },
    errorCode: input.errorCode,
    errorMessage: input.errorMessage,
  }
}

export async function requestAssetSwap(
  deps: RequestAssetSwapDependencies,
  input: RequestAssetSwapInput,
): Promise<RequestAssetSwapResult> {
  const result = await runRequestAssetSwap(deps, input)
  // Additive Mantle audit layer — record the governed decision + outcome on-chain (best-effort).
  const actionRequest = await recordGovernedDecisionOnMantle({
    recorder: deps.mantleRecorder,
    actionRequests: deps.actionRequests,
    actionRequest: result.actionRequest,
    kind: 'asset.swap',
    resultKind: result.kind,
  })
  return { ...result, actionRequest }
}

async function runRequestAssetSwap(
  deps: RequestAssetSwapDependencies,
  input: RequestAssetSwapInput,
): Promise<RequestAssetSwapResult> {
  const agent = await deps.agentRegistry.get(input.agentId)
  if (!agent) {
    throw new Error(`Unknown agent: ${input.agentId}`)
  }

  const at = nowIso(deps)
  const chainId = input.chainId ?? 'solana'
  const record = buildInitialSwapRecord({
    actionRequestId: createActionRequestId(deps),
    at,
    agent,
    request: input,
    chainId,
  })
  await deps.actionRequests.put(record)

  // Readiness gate (mirrors the transfer flow).
  const eligibleAgentStatuses = input.eligibleAgentStatuses ?? ['ready']
  if (!eligibleAgentStatuses.includes(agent.status)) {
    const blocked: ActionRequestRecord = {
      ...record,
      updatedAt: at,
      status: 'blocked',
      errorCode: 'policy.agent_not_ready',
      errorMessage: `Agent ${input.agentId} is not swap-ready. Current status: ${agent.status}.`,
    }
    await deps.actionRequests.put(blocked)
    const updatedAgent = applyAgentStatus(agent, 'blocked', at)
    await deps.agentRegistry.put(updatedAgent)
    return { kind: 'blocked', agent: updatedAgent, actionRequest: blocked, reason: blocked.errorMessage! }
  }

  // Policy gate.
  const decision = evaluateSwapRequest({
    policy: agent.policyConfig,
    inputAssetSymbol: input.inputAssetSymbol,
    outputAssetSymbol: input.outputAssetSymbol,
    inputAmount: input.amount,
    chainId,
    trustTier: agent.trustTier,
    slippageBps: input.slippageBps,
  })

  if (decision.status === 'denied') {
    const reason = describeSwapPolicyFailure(decision, input)
    const blocked = withSwapPolicySnapshot({
      record,
      at,
      status: 'blocked',
      decision,
      errorCode: decision.reasonCode,
      errorMessage: reason,
    })
    await deps.actionRequests.put(blocked)
    const updatedAgent = applyAgentStatus(agent, 'blocked', at)
    await deps.agentRegistry.put(updatedAgent)
    return { kind: 'blocked', agent: updatedAgent, actionRequest: blocked, reason }
  }

  if (decision.requiresApproval) {
    const pending = withSwapPolicySnapshot({ record, at, status: 'approval_pending', decision })
    await deps.actionRequests.put(pending)
    const updatedAgent = applyAgentStatus(agent, 'approval_pending', at)
    await deps.agentRegistry.put(updatedAgent)
    return { kind: 'approval_pending', agent: updatedAgent, actionRequest: pending }
  }

  // Auto-approved -> settle via Byreal (C1) + OWS (C2).
  const policyChecked = withSwapPolicySnapshot({ record, at, status: 'approved', decision })
  await deps.actionRequests.put(policyChecked)

  if (agent.walletBackend !== 'ows' || !deps.byrealClient || !deps.owsClient) {
    // Approved but no real settlement backend wired — leave it pending execution.
    const waiting: ActionRequestRecord = { ...policyChecked, updatedAt: nowIso(deps), status: 'waiting_for_execution' }
    await deps.actionRequests.put(waiting)
    return { kind: 'waiting_for_execution', agent, actionRequest: waiting }
  }

  try {
    const walletName = agent.owsWalletName ?? agent.owsWalletId ?? agent.agentId
    const ownerPubkey = deps.owsClient.getSolanaAddress(walletName)
    if (!ownerPubkey) {
      throw new Error(`OWS wallet ${walletName} has no Solana account.`)
    }
    const built = await deps.byrealClient.buildSwapUnsigned({
      inputMint: input.inputMint,
      outputMint: input.outputMint,
      amount: input.amount,
      swapMode: input.swapMode,
      slippageBps: input.slippageBps,
      ownerPubkey,
    })
    const base64Tx = built.unsignedTransactions[0]
    if (!base64Tx) {
      throw new Error('Byreal returned no unsigned transaction to sign.')
    }
    const settled = await deps.owsClient.signAndBroadcastSolanaTx({
      wallet: walletName,
      base64Tx,
      skipBroadcast: deps.simulateSettlement,
    })

    const settledAt = nowIso(deps)
    const executed: ActionRequestRecord = {
      ...policyChecked,
      updatedAt: settledAt,
      status: 'executed',
      errorCode: undefined,
      errorMessage: undefined,
      resultRef: settled.signature,
      value: {
        assetSymbol: input.inputAssetSymbol,
        amount: input.amount,
        chainId,
        valueUsd: built.quote.inAmountUsd?.replace(/^\$/, ''),
      },
      runtimeRefs: {
        ...policyChecked.runtimeRefs,
        intentIds: policyChecked.runtimeRefs?.intentIds ?? [],
        broadcastRefs: settled.signature ? [settled.signature] : [],
      },
      executionPlan: {
        ...policyChecked.executionPlan,
        connectorKind: 'direct',
        executionMode: 'ows',
        settlementAsset: input.inputAssetSymbol,
        quoteRef: built.quote.orderId,
      },
      requestContext: {
        ...policyChecked.requestContext,
        intakeStage: 'executed',
        settlementBackend: 'ows',
        settlementVia: 'byreal',
        settlementRouter: built.quote.routerType,
        settlementSignature: settled.signature,
        settlementSimulated: !!deps.simulateSettlement,
        expectedOutAmount: built.quote.uiOutAmount,
        expectedOutAmountUsd: built.quote.outAmountUsd,
        priceImpactPct: built.quote.priceImpactPct,
        outputAssetSymbol: input.outputAssetSymbol,
        poolAddresses: built.quote.poolAddresses,
      },
    }
    await deps.actionRequests.put(executed)
    const updatedAgent = applyAgentStatus(agent, 'executed', settledAt)
    await deps.agentRegistry.put(updatedAgent)
    return { kind: 'executed', agent: updatedAgent, actionRequest: executed }
  } catch (error) {
    const failedAt = nowIso(deps)
    const message =
      error instanceof Error ? error.message : 'Byreal/OWS swap settlement failed after approval.'
    const failed: ActionRequestRecord = {
      ...policyChecked,
      updatedAt: failedAt,
      status: 'failed',
      errorCode: 'byreal.settlement_failed',
      errorMessage: message,
    }
    await deps.actionRequests.put(failed)
    const updatedAgent = applyAgentStatus(agent, 'failed', failedAt)
    await deps.agentRegistry.put(updatedAgent)
    return { kind: 'execution_failed', agent: updatedAgent, actionRequest: failed, error: message }
  }
}
