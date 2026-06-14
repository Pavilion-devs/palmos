/**
 * requestLiquidityAction — governed Byreal CLMM liquidity op as a PalmOS `asset.liquidity` action.
 *
 * This is C4 of the Byreal integration (see byrealintegration.md, Appendix A). It is the LP analog
 * of requestAssetSwap (C3): create `asset.liquidity` request → evaluateLiquidityRequest (policy
 * gate) → blocked | approval_pending | auto-approved → C1 buildPositionUnsigned → C2
 * signAndBroadcastSolanaTx → audit stamp. Deposits (open/increase) are gated like a spend;
 * withdrawals (decrease/close) return the agent's own funds and auto-approve. The `open` tx carries
 * its position-NFT-mint signature pre-applied; C2 only adds the owner signature. On settlement
 * error the record flips to `failed` — never a faked success.
 */
import type {
  ActionRequestRecord,
  ActionRequestSource,
  ActionRequestStatus,
} from '../store/ActionRequestRegistry.js'
import type { AgentRecord } from '../store/AgentRegistry.js'
import { evaluateLiquidityRequest, type LiquidityDecision } from '../policies/compileAgentPolicy.js'
import type { BuildPositionParams, ByrealClient, LiquidityOp } from '../integrations/byreal/client.js'
import type { OwsClient } from '../integrations/ows/client.js'
import type { MantleRecorder } from '../integrations/mantle/client.js'
import { recordGovernedDecisionOnMantle } from './mantleDecisionRecording.js'

export type RequestLiquidityActionInput = {
  agentId: string
  op: LiquidityOp
  // open
  pool?: string
  priceLower?: string
  priceUpper?: string
  // increase / decrease / close
  nftMint?: string
  // deposit (open / increase)
  base?: string
  /** Deposited token symbol, used by the policy gate (open / increase). */
  baseAssetSymbol?: string
  amount?: string
  amountUsd?: string
  // withdraw (decrease / close)
  percentage?: number
  outputMint?: string
  // common
  autoSwap?: boolean
  slippageBps?: number
  chainId?: string
  note?: string
  source?: ActionRequestSource
  eligibleAgentStatuses?: AgentRecord['status'][]
}

export type RequestLiquidityActionDependencies = {
  agentRegistry: {
    get(agentId: string): Promise<AgentRecord | undefined>
    put(agent: AgentRecord): Promise<unknown>
  }
  actionRequests: { put(record: ActionRequestRecord): Promise<unknown> }
  byrealClient?: Pick<ByrealClient, 'buildPositionUnsigned'>
  owsClient?: Pick<OwsClient, 'signAndBroadcastSolanaTx' | 'getSolanaAddress'>
  /**
   * Optional Mantle decision-log recorder. Records the LP decision + outcome (incl. denied/blocked)
   * on Mantle and stamps the tx ref onto the action request. Best-effort; gated by MANTLE_RECORD_LIVE.
   */
  mantleRecorder?: MantleRecorder
  /** Sign but do not broadcast — for dry runs / tests. */
  simulateSettlement?: boolean
  now?: () => string
  createId?: (prefix: string) => string
}

export type RequestLiquidityActionResult =
  | { kind: 'blocked'; agent: AgentRecord; actionRequest: ActionRequestRecord; reason: string }
  | { kind: 'approval_pending'; agent: AgentRecord; actionRequest: ActionRequestRecord }
  | { kind: 'executed'; agent: AgentRecord; actionRequest: ActionRequestRecord }
  | { kind: 'waiting_for_execution'; agent: AgentRecord; actionRequest: ActionRequestRecord }
  | { kind: 'execution_failed'; agent: AgentRecord; actionRequest: ActionRequestRecord; error: string }

function nowIso(deps: Pick<RequestLiquidityActionDependencies, 'now'>): string {
  return deps.now?.() ?? new Date().toISOString()
}

function createActionRequestId(deps: Pick<RequestLiquidityActionDependencies, 'createId'>): string {
  return deps.createId
    ? deps.createId('action_request')
    : `action_request_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function isDepositOp(op: LiquidityOp): boolean {
  return op === 'open' || op === 'increase'
}

function depositAmountFor(input: RequestLiquidityActionInput): string | undefined {
  return isDepositOp(input.op) ? input.amount ?? input.amountUsd : undefined
}

function describeLiquidityPolicyFailure(
  decision: LiquidityDecision,
  input: RequestLiquidityActionInput,
): string {
  switch (decision.reasonCode) {
    case 'policy.liquidity_chain_not_allowed':
      return `Chain ${input.chainId ?? 'solana'} is not allowed for this agent's liquidity policy.`
    case 'policy.liquidity_asset_not_allowed':
      return `Asset ${decision.disallowedAsset ?? ''} is not allowed for this agent's liquidity policy.`
    case 'policy.liquidity_amount_exceeds_limit':
      return `Deposit ${depositAmountFor(input) ?? ''} ${input.baseAssetSymbol ?? ''} exceeds the effective limit of ${decision.effectiveMaxDepositAmount}.`
    case 'policy.agent_restricted':
      return `Agent ${input.agentId} is restricted from liquidity actions.`
    case 'policy.invalid_amount':
      return `Deposit amount is invalid for this agent's liquidity policy.`
    default:
      return decision.reasonCode
  }
}

