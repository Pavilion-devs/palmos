import type {
  KernelTurnResult,
  RunRegistry,
  RunState,
  SessionKernel,
} from '../../runtime/index.js'
import {
  evaluateTransferRequest,
  type AgentTransferRecipientRule,
  type TransferDecision,
} from '../policies/compileAgentPolicy.js'
import type { ActionRequestRecord, ActionRequestRegistry, ActionRequestSource } from '../store/ActionRequestRegistry.js'
import type { AgentRecord, AgentRegistry } from '../store/AgentRegistry.js'
import type { OwsClient } from '../integrations/ows/client.js'
import { readSolanaRpcUrlFromEnv } from '../integrations/pusd/constants.js'
import {
  resolveSplAssetSettlement,
  tokenAmountToBaseUnits,
} from '../integrations/pusd/splAssets.js'

export type RequestAssetTransferInput = {
  agentId: string
  destinationAddress: string
  chainId: string
  assetSymbol: string
  amount: string
  counterpartyId?: string
  note?: string
  source?: ActionRequestSource
  eligibleAgentStatuses?: AgentRecord['status'][]
}

export type RequestAssetTransferDependencies = {
  kernel: SessionKernel
  agentRegistry: AgentRegistry
  actionRequests: ActionRequestRegistry
  runRegistry?: Pick<RunRegistry, 'get'>
  // When present, approved native-SOL transfers for OWS-backed agents are
  // settled for real on-chain through this client (instead of the deterministic
  // runtime broadcast). Cluster follows PUSD_SOLANA_NETWORK — works on mainnet.
  owsClient?: OwsClient
  now?: () => string
  createId?: (prefix: string) => string
}

// Parse a decimal SOL amount string into integer lamports without floating-
// point drift (e.g. "0.1" -> 100000000, "1" -> 1000000000).
function solAmountToLamports(amount: string): number {
  const [whole, fraction = ''] = amount.trim().split('.')
  const fractionPadded = (fraction + '000000000').slice(0, 9)
  return Number(whole || '0') * 1_000_000_000 + Number(fractionPadded || '0')
}

// Layer real OWS Solana settlement on top of the runtime-finalized transfer
// record. Native SOL and known SPL stablecoins (USDC/PUSD) settle for real on
// the configured cluster; everything else (unknown assets, non-OWS agents,
// non-executed outcomes) passes through unchanged on the deterministic path. A
// failed broadcast flips the record to `failed` so we never report a fake
// success.
async function settleAssetTransferViaOws(input: {
  deps: RequestAssetTransferDependencies
  agent: AgentRecord
  record: ActionRequestRecord
  decision: 'approved' | 'rejected' | string
}): Promise<ActionRequestRecord> {
  const { deps, agent, record } = input
  // After approval the runtime advances a native transfer to
  // `waiting_for_execution` (it defers the actual broadcast). That is exactly
  // where we step in as the real execution backend — so settle on either the
  // ready-to-execute or already-executed runtime outcome.
  const runtimeKind = mapActionRequestKindFromStatus(record.status)
  if (
    input.decision !== 'approved' ||
    !deps.owsClient ||
    agent.walletBackend !== 'ows' ||
    (runtimeKind !== 'executed' && runtimeKind !== 'waiting_for_execution') ||
    record.target.kind !== 'address'
  ) {
    return record
  }

  const owsClient = deps.owsClient
  const assetSymbol = record.value?.assetSymbol
  const amount = record.value?.amount
  const destination = record.target.address
  if (!assetSymbol || !amount || !destination) {
    return record
  }

  const walletName = agent.owsWalletName ?? agent.owsWalletId ?? agent.agentId
  const rpcUrl = readSolanaRpcUrlFromEnv()

  // Resolve the on-chain settlement for this asset. Native SOL and known SPL
  // stablecoins settle for real; anything else leaves the record unchanged so
  // it stays on the deterministic path (never a faked success).
  let broadcast: (() => Promise<string | undefined>) | undefined
  let settlementAsset = assetSymbol
  if (assetSymbol === 'SOL') {
    broadcast = async () =>
      (
        await owsClient.paySolanaTransfer({
          wallet: walletName,
          destination,
          lamports: solAmountToLamports(amount),
          rpcUrl,
        })
      ).signature
  } else {
    const splAsset = resolveSplAssetSettlement(assetSymbol)
    if (splAsset) {
      settlementAsset = splAsset.symbol
      broadcast = async () =>
        (
          await owsClient.paySplTransfer({
            wallet: walletName,
            destination,
            amount: tokenAmountToBaseUnits(amount, splAsset.decimals),
            mint: splAsset.mint,
            decimals: splAsset.decimals,
            tokenProgramId: splAsset.tokenProgramId,
            rpcUrl,
          })
        ).signature
    }
  }

  if (!broadcast) {
    return record
  }

  try {
    const signature = await broadcast()
    if (!signature) {
      throw new Error('OWS settlement returned no signature.')
    }
    return {
      ...record,
      status: 'executed',
      errorCode: undefined,
      errorMessage: undefined,
      resultRef: signature,
      runtimeRefs: {
        ...record.runtimeRefs,
        intentIds: record.runtimeRefs?.intentIds ?? [],
        broadcastRefs: [signature],
      },
      requestContext: {
        ...record.requestContext,
        settlementBackend: 'ows',
        settlementAsset,
        settlementSignature: signature,
        settlementRpcUrl: rpcUrl,
      },
    }
  } catch (error) {
    return {
      ...record,
      status: 'failed',
      errorCode: 'ows.settlement_failed',
      errorMessage:
        error instanceof Error
          ? error.message
          : 'OWS Solana settlement failed after approval.',
    }
  }
}