function applyAgentStatus(agent: AgentRecord, status: ActionRequestStatus, at: string): AgentRecord {
  const nextStatus: AgentRecord['status'] =
    status === 'approval_pending'
      ? 'approval_pending'
      : status === 'blocked' || status === 'failed'
        ? 'restricted'
        : 'ready'
  return { ...agent, status: nextStatus, updatedAt: at, lastCheckInAt: at }
}

function summarizeLiquidity(input: RequestLiquidityActionInput): string {
  switch (input.op) {
    case 'open':
      return `Open Byreal LP position in pool ${input.pool} with ${input.amount ?? input.amountUsd ?? ''} ${input.baseAssetSymbol ?? ''}.`
    case 'increase':
      return `Add ${input.amount ?? input.amountUsd ?? ''} ${input.baseAssetSymbol ?? ''} to Byreal position ${input.nftMint}.`
    case 'decrease':
      return `Remove ${input.percentage != null ? `${input.percentage}%` : (input.amountUsd ?? '')} from Byreal position ${input.nftMint}.`
    case 'close':
      return `Close Byreal position ${input.nftMint}.`
  }
}

function buildInitialLiquidityRecord(input: {
  actionRequestId: string
  at: string
  agent: AgentRecord
  request: RequestLiquidityActionInput
  chainId: string
}): ActionRequestRecord {
  const source = input.request.source ?? 'system'
  const { request } = input
  const deposit = isDepositOp(request.op)
  return {
    actionRequestId: input.actionRequestId,
    createdAt: input.at,
    updatedAt: input.at,
    agentId: input.agent.agentId,
    organizationId: input.agent.organizationId,
    treasuryId: input.agent.treasuryId,
    walletId: input.agent.walletId,
    source,
    kind: 'asset.liquidity',
    status: 'created',
    target: { kind: 'wallet', walletId: input.agent.walletId ?? input.agent.agentId, chainId: input.chainId },
    value:
      deposit && request.baseAssetSymbol
        ? {
            assetSymbol: request.baseAssetSymbol,
            amount: request.amount ?? request.amountUsd ?? '0',
            chainId: input.chainId,
          }
        : undefined,
    title: `Liquidity ${request.op}${deposit && request.baseAssetSymbol ? ` ${request.amount ?? request.amountUsd ?? ''} ${request.baseAssetSymbol}` : ''}`,
    summary: summarizeLiquidity(request),
    requestPayload: {
      op: request.op,
      pool: request.pool,
      priceLower: request.priceLower,
      priceUpper: request.priceUpper,
      nftMint: request.nftMint,
      base: request.base,
      baseAssetSymbol: request.baseAssetSymbol,
      amount: request.amount,
      amountUsd: request.amountUsd,
      percentage: request.percentage,
      outputMint: request.outputMint,
      autoSwap: request.autoSwap,
      slippageBps: request.slippageBps,
      note: request.note,
    },
    requestContext: {
      requestSource: source,
      intakeStage: 'created',
      nativeActionRequest: true,
      settlementVia: 'byreal',
      liquidityOp: request.op,
    },
    policy: { approvalRequired: false },
    executionPlan: {
      connectorKind: 'direct',
      settlementAsset: request.baseAssetSymbol,
      privacyMode: 'off',
      executionMode: 'ows',
    },
    runtimeRefs: { sessionId: input.agent.sessionId, intentIds: [] },
  }
}

function withLiquidityPolicySnapshot(input: {
  record: ActionRequestRecord
  at: string
  status: ActionRequestStatus
  decision: LiquidityDecision
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
        effectiveMaxDepositAmount: input.decision.effectiveMaxDepositAmount,
        liquidityDecisionStatus: input.decision.status,
        reasonCode: input.decision.reasonCode,
      },
    },
    requestContext: { ...input.record.requestContext, intakeStage: input.status },
    errorCode: input.errorCode,
    errorMessage: input.errorMessage,
  }
}

function toBuildPositionParams(
  input: RequestLiquidityActionInput,
  ownerPubkey: string,
): BuildPositionParams {
  const slippageBps = input.slippageBps
  switch (input.op) {
    case 'open':
      return {
        op: 'open',
        pool: input.pool ?? '',
        priceLower: input.priceLower ?? '',
        priceUpper: input.priceUpper ?? '',
        base: input.base,
        amount: input.amount,
        amountUsd: input.amountUsd,
        autoSwap: input.autoSwap,
        slippageBps,
        ownerPubkey,
      }
    case 'increase':
      return {
        op: 'increase',
        nftMint: input.nftMint ?? '',
        base: input.base,
        amount: input.amount,
        amountUsd: input.amountUsd,
        autoSwap: input.autoSwap,
        slippageBps,
        ownerPubkey,
      }
    case 'decrease':
      return {
        op: 'decrease',
        nftMint: input.nftMint ?? '',
        percentage: input.percentage,
        amountUsd: input.amountUsd,
        autoSwap: input.autoSwap,
        outputMint: input.outputMint,
        slippageBps,
        ownerPubkey,
      }
    case 'close':
      return {
        op: 'close',
        nftMint: input.nftMint ?? '',
        autoSwap: input.autoSwap,
        outputMint: input.outputMint,
        slippageBps,
        ownerPubkey,
      }
  }
}