export type RequestAssetTransferResult =
  | {
      kind: 'blocked'
      agent: AgentRecord
      actionRequest: ActionRequestRecord
      reason: string
    }
  | {
      kind: 'approval_pending'
      agent: AgentRecord
      actionRequest: ActionRequestRecord
      turnOutput: string[]
    }
  | {
      kind: 'waiting_for_execution'
      agent: AgentRecord
      actionRequest: ActionRequestRecord
      turnOutput: string[]
    }
  | {
      kind: 'executed'
      agent: AgentRecord
      actionRequest: ActionRequestRecord
      turnOutput: string[]
    }
  | {
      kind: 'execution_failed'
      agent: AgentRecord
      actionRequest: ActionRequestRecord
      turnOutput: string[]
      error: string
    }

export type ResolvePendingAssetTransferApprovalInput = {
  actionRequestId: string
  decision: 'approved' | 'rejected' | 'expired' | 'invalidated'
  approverActorId: string
  approverRole: string
  comment?: string
  decidedAt?: string
}

export type ReconcileNativeActionRequestsResult = {
  checked: number
  updated: number
  unchanged: number
  skipped: number
  results: Array<{
    actionRequestId: string
    previousStatus: ActionRequestRecord['status']
    nextStatus?: ActionRequestRecord['status']
    outcome: 'updated' | 'unchanged' | 'skipped'
    reason:
      | 'runtime_resumed'
      | 'runtime_synced'
      | 'still_waiting'
      | 'terminal_status'
      | 'missing_runtime_refs'
      | 'missing_run'
      | 'missing_agent'
      | 'status_conflict'
    runId?: string
    runStatus?: RunState['status']
    mode?: 'resume_signal' | 'status_registry' | 'status_query'
  }>
}

export class AssetTransferApprovalConflictError extends Error {
  readonly code = 'approval_conflict'
  readonly currentStatus?: ActionRequestRecord['status']

  constructor(
    actionRequestId: string,
    currentStatus?: ActionRequestRecord['status'],
  ) {
    super(
      `Action request ${actionRequestId} is already being reviewed or is no longer pending approval. Current status: ${currentStatus ?? 'missing'}.`,
    )
    this.name = 'AssetTransferApprovalConflictError'
    this.currentStatus = currentStatus
  }
}

function createActionRequestId(
  deps: Pick<RequestAssetTransferDependencies, 'createId'>,
): string {
  return deps.createId
    ? deps.createId('action_request')
    : `action_request_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function nowIso(
  deps: Pick<RequestAssetTransferDependencies, 'now'>,
): string {
  return deps.now?.() ?? new Date().toISOString()
}

function describeTransferPolicyFailure(input: {
  decision: TransferDecision
  request: RequestAssetTransferInput
}): string | undefined {
  switch (input.decision.reasonCode) {
    case 'policy.transfer_chain_not_allowed':
      return `Chain ${input.request.chainId} is not allowed for this agent transfer policy.`
    case 'policy.transfer_asset_not_allowed':
      return `Asset ${input.request.assetSymbol} is not allowed for this agent transfer policy.`
    case 'policy.transfer_recipient_not_allowed':
      return 'Destination address is not allowlisted for this agent transfer policy.'
    case 'policy.transfer_recipient_chain_mismatch':
      return `Destination address ${input.request.destinationAddress} is not allowlisted on chain ${input.request.chainId}.`
    case 'policy.transfer_amount_exceeds_limit':
      return `Transfer amount ${input.request.amount} ${input.request.assetSymbol} exceeds the effective transfer limit of ${input.decision.effectiveMaxTransferAmount}.`
    case 'policy.agent_restricted':
      return `Agent ${input.request.agentId} is restricted from initiating transfers.`
    case 'policy.invalid_amount':
      return `Transfer amount ${input.request.amount} is invalid for this agent transfer policy.`
    default:
      return undefined
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`
  }

  if (!value || typeof value !== 'object') {
    return JSON.stringify(value)
  }

  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
    .join(',')}}`
}

function sameActionRequestIgnoringUpdatedAt(
  left: ActionRequestRecord,
  right: ActionRequestRecord,
): boolean {
  return (
    stableJson({
      ...left,
      updatedAt: '',
    }) ===
    stableJson({
      ...right,
      updatedAt: '',
    })
  )
}

function buildInitialAssetTransferActionRequest(input: {
  actionRequestId: string
  at: string
  agent: AgentRecord
  request: RequestAssetTransferInput
}): ActionRequestRecord {
  const source = input.request.source ?? 'system'
  return {
    actionRequestId: input.actionRequestId,
    createdAt: input.at,
    updatedAt: input.at,
    agentId: input.agent.agentId,
    organizationId: input.agent.organizationId,
    treasuryId: input.agent.treasuryId,
    walletId: input.agent.walletId,
    source,
    kind: 'asset.transfer',
    status: 'created',
    target: {
      kind: 'address',
      address: input.request.destinationAddress,
      chainId: input.request.chainId,
      counterpartyId: input.request.counterpartyId,
    },
    value: {
      assetSymbol: input.request.assetSymbol,
      amount: input.request.amount,
      chainId: input.request.chainId,
    },
    title: `Transfer ${input.request.amount} ${input.request.assetSymbol}`,
    summary: `Requested transfer of ${input.request.amount} ${input.request.assetSymbol} to ${input.request.destinationAddress}.`,
    requestPayload: {
      destinationAddress: input.request.destinationAddress,
      chainId: input.request.chainId,
      assetSymbol: input.request.assetSymbol,
      amount: input.request.amount,
      counterpartyId: input.request.counterpartyId,
      note: input.request.note,
    },
    requestContext: {
      requestSource: source,
      intakeStage: 'created',
      nativeActionRequest: true,
    },
    policy: {
      approvalRequired: false,
    },
    executionPlan: {
      connectorKind: 'direct',
      settlementAsset: input.request.assetSymbol,
      privacyMode: 'off',
      executionMode: 'connector',
    },
    runtimeRefs: {
      sessionId: input.agent.sessionId,
      intentIds: [],
    },
  }
}

function withPolicySnapshot(input: {
  record: ActionRequestRecord
  at: string
  status: ActionRequestRecord['status']
  transferDecision: TransferDecision
  recipient?: AgentTransferRecipientRule
  errorCode?: string
  errorMessage?: string
}): ActionRequestRecord {
  return {
    ...input.record,
    updatedAt: input.at,
    status: input.status,
    target:
      input.record.target.kind === 'address'
        ? {
            ...input.record.target,
            counterpartyId:
              input.record.target.counterpartyId ??
              input.recipient?.counterpartyId,
          }
        : input.record.target,
    policy: {
      approvalRequired: input.transferDecision.requiresApproval,
      approvalReason: input.transferDecision.requiresApproval
        ? input.transferDecision.reasonCode
        : undefined,
      limitsApplied: {
        nativeActionRequest: true,
        effectiveMaxTransferAmount:
          input.transferDecision.effectiveMaxTransferAmount,
        transferDecisionStatus: input.transferDecision.status,
        reasonCode: input.transferDecision.reasonCode,
        counterpartyId: input.recipient?.counterpartyId,
      },
    },
    requestContext: {
      ...input.record.requestContext,
      intakeStage: input.status,
      counterpartyId: input.recipient?.counterpartyId,
    },
    errorCode: input.errorCode,
    errorMessage: input.errorMessage,
  }
}

function mapRunToActionRequestStatus(
  run: RunState | undefined,
): ActionRequestRecord['status'] {
  if (!run) {
    return 'failed'
  }

  switch (run.status) {
    case 'waiting_for_approval':
      return 'approval_pending'
    case 'waiting_for_signature':
    case 'waiting_for_confirmation':
      return 'waiting_for_execution'
    case 'completed':
      return 'executed'
    case 'failed':
    case 'halted':
      return 'failed'
    case 'active':
    case 'waiting_for_input':
    default:
      return run.currentPhase === 'completed'
        ? 'executed'
        : run.currentPhase === 'failed'
          ? 'failed'
          : 'executing'
  }
}

function mapActionRequestKindFromStatus(
  status: ActionRequestRecord['status'],
): RequestAssetTransferResult['kind'] {
  switch (status) {
    case 'approval_pending':
      return 'approval_pending'
    case 'waiting_for_execution':
    case 'executing':
      return 'waiting_for_execution'
    case 'executed':
      return 'executed'
    case 'blocked':
      return 'blocked'
    case 'failed':
    default:
      return 'execution_failed'
  }
}

function updateAgentStatusFromTransfer(input: {
  agent: AgentRecord
  status: ActionRequestRecord['status']
  at: string
  errorCode?: string
}): AgentRecord {
  if (
    input.status === 'blocked' &&
    input.errorCode !== 'policy.agent_restricted'
  ) {
    return {
      ...input.agent,
      updatedAt: input.at,
      lastCheckInAt: input.at,
    }
  }

  return {
    ...input.agent,
    status:
      input.status === 'approval_pending'
        ? 'approval_pending'
        : input.status === 'blocked'
          ? 'restricted'
          : input.status === 'failed'
            ? 'restricted'
            : 'ready',
    updatedAt: input.at,
    lastCheckInAt: input.at,
  }
}

function buildRuntimeBackedActionRequest(input: {
  record: ActionRequestRecord
  at: string
  turn: KernelTurnResult
  status?: ActionRequestRecord['status']
  errorCode?: string
  errorMessage?: string
}): ActionRequestRecord {
  const status = input.status ?? mapRunToActionRequestStatus(input.turn.run)
  return {
    ...input.record,
    updatedAt: input.at,
    status,
    runtimeRefs: {
      sessionId: input.turn.session.sessionId,
      runId: input.turn.run?.runId,
      intentIds: input.turn.run?.intentRef?.intentId
        ? [input.turn.run.intentRef.intentId]
        : input.record.runtimeRefs?.intentIds ?? [],
      broadcastRefs: input.turn.run?.broadcastRefs,
      simulationRefs: input.turn.run?.simulationRefs,
    },
    resultRef:
      input.turn.run?.reportRef ??
      input.turn.run?.broadcastRefs.at(-1) ??
      input.record.resultRef,
    requestContext: {
      ...input.record.requestContext,
      runtimeStatus: input.turn.run?.status,
      runtimePhase: input.turn.run?.currentPhase,
      approvalStateRef: input.turn.run?.approvalStateRef,
    },
    errorCode: input.errorCode,
    errorMessage: input.errorMessage,
  }
}

async function loadRuntimeRunState(input: {
  deps: Pick<RequestAssetTransferDependencies, 'kernel'>
  sessionId?: string
  runId?: string
}): Promise<RunState | undefined> {
  if (!input.sessionId || !input.runId) {
    return undefined
  }

  const turn = await input.deps.kernel.handleInput({
    sessionId: input.sessionId,
    source: 'system',
    kind: 'status_query',
    runId: input.runId,
  })
  return turn.run
}

function isActionRequestTerminal(
  status: ActionRequestRecord['status'],
): boolean {
  return (
    status === 'blocked' ||
    status === 'executed' ||
    status === 'failed' ||
    status === 'cancelled' ||
    status === 'expired'
  )
}

function shouldResumeActionRequest(
  record: ActionRequestRecord,
): boolean {
  return (
    record.status === 'waiting_for_execution' ||
    record.status === 'executing'
  )
}

async function loadActionRequestRuntimeState(input: {
  deps: RequestAssetTransferDependencies
  actionRequest: ActionRequestRecord
}): Promise<{
  run: RunState | undefined
  turnOutput: string[]
  mode: 'resume_signal' | 'status_registry' | 'status_query'
}> {
  const sessionId = input.actionRequest.runtimeRefs?.sessionId
  const runId = input.actionRequest.runtimeRefs?.runId
  if (!sessionId || !runId) {
    return {
      run: undefined,
      turnOutput: [],
      mode: 'status_query',
    }
  }

  if (shouldResumeActionRequest(input.actionRequest)) {
    const turn = await input.deps.kernel.handleInput({
      sessionId,
      source: 'system',
      kind: 'resume_signal',
      runId,
    })
    return {
      run: turn.run,
      turnOutput: turn.output,
      mode: 'resume_signal',
    }
  }

  if (input.deps.runRegistry) {
    return {
      run: await input.deps.runRegistry.get(runId),
      turnOutput: [`Run ${runId} loaded from registry.`],
      mode: 'status_registry',
    }
  }

  const turn = await input.deps.kernel.handleInput({
    sessionId,
    source: 'system',
    kind: 'status_query',
    runId,
  })
  return {
    run: turn.run,
    turnOutput: turn.output,
    mode: 'status_query',
  }
}

function buildMissingRunActionRequest(input: {
  record: ActionRequestRecord
  at: string
  runId: string
}): ActionRequestRecord {
  return {
    ...input.record,
    updatedAt: input.at,
    status: 'failed',
    requestContext: {
      ...input.record.requestContext,
      runtimeStatus: 'missing',
      runtimePhase: 'missing',
    },
    errorCode: 'runtime.run_missing',
    errorMessage: `Runtime run ${input.runId} is no longer available for this action request.`,
  }
}

async function updateAgentIfTransferLifecycleChanged(input: {
  deps: Pick<RequestAssetTransferDependencies, 'agentRegistry'>
  agent: AgentRecord
  actionRequest: ActionRequestRecord
  dryRun?: boolean
}): Promise<AgentRecord> {
  const desired = updateAgentStatusFromTransfer({
    agent: input.agent,
    status: input.actionRequest.status,
    at: input.actionRequest.updatedAt,
    errorCode: input.actionRequest.errorCode,
  })

  if (desired.status === input.agent.status) {
    return input.agent
  }

  if (!input.dryRun) {
    await input.deps.agentRegistry.put(desired)
  }

  return desired
}

export async function reconcileNativeActionRequests(
  deps: RequestAssetTransferDependencies,
  input: {
    dryRun?: boolean
    limitPerStatus?: number
  } = {},
): Promise<ReconcileNativeActionRequestsResult> {
  const statuses: Array<ActionRequestRecord['status']> = [
    'approval_pending',
    'waiting_for_execution',
    'executing',
  ]
  const limitPerStatus = input.limitPerStatus
  const records = new Map<string, ActionRequestRecord>()

  for (const status of statuses) {
    const result = await deps.actionRequests.query({
      kind: 'asset.transfer',
      status,
      limit: limitPerStatus,
    })
    for (const record of result.records) {
      records.set(record.actionRequestId, record)
    }
  }

  const results: ReconcileNativeActionRequestsResult['results'] = []
  let updated = 0
  let unchanged = 0
  let skipped = 0

  for (const actionRequest of records.values()) {
    const previousStatus = actionRequest.status
    const runId = actionRequest.runtimeRefs?.runId

    if (isActionRequestTerminal(actionRequest.status)) {
      skipped += 1
      results.push({
        actionRequestId: actionRequest.actionRequestId,
        previousStatus,
        nextStatus: actionRequest.status,
        outcome: 'skipped',
        reason: 'terminal_status',
        runId,
      })
      continue
    }

    if (!actionRequest.runtimeRefs?.sessionId || !runId) {
      skipped += 1
      results.push({
        actionRequestId: actionRequest.actionRequestId,
        previousStatus,
        nextStatus: actionRequest.status,
        outcome: 'skipped',
        reason: 'missing_runtime_refs',
        runId,
      })
      continue
    }

    const agent = await deps.agentRegistry.get(actionRequest.agentId)
    if (!agent) {
      skipped += 1
      results.push({
        actionRequestId: actionRequest.actionRequestId,
        previousStatus,
        nextStatus: actionRequest.status,
        outcome: 'skipped',
        reason: 'missing_agent',
        runId,
      })
      continue
    }

    const runtime = await loadActionRequestRuntimeState({
      deps,
      actionRequest,
    })

    const nextRecord = runtime.run
      ? buildRuntimeBackedActionRequest({
          record: actionRequest,
          at: nowIso(deps),
          turn: {
            kind: runtime.mode === 'resume_signal' ? 'resume_signal' : 'status_query',
            createdRun: false,
            session: {
              sessionId: actionRequest.runtimeRefs.sessionId,
              createdAt: actionRequest.createdAt,
              updatedAt: nowIso(deps),
              mode: 'api',
              environment: agent.environment,
              orgContext: {
                organizationId: agent.organizationId,
                treasuryIds: agent.treasuryId ? [agent.treasuryId] : undefined,
                walletIds: agent.walletId ? [agent.walletId] : undefined,
              },
              actorContext: {
                actorId: agent.actorId,
                roleIds: ['agent'],
              },
              runIds: runId ? [runId] : [],
              pendingApprovalRunIds:
                runtime.run.status === 'waiting_for_approval' ? [runId] : [],
              pendingSignatureRunIds:
                runtime.run.status === 'waiting_for_signature' ? [runId] : [],
              pendingConfirmationRunIds:
                runtime.run.status === 'waiting_for_confirmation' ? [runId] : [],
              halted: false,
              transcriptRef: `session:${actionRequest.runtimeRefs.sessionId}:transcript`,
            },
            run: runtime.run,
            output: runtime.turnOutput,
          },
          status: mapRunToActionRequestStatus(runtime.run),
          errorCode:
            runtime.run.status === 'failed' || runtime.run.status === 'halted'
              ? actionRequest.errorCode ?? 'runtime.execution_failed'
              : undefined,
          errorMessage:
            runtime.run.status === 'failed' || runtime.run.status === 'halted'
              ? actionRequest.errorMessage ??
                runtime.turnOutput.at(-1) ??
                `Runtime transfer run ${runId} is ${runtime.run.status}.`
              : undefined,
        })
      : buildMissingRunActionRequest({
          record: actionRequest,
          at: nowIso(deps),
          runId,
        })

    if (sameActionRequestIgnoringUpdatedAt(actionRequest, nextRecord)) {
      unchanged += 1
      results.push({
        actionRequestId: actionRequest.actionRequestId,
        previousStatus,
        nextStatus: actionRequest.status,
        outcome: 'unchanged',
        reason: 'still_waiting',
        runId,
        runStatus: runtime.run?.status,
        mode: runtime.mode,
      })
      continue
    }

    if (!input.dryRun) {
      const claimed = await deps.actionRequests.putIfStatus(
        nextRecord,
        actionRequest.status,
      )
      if (!claimed) {
        skipped += 1
        results.push({
          actionRequestId: actionRequest.actionRequestId,
          previousStatus,
          nextStatus: nextRecord.status,
          outcome: 'skipped',
          reason: 'status_conflict',
          runId,
          runStatus: runtime.run?.status,
          mode: runtime.mode,
        })
        continue
      }
    }

    await updateAgentIfTransferLifecycleChanged({
      deps,
      agent,
      actionRequest: nextRecord,
      dryRun: input.dryRun,
    })

    updated += 1
    results.push({
      actionRequestId: actionRequest.actionRequestId,
      previousStatus,
      nextStatus: nextRecord.status,
      outcome: 'updated',
      reason: runtime.run
        ? runtime.mode === 'resume_signal'
          ? 'runtime_resumed'
          : 'runtime_synced'
        : 'missing_run',
      runId,
      runStatus: runtime.run?.status,
      mode: runtime.mode,
    })
  }

  return {
    checked: records.size,
    updated,
    unchanged,
    skipped,
    results,
  }
}

export async function requestAssetTransfer(
  deps: RequestAssetTransferDependencies,
  input: RequestAssetTransferInput,
): Promise<RequestAssetTransferResult> {
  const agent = await deps.agentRegistry.get(input.agentId)
  if (!agent) {
    throw new Error(`Unknown agent: ${input.agentId}`)
  }

  const at = nowIso(deps)
  const actionRequest = buildInitialAssetTransferActionRequest({
    actionRequestId: createActionRequestId(deps),
    at,
    agent,
    request: input,
  })
  await deps.actionRequests.put(actionRequest)

  const eligibleAgentStatuses = input.eligibleAgentStatuses ?? ['ready']
  if (!eligibleAgentStatuses.includes(agent.status)) {
    const blocked = {
      ...actionRequest,
      updatedAt: at,
      status: 'blocked' as const,
      errorCode: 'policy.agent_not_ready',
      errorMessage: `Agent ${input.agentId} is not transfer-ready. Current status: ${agent.status}.`,
    }
    await deps.actionRequests.put(blocked)
    const updatedAgent = updateAgentStatusFromTransfer({
      agent,
      status: blocked.status,
      at,
      errorCode: blocked.errorCode,
    })
    await deps.agentRegistry.put(updatedAgent)
    return {
      kind: 'blocked',
      agent: updatedAgent,
      actionRequest: blocked,
      reason: blocked.errorMessage ?? 'Agent is not transfer-ready.',
    }
  }

  if (!agent.walletId) {
    const blocked = {
      ...actionRequest,
      updatedAt: at,
      status: 'blocked' as const,
      errorCode: 'policy.wallet_missing',
      errorMessage: `Agent ${input.agentId} does not have a wallet yet.`,
    }
    await deps.actionRequests.put(blocked)
    const updatedAgent = updateAgentStatusFromTransfer({
      agent,
      status: blocked.status,
      at,
      errorCode: blocked.errorCode,
    })
    await deps.agentRegistry.put(updatedAgent)
    return {
      kind: 'blocked',
      agent: updatedAgent,
      actionRequest: blocked,
      reason: blocked.errorMessage ?? 'Agent wallet is missing.',
    }
  }

  const policyDecision = evaluateTransferRequest({
    policy: agent.policyConfig,
    amount: input.amount,
    destinationAddress: input.destinationAddress,
    chainId: input.chainId,
    assetSymbol: input.assetSymbol,
    counterpartyId: input.counterpartyId,
    trustTier: agent.trustTier,
  })

  if (policyDecision.status === 'denied') {
    const blockedReason =
      describeTransferPolicyFailure({
        decision: policyDecision,
        request: input,
      }) ?? policyDecision.reasonCode
    const blocked = withPolicySnapshot({
      record: actionRequest,
      at,
      status: 'blocked',
      transferDecision: policyDecision,
      recipient: policyDecision.recipient,
      errorCode: policyDecision.reasonCode,
      errorMessage: blockedReason,
    })
    await deps.actionRequests.put(blocked)
    const updatedAgent = updateAgentStatusFromTransfer({
      agent,
      status: blocked.status,
      at,
      errorCode: blocked.errorCode,
    })
    await deps.agentRegistry.put(updatedAgent)
    return {
      kind: 'blocked',
      agent: updatedAgent,
      actionRequest: blocked,
      reason: blockedReason,
    }
  }

  const policyChecked = withPolicySnapshot({
    record: actionRequest,
    at,
    status: 'policy_checked',
    transferDecision: policyDecision,
    recipient: policyDecision.recipient,
  })
  await deps.actionRequests.put(policyChecked)

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
      destinationAddress: input.destinationAddress,
      chainId: input.chainId,
      assetSymbol: input.assetSymbol,
      amount: input.amount,
      counterpartyId: policyDecision.recipient?.counterpartyId,
      note: input.note,
    },
  })

  const finalStatus = mapRunToActionRequestStatus(turn.run)
  const finalRecord = buildRuntimeBackedActionRequest({
    record: policyChecked,
    at: nowIso(deps),
    turn,
    status: finalStatus,
    errorCode: finalStatus === 'failed' ? 'runtime.execution_failed' : undefined,
    errorMessage:
      finalStatus === 'failed'
        ? turn.output.at(-1) ?? 'Runtime transfer execution failed.'
        : undefined,
  })
  await deps.actionRequests.put(finalRecord)
  const updatedAgent = updateAgentStatusFromTransfer({
    agent,
    status: finalRecord.status,
    at: finalRecord.updatedAt,
    errorCode: finalRecord.errorCode,
  })
  await deps.agentRegistry.put(updatedAgent)

  const kind = mapActionRequestKindFromStatus(finalRecord.status)
  if (kind === 'approval_pending') {
    return {
      kind,
      agent: updatedAgent,
      actionRequest: finalRecord,
      turnOutput: turn.output,
    }
  }
  if (kind === 'waiting_for_execution') {
    return {
      kind,
      agent: updatedAgent,
      actionRequest: finalRecord,
      turnOutput: turn.output,
    }
  }
  if (kind === 'executed') {
    return {
      kind,
      agent: updatedAgent,
      actionRequest: finalRecord,
      turnOutput: turn.output,
    }
  }

  return {
    kind: 'execution_failed',
    agent: updatedAgent,
    actionRequest: finalRecord,
    turnOutput: turn.output,
    error: finalRecord.errorMessage ?? 'Runtime transfer execution failed.',
  }
}

export async function resolvePendingAssetTransferApproval(
  deps: RequestAssetTransferDependencies,
  input: ResolvePendingAssetTransferApprovalInput,
): Promise<RequestAssetTransferResult> {
  const actionRequest = await deps.actionRequests.get(input.actionRequestId)
  if (!actionRequest) {
    throw new Error(`Unknown action request: ${input.actionRequestId}`)
  }

  if (
    actionRequest.kind !== 'asset.transfer' ||
    actionRequest.status !== 'approval_pending'
  ) {
    throw new AssetTransferApprovalConflictError(
      input.actionRequestId,
      actionRequest.status,
    )
  }

  const agent = await deps.agentRegistry.get(actionRequest.agentId)
  if (!agent) {
    throw new Error(`Unknown agent for action request ${input.actionRequestId}.`)
  }

  const runId = actionRequest.runtimeRefs?.runId
  if (!runId) {
    throw new Error(`Action request ${input.actionRequestId} has no runtime runId.`)
  }

  const claimedRecord: ActionRequestRecord = {
    ...actionRequest,
    status: 'waiting_for_execution',
    updatedAt: nowIso(deps),
    requestContext: {
      ...actionRequest.requestContext,
      runtimeStatus: 'approval_decision_processing',
    },
  }
  const claimed = await deps.actionRequests.putIfStatus(
    claimedRecord,
    'approval_pending',
  )
  if (!claimed) {
    const current = await deps.actionRequests.get(input.actionRequestId)
    throw new AssetTransferApprovalConflictError(
      input.actionRequestId,
      current?.status,
    )
  }

  await deps.kernel.ingestCallback({
    type: 'approval_decision',
    runId,
    status: input.decision,
    approvalStateRef:
      typeof claimedRecord.requestContext?.approvalStateRef === 'string'
        ? claimedRecord.requestContext.approvalStateRef
        : undefined,
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
        ? 'Manager approved the pending asset transfer request.'
        : `Manager marked the pending asset transfer request as ${input.decision}.`,
  })

  const refreshedRun = await loadRuntimeRunState({
    deps,
    sessionId: claimedRecord.runtimeRefs?.sessionId,
    runId,
  })
  const syntheticTurn: KernelTurnResult = {
    kind: 'status_query',
    createdRun: false,
    session: {
      sessionId: claimedRecord.runtimeRefs?.sessionId ?? agent.sessionId,
      createdAt: claimedRecord.createdAt,
      updatedAt: nowIso(deps),
      mode: 'api',
      environment: agent.environment,
      orgContext: {
        organizationId: agent.organizationId,
        treasuryIds: agent.treasuryId ? [agent.treasuryId] : undefined,
        walletIds: agent.walletId ? [agent.walletId] : undefined,
      },
      actorContext: {
        actorId: agent.actorId,
        roleIds: ['agent'],
      },
      runIds: runId ? [runId] : [],
      pendingApprovalRunIds:
        refreshedRun?.status === 'waiting_for_approval' ? [runId] : [],
      pendingSignatureRunIds:
        refreshedRun?.status === 'waiting_for_signature' ? [runId] : [],
      pendingConfirmationRunIds:
        refreshedRun?.status === 'waiting_for_confirmation' ? [runId] : [],
      halted: false,
      transcriptRef: `session:${claimedRecord.runtimeRefs?.sessionId ?? agent.sessionId}:transcript`,
    },
    run: refreshedRun,
    output: [`Run ${runId} is ${refreshedRun?.status ?? 'missing'}.`],
  }

  const finalStatus =
    input.decision === 'approved'
      ? mapRunToActionRequestStatus(refreshedRun)
      : 'failed'
  const runtimeFinalRecord = buildRuntimeBackedActionRequest({
    record: claimedRecord,
    at: nowIso(deps),
    turn: syntheticTurn,
    status: finalStatus,
    errorCode:
      input.decision === 'approved' && finalStatus !== 'failed'
        ? undefined
        : `approval.${input.decision}`,
    errorMessage:
      input.decision === 'approved' && finalStatus !== 'failed'
        ? undefined
        : `Asset transfer action request ${input.actionRequestId} was ${input.decision}.`,
  })
  // Replace the deterministic runtime broadcast with a real OWS on-chain
  // settlement for eligible (OWS-backed native-SOL) transfers.
  const finalRecord = await settleAssetTransferViaOws({
    deps,
    agent,
    record: runtimeFinalRecord,
    decision: input.decision,
  })
  await deps.actionRequests.put(finalRecord)

  const updatedAgent = updateAgentStatusFromTransfer({
    agent,
    status: finalRecord.status,
    at: finalRecord.updatedAt,
    errorCode: finalRecord.errorCode,
  })
  await deps.agentRegistry.put(updatedAgent)

  const kind = mapActionRequestKindFromStatus(finalRecord.status)
  if (kind === 'approval_pending') {
    return {
      kind,
      agent: updatedAgent,
      actionRequest: finalRecord,
      turnOutput: syntheticTurn.output,
    }
  }
  if (kind === 'waiting_for_execution') {
    return {
      kind,
      agent: updatedAgent,
      actionRequest: finalRecord,
      turnOutput: syntheticTurn.output,
    }
  }
  if (kind === 'executed') {
    return {
      kind,
      agent: updatedAgent,
      actionRequest: finalRecord,
      turnOutput: syntheticTurn.output,
    }
  }

  return {
    kind: 'execution_failed',
    agent: updatedAgent,
    actionRequest: finalRecord,
    turnOutput: syntheticTurn.output,
    error: finalRecord.errorMessage ?? 'Asset transfer approval review failed.',
  }
}