export async function requestLiquidityAction(
  deps: RequestLiquidityActionDependencies,
  input: RequestLiquidityActionInput,
): Promise<RequestLiquidityActionResult> {
  const result = await runRequestLiquidityAction(deps, input)
  // Additive Mantle audit layer — record the governed decision + outcome on-chain (best-effort).
  const actionRequest = await recordGovernedDecisionOnMantle({
    recorder: deps.mantleRecorder,
    actionRequests: deps.actionRequests,
    actionRequest: result.actionRequest,
    kind: 'asset.liquidity',
    resultKind: result.kind,
  })
  return { ...result, actionRequest }
}

async function runRequestLiquidityAction(
  deps: RequestLiquidityActionDependencies,
  input: RequestLiquidityActionInput,
): Promise<RequestLiquidityActionResult> {
  const agent = await deps.agentRegistry.get(input.agentId)
  if (!agent) {
    throw new Error(`Unknown agent: ${input.agentId}`)
  }

  const at = nowIso(deps)
  const chainId = input.chainId ?? 'solana'
  const record = buildInitialLiquidityRecord({
    actionRequestId: createActionRequestId(deps),
    at,
    agent,
    request: input,
    chainId,
  })
  await deps.actionRequests.put(record)

  const eligibleAgentStatuses = input.eligibleAgentStatuses ?? ['ready']
  if (!eligibleAgentStatuses.includes(agent.status)) {
    const blocked: ActionRequestRecord = {
      ...record,
      updatedAt: at,
      status: 'blocked',
      errorCode: 'policy.agent_not_ready',
      errorMessage: `Agent ${input.agentId} is not ready for liquidity actions. Current status: ${agent.status}.`,
    }
    await deps.actionRequests.put(blocked)
    const updatedAgent = applyAgentStatus(agent, 'blocked', at)
    await deps.agentRegistry.put(updatedAgent)
    return { kind: 'blocked', agent: updatedAgent, actionRequest: blocked, reason: blocked.errorMessage! }
  }

  const decision = evaluateLiquidityRequest({
    policy: agent.policyConfig,
    op: input.op,
    depositAssetSymbol: isDepositOp(input.op) ? input.baseAssetSymbol : undefined,
    depositAmount: depositAmountFor(input),
    chainId,
    trustTier: agent.trustTier,
  })

  if (decision.status === 'denied') {
    const reason = describeLiquidityPolicyFailure(decision, input)
    const blocked = withLiquidityPolicySnapshot({
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
    const pending = withLiquidityPolicySnapshot({ record, at, status: 'approval_pending', decision })
    await deps.actionRequests.put(pending)
    const updatedAgent = applyAgentStatus(agent, 'approval_pending', at)
    await deps.agentRegistry.put(updatedAgent)
    return { kind: 'approval_pending', agent: updatedAgent, actionRequest: pending }
  }

  const policyChecked = withLiquidityPolicySnapshot({ record, at, status: 'approved', decision })
  await deps.actionRequests.put(policyChecked)

  if (agent.walletBackend !== 'ows' || !deps.byrealClient || !deps.owsClient) {
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
    const built = await deps.byrealClient.buildPositionUnsigned(toBuildPositionParams(input, ownerPubkey))
    const base64Tx = built.unsignedTransactions[0]
    if (!base64Tx) {
      throw new Error('Byreal returned no unsigned position transaction to sign.')
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
      runtimeRefs: {
        ...policyChecked.runtimeRefs,
        intentIds: policyChecked.runtimeRefs?.intentIds ?? [],
        broadcastRefs: settled.signature ? [settled.signature] : [],
      },
      requestContext: {
        ...policyChecked.requestContext,
        intakeStage: 'executed',
        settlementBackend: 'ows',
        settlementVia: 'byreal',
        liquidityOp: input.op,
        settlementSignature: settled.signature,
        settlementSimulated: !!deps.simulateSettlement,
        positionExtraSigner: built.extraSignerPublicKey,
      },
    }
    await deps.actionRequests.put(executed)
    const updatedAgent = applyAgentStatus(agent, 'executed', settledAt)
    await deps.agentRegistry.put(updatedAgent)
    return { kind: 'executed', agent: updatedAgent, actionRequest: executed }
  } catch (error) {
    const failedAt = nowIso(deps)
    const message =
      error instanceof Error ? error.message : 'Byreal/OWS liquidity settlement failed after approval.'
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
