import type {
  KernelInput,
  PolicyExecutionMode,
  PolicyProfile,
  RuntimeEnvironment,
  SessionState,
  SignerClass,
  TrustTier,
  RunState,
} from '../../runtime/index.js'
import {
  formatPusdBaseUnits,
  parsePusdAmountToBaseUnits,
} from '../integrations/pusd/amount.js'

export type AgentVendorRule = {
  vendorId: string
  label?: string
  destinationAddress: string
  chainId: string
}

export type AgentTransferRecipientRule = {
  counterpartyId: string
  label?: string
  destinationAddress: string
  chainId: string
}

export type AgentTransferPolicy = {
  allowedRecipients?: AgentTransferRecipientRule[]
  allowedAssets?: string[]
  allowedChains?: string[]
  autoApproveUnder?: string
  maxPerTransfer?: string
}

export type AgentPrivacyMode = 'disabled' | 'allowed' | 'required'

export type AgentPolicyTemplateInput = {
  agentId: string
  organizationId: string
  environment: RuntimeEnvironment
  walletType: 'ops' | 'vendor' | 'user' | 'treasury'
  mode?: PolicyExecutionMode
  allowedChains: string[]
  allowedAssets: string[]
  allowedSignerClasses?: SignerClass[]
  allowedVendors: AgentVendorRule[]
  autoApproveUnder: string
  maxPerTransaction: string
  /**
   * Byreal risk controls (C5). `allowedPools` is a CLMM pool allowlist — a liquidity deposit into
   * any pool not on the list is denied (only vetted pools). `maxSlippageBps` caps the slippage a
   * swap/LP route may carry. Both are optional; absent = no restriction.
   */
  allowedPools?: string[]
  maxSlippageBps?: number
  transferPolicy?: AgentTransferPolicy
  sessionBudget?: string
  heartbeatTimeoutSeconds: number
  requireSanctionsScreening?: boolean
  policyProfileId?: string
  approvalExpirySeconds?: number
  minimumWalletTrustTier?: TrustTier
  privacyMode?: AgentPrivacyMode
  umbra?: PolicyProfile['umbra']
}

export type AgentTrustTier = 'new' | 'healthy' | 'trusted' | 'restricted'

export type SpendDecision =
  | {
      status: 'allowed'
      requiresApproval: false
      effectiveMaxPerTransaction: string
      reasonCode: 'policy.auto_approved'
    }
  | {
      status: 'restricted'
      requiresApproval: true
      effectiveMaxPerTransaction: string
      reasonCode: 'policy.approval_required'
    }
  | {
      status: 'denied'
      requiresApproval: false
      effectiveMaxPerTransaction: string
      reasonCode:
        | 'policy.invalid_amount'
        | 'policy.vendor_not_allowed'
        | 'policy.agent_restricted'
        | 'policy.amount_exceeds_limit'
    }

export type TransferDecisionReasonCode =
  | 'policy.invalid_amount'
  | 'policy.agent_restricted'
  | 'policy.transfer_chain_not_allowed'
  | 'policy.transfer_asset_not_allowed'
  | 'policy.transfer_recipient_not_allowed'
  | 'policy.transfer_recipient_chain_mismatch'
  | 'policy.transfer_amount_exceeds_limit'
  | 'policy.transfer_approval_required'
  | 'policy.transfer_auto_approved'

export type TransferDecision = {
  status: 'allowed' | 'restricted' | 'denied'
  requiresApproval: boolean
  effectiveMaxTransferAmount: string
  reasonCode: TransferDecisionReasonCode
  recipient?: AgentTransferRecipientRule
}

export type AgentPolicyLookupRecord = {
  agentId: string
  actorId: string
  organizationId: string
  treasuryId?: string
  environment: RuntimeEnvironment
  walletId?: string
  walletType: AgentPolicyTemplateInput['walletType']
  trustTier: AgentTrustTier
  policyConfig: AgentPolicyTemplateInput
}

export interface AgentPolicyLookup {
  get(agentId: string): Promise<AgentPolicyLookupRecord | undefined>
  getByActorId(actorId: string): Promise<AgentPolicyLookupRecord | undefined>
  getByWalletId(walletId: string): Promise<AgentPolicyLookupRecord | undefined>
}

export type ResolvedAgentTransferPolicy = {
  allowedRecipients: AgentTransferRecipientRule[]
  allowedAssets: string[]
  allowedChains: string[]
  autoApproveUnder: string | undefined
  maxPerTransfer: string | undefined
}

function parsePolicyAmount(amount: string | undefined): bigint | undefined {
  if (amount == null) {
    return undefined
  }

  try {
    return parsePusdAmountToBaseUnits(amount)
  } catch {
    return undefined
  }
}

function formatPolicyAmount(amount: bigint): string {
  const formatted = formatPusdBaseUnits(amount)
  const [whole, fraction] = formatted.split('.')
  if (fraction == null) {
    return `${whole}.00`
  }
  if (fraction.length === 1) {
    return `${whole}.${fraction}0`
  }

  return formatted
}

function applyTrustMultiplier(
  amount: bigint,
  trustTier: AgentTrustTier,
): bigint {
  switch (trustTier) {
    case 'trusted':
      return amount * 2n
    case 'healthy':
      return amount
    case 'new':
      return amount / 4n
    case 'restricted':
      return 0n
    default:
      return amount
  }
}

function mapVendorRulesToTransferRecipients(
  allowedVendors: AgentVendorRule[],
): AgentTransferRecipientRule[] {
  return allowedVendors.map((vendor) => ({
    counterpartyId: vendor.vendorId,
    label: vendor.label,
    destinationAddress: vendor.destinationAddress,
    chainId: vendor.chainId,
  }))
}

export function resolveAgentTransferPolicy(
  policy: AgentPolicyTemplateInput,
): ResolvedAgentTransferPolicy {
  return {
    allowedRecipients:
      policy.transferPolicy?.allowedRecipients ??
      mapVendorRulesToTransferRecipients(policy.allowedVendors),
    allowedAssets: policy.transferPolicy?.allowedAssets ?? policy.allowedAssets,
    allowedChains: policy.transferPolicy?.allowedChains ?? policy.allowedChains,
    autoApproveUnder:
      policy.transferPolicy?.autoApproveUnder ?? policy.autoApproveUnder,
    maxPerTransfer:
      policy.transferPolicy?.maxPerTransfer ?? policy.maxPerTransaction,
  }
}

function resolveTransferRecipient(input: {
  policy: ResolvedAgentTransferPolicy
  counterpartyId?: string
  destinationAddress: string
}): AgentTransferRecipientRule | undefined {
  if (input.counterpartyId) {
    return input.policy.allowedRecipients.find(
      (recipient) =>
        recipient.counterpartyId === input.counterpartyId &&
        recipient.destinationAddress === input.destinationAddress,
    )
  }

  return input.policy.allowedRecipients.find(
    (recipient) => recipient.destinationAddress === input.destinationAddress,
  )
}

export function evaluateSpendRequest(input: {
  policy: AgentPolicyTemplateInput
  amount: string
  vendorId?: string
  trustTier: AgentTrustTier
}): SpendDecision {
  const maxPerTransaction = parsePolicyAmount(input.policy.maxPerTransaction)
  const requestedAmount = parsePolicyAmount(input.amount)
  const autoApproveUnder = parsePolicyAmount(input.policy.autoApproveUnder)
  const effectiveMaxPerTransactionBaseUnits = applyTrustMultiplier(
    maxPerTransaction ?? 0n,
    input.trustTier,
  )
  const effectiveMaxPerTransaction = formatPolicyAmount(
    effectiveMaxPerTransactionBaseUnits,
  )

  if (
    maxPerTransaction == null ||
    requestedAmount == null ||
    autoApproveUnder == null
  ) {
    return {
      status: 'denied',
      requiresApproval: false,
      effectiveMaxPerTransaction,
      reasonCode: 'policy.invalid_amount',
    }
  }

  if (input.trustTier === 'restricted') {
    return {
      status: 'denied',
      requiresApproval: false,
      effectiveMaxPerTransaction,
      reasonCode: 'policy.agent_restricted',
    }
  }

  if (
    input.vendorId &&
    !input.policy.allowedVendors.some((vendor) => vendor.vendorId === input.vendorId)
  ) {
    return {
      status: 'denied',
      requiresApproval: false,
      effectiveMaxPerTransaction,
      reasonCode: 'policy.vendor_not_allowed',
    }
  }

  if (requestedAmount > effectiveMaxPerTransactionBaseUnits) {
    return {
      status: 'denied',
      requiresApproval: false,
      effectiveMaxPerTransaction,
      reasonCode: 'policy.amount_exceeds_limit',
    }
  }

  if (requestedAmount > autoApproveUnder) {
    return {
      status: 'restricted',
      requiresApproval: true,
      effectiveMaxPerTransaction,
      reasonCode: 'policy.approval_required',
    }
  }

  return {
    status: 'allowed',
    requiresApproval: false,
    effectiveMaxPerTransaction,
    reasonCode: 'policy.auto_approved',
  }
}

export function evaluateTransferRequest(input: {
  policy: AgentPolicyTemplateInput
  amount: string
  destinationAddress: string
  chainId: string
  assetSymbol: string
  counterpartyId?: string
  trustTier: AgentTrustTier
}): TransferDecision {
  const transferPolicy = resolveAgentTransferPolicy(input.policy)
  const recipient = resolveTransferRecipient({
    policy: transferPolicy,
    counterpartyId: input.counterpartyId,
    destinationAddress: input.destinationAddress,
  })
  const maxPerTransfer = parsePolicyAmount(transferPolicy.maxPerTransfer)
  const requestedAmount = parsePolicyAmount(input.amount)
  const autoApproveUnder = parsePolicyAmount(transferPolicy.autoApproveUnder)
  const effectiveMaxTransferAmountBaseUnits = applyTrustMultiplier(
    maxPerTransfer ?? 0n,
    input.trustTier,
  )
  const effectiveMaxTransferAmount = formatPolicyAmount(
    effectiveMaxTransferAmountBaseUnits,
  )

  if (!transferPolicy.allowedChains.includes(input.chainId)) {
    return {
      status: 'denied',
      requiresApproval: false,
      effectiveMaxTransferAmount,
      reasonCode: 'policy.transfer_chain_not_allowed',
      recipient,
    }
  }

  if (!transferPolicy.allowedAssets.includes(input.assetSymbol)) {
    return {
      status: 'denied',
      requiresApproval: false,
      effectiveMaxTransferAmount,
      reasonCode: 'policy.transfer_asset_not_allowed',
      recipient,
    }
  }

  if (!recipient) {
    return {
      status: 'denied',
      requiresApproval: false,
      effectiveMaxTransferAmount,
      reasonCode: 'policy.transfer_recipient_not_allowed',
    }
  }

  if (recipient.chainId !== input.chainId) {
    return {
      status: 'denied',
      requiresApproval: false,
      effectiveMaxTransferAmount,
      reasonCode: 'policy.transfer_recipient_chain_mismatch',
      recipient,
    }
  }

  if (
    maxPerTransfer == null ||
    requestedAmount == null ||
    autoApproveUnder == null
  ) {
    return {
      status: 'denied',
      requiresApproval: false,
      effectiveMaxTransferAmount,
      reasonCode: 'policy.invalid_amount',
      recipient,
    }
  }

  if (input.trustTier === 'restricted') {
    return {
      status: 'denied',
      requiresApproval: false,
      effectiveMaxTransferAmount,
      reasonCode: 'policy.agent_restricted',
      recipient,
    }
  }

  if (requestedAmount > effectiveMaxTransferAmountBaseUnits) {
    return {
      status: 'denied',
      requiresApproval: false,
      effectiveMaxTransferAmount,
      reasonCode: 'policy.transfer_amount_exceeds_limit',
      recipient,
    }
  }

  if (requestedAmount > autoApproveUnder) {
    return {
      status: 'restricted',
      requiresApproval: true,
      effectiveMaxTransferAmount,
      reasonCode: 'policy.transfer_approval_required',
      recipient,
    }
  }

  return {
    status: 'allowed',
    requiresApproval: false,
    effectiveMaxTransferAmount,
    reasonCode: 'policy.transfer_auto_approved',
    recipient,
  }
}

export type SwapDecisionReasonCode =
  | 'policy.invalid_amount'
  | 'policy.agent_restricted'
  | 'policy.swap_chain_not_allowed'
  | 'policy.swap_asset_not_allowed'
  | 'policy.swap_slippage_exceeds_cap'
  | 'policy.swap_amount_exceeds_limit'
  | 'policy.swap_approval_required'
  | 'policy.swap_auto_approved'

export type SwapDecision = {
  status: 'allowed' | 'restricted' | 'denied'
  requiresApproval: boolean
  effectiveMaxSwapAmount: string
  reasonCode: SwapDecisionReasonCode
  /** Which asset failed the allowlist (when reasonCode is swap_asset_not_allowed). */
  disallowedAsset?: string
}

/**
 * Governance gate for a Byreal swap. Unlike a transfer, a swap's output returns to the agent's
 * own wallet, so there is no recipient allowlist — instead BOTH legs must be allowed assets. The
 * spend limit / auto-approve threshold are applied to the input amount, mirroring transfer
 * semantics (and the same trust multiplier). Slippage caps, per-pool rules and USD-notional
 * limits are layered on in C5; this is the minimal, faithful gate C3 needs.
 */
export function evaluateSwapRequest(input: {
  policy: AgentPolicyTemplateInput
  inputAssetSymbol: string
  outputAssetSymbol: string
  /** UI amount of the input token being spent (same units the policy max is expressed in). */
  inputAmount: string
  chainId: string
  trustTier: AgentTrustTier
  /** Requested slippage tolerance (bps) — checked against the policy's maxSlippageBps cap. */
  slippageBps?: number
}): SwapDecision {
  const transferPolicy = resolveAgentTransferPolicy(input.policy)
  const maxPerTransfer = parsePolicyAmount(transferPolicy.maxPerTransfer)
  const requestedAmount = parsePolicyAmount(input.inputAmount)
  const autoApproveUnder = parsePolicyAmount(transferPolicy.autoApproveUnder)
  const effectiveMaxBaseUnits = applyTrustMultiplier(maxPerTransfer ?? 0n, input.trustTier)
  const effectiveMaxSwapAmount = formatPolicyAmount(effectiveMaxBaseUnits)

  if (!transferPolicy.allowedChains.includes(input.chainId)) {
    return {
      status: 'denied',
      requiresApproval: false,
      effectiveMaxSwapAmount,
      reasonCode: 'policy.swap_chain_not_allowed',
    }
  }

  for (const asset of [input.inputAssetSymbol, input.outputAssetSymbol]) {
    if (!transferPolicy.allowedAssets.includes(asset)) {
      return {
        status: 'denied',
        requiresApproval: false,
        effectiveMaxSwapAmount,
        reasonCode: 'policy.swap_asset_not_allowed',
        disallowedAsset: asset,
      }
    }
  }

  if (
    input.policy.maxSlippageBps != null &&
    input.slippageBps != null &&
    input.slippageBps > input.policy.maxSlippageBps
  ) {
    return {
      status: 'denied',
      requiresApproval: false,
      effectiveMaxSwapAmount,
      reasonCode: 'policy.swap_slippage_exceeds_cap',
    }
  }

  if (maxPerTransfer == null || requestedAmount == null || autoApproveUnder == null) {
    return {
      status: 'denied',
      requiresApproval: false,
      effectiveMaxSwapAmount,
      reasonCode: 'policy.invalid_amount',
    }
  }

  if (input.trustTier === 'restricted') {
    return {
      status: 'denied',
      requiresApproval: false,
      effectiveMaxSwapAmount,
      reasonCode: 'policy.agent_restricted',
    }
  }

  if (requestedAmount > effectiveMaxBaseUnits) {
    return {
      status: 'denied',
      requiresApproval: false,
      effectiveMaxSwapAmount,
      reasonCode: 'policy.swap_amount_exceeds_limit',
    }
  }

  if (requestedAmount > autoApproveUnder) {
    return {
      status: 'restricted',
      requiresApproval: true,
      effectiveMaxSwapAmount,
      reasonCode: 'policy.swap_approval_required',
    }
  }

  return {
    status: 'allowed',
    requiresApproval: false,
    effectiveMaxSwapAmount,
    reasonCode: 'policy.swap_auto_approved',
  }
}

export type LiquidityDecisionReasonCode =
  | 'policy.invalid_amount'
  | 'policy.agent_restricted'
  | 'policy.liquidity_chain_not_allowed'
  | 'policy.liquidity_asset_not_allowed'
  | 'policy.liquidity_pool_not_allowed'
  | 'policy.liquidity_slippage_exceeds_cap'
  | 'policy.liquidity_amount_exceeds_limit'
  | 'policy.liquidity_approval_required'
  | 'policy.liquidity_auto_approved'

export type LiquidityDecision = {
  status: 'allowed' | 'restricted' | 'denied'
  requiresApproval: boolean
  effectiveMaxDepositAmount: string
  reasonCode: LiquidityDecisionReasonCode
  disallowedAsset?: string
  /** Which pool failed the allowlist (when reasonCode is liquidity_pool_not_allowed). */
  disallowedPool?: string
}

/**
 * Governance gate for a Byreal CLMM liquidity action. Deposits (open/increase) are gated like a
 * spend: the deposited asset must be allowed and the amount is held to the per-transaction limit /
 * auto-approve threshold (same trust multiplier as transfers). Withdrawals (decrease/close) return
 * the agent's OWN funds — not a spend — so they auto-approve (still blocked for restricted agents
 * or a disallowed chain). Slippage caps / per-pool rules are layered on in C5.
 */
export function evaluateLiquidityRequest(input: {
  policy: AgentPolicyTemplateInput
  op: 'open' | 'increase' | 'decrease' | 'close'
  /** Deposited token symbol (open/increase). Omit for withdraw ops. */
  depositAssetSymbol?: string
  /** UI deposit amount or USD notional (open/increase). Omit for withdraw ops. */
  depositAmount?: string
  /** Target CLMM pool (open/increase) — checked against the policy's allowedPools allowlist. */
  poolId?: string
  /** Requested slippage tolerance (bps) — checked against the policy's maxSlippageBps cap. */
  slippageBps?: number
  chainId: string
  trustTier: AgentTrustTier
}): LiquidityDecision {
  const transferPolicy = resolveAgentTransferPolicy(input.policy)
  const maxPerTransfer = parsePolicyAmount(transferPolicy.maxPerTransfer)
  const autoApproveUnder = parsePolicyAmount(transferPolicy.autoApproveUnder)
  const effectiveMaxBaseUnits = applyTrustMultiplier(maxPerTransfer ?? 0n, input.trustTier)
  const effectiveMaxDepositAmount = formatPolicyAmount(effectiveMaxBaseUnits)

  if (!transferPolicy.allowedChains.includes(input.chainId)) {
    return {
      status: 'denied',
      requiresApproval: false,
      effectiveMaxDepositAmount,
      reasonCode: 'policy.liquidity_chain_not_allowed',
    }
  }

  if (input.trustTier === 'restricted') {
    return {
      status: 'denied',
      requiresApproval: false,
      effectiveMaxDepositAmount,
      reasonCode: 'policy.agent_restricted',
    }
  }

  const isDeposit = input.op === 'open' || input.op === 'increase'
  if (!isDeposit) {
    return {
      status: 'allowed',
      requiresApproval: false,
      effectiveMaxDepositAmount,
      reasonCode: 'policy.liquidity_auto_approved',
    }
  }

  if (
    !input.depositAssetSymbol ||
    !transferPolicy.allowedAssets.includes(input.depositAssetSymbol)
  ) {
    return {
      status: 'denied',
      requiresApproval: false,
      effectiveMaxDepositAmount,
      reasonCode: 'policy.liquidity_asset_not_allowed',
      disallowedAsset: input.depositAssetSymbol,
    }
  }

  // Risk control: only deposit into vetted pools. The agent picking an unlisted pool is denied.
  const allowedPools = input.policy.allowedPools
  if (
    allowedPools != null &&
    allowedPools.length > 0 &&
    input.poolId != null &&
    !allowedPools.includes(input.poolId)
  ) {
    return {
      status: 'denied',
      requiresApproval: false,
      effectiveMaxDepositAmount,
      reasonCode: 'policy.liquidity_pool_not_allowed',
      disallowedPool: input.poolId,
    }
  }

  if (
    input.policy.maxSlippageBps != null &&
    input.slippageBps != null &&
    input.slippageBps > input.policy.maxSlippageBps
  ) {
    return {
      status: 'denied',
      requiresApproval: false,
      effectiveMaxDepositAmount,
      reasonCode: 'policy.liquidity_slippage_exceeds_cap',
    }
  }

  const requestedAmount = parsePolicyAmount(input.depositAmount)
  if (maxPerTransfer == null || autoApproveUnder == null || requestedAmount == null) {
    return {
      status: 'denied',
      requiresApproval: false,
      effectiveMaxDepositAmount,
      reasonCode: 'policy.invalid_amount',
    }
  }

  if (requestedAmount > effectiveMaxBaseUnits) {
    return {
      status: 'denied',
      requiresApproval: false,
      effectiveMaxDepositAmount,
      reasonCode: 'policy.liquidity_amount_exceeds_limit',
    }
  }

  if (requestedAmount > autoApproveUnder) {
    return {
      status: 'restricted',
      requiresApproval: true,
      effectiveMaxDepositAmount,
      reasonCode: 'policy.liquidity_approval_required',
    }
  }

  return {
    status: 'allowed',
    requiresApproval: false,
    effectiveMaxDepositAmount,
    reasonCode: 'policy.liquidity_auto_approved',
  }
}

export function compileAgentProvisioningPolicy(input: {
  agentId: string
  organizationId: string
  environment: RuntimeEnvironment
  allowedChains: string[]
  allowedSignerClasses: SignerClass[]
  policyProfileId?: string
  now: string
}): PolicyProfile {
  return {
    policyProfileId:
      input.policyProfileId ?? `policy_agent_${input.agentId}_provisioning`,
    version: 'v1',
    createdAt: input.now,
    updatedAt: input.now,
    owner: {
      organizationId: input.organizationId,
    },
    mode: 'copilot',
    scope: {
      environments: [input.environment],
      allowedChains: input.allowedChains,
    },
    permissions: {
      actions: {
        'wallet.create': {
          enabled: true,
          allowedSignerClasses: input.allowedSignerClasses,
        },
      },
      counterparty: {},
      protocols: {},
      signer: {
        allowedSignerClasses: input.allowedSignerClasses,
      },
      simulation: {},
    },
    approvals: {},
    identity: {},
    trust: {},
    emergency: {
      emergencyHaltEnabled: true,
    },
  }
}

export function compileAgentPolicy(input: {
  policy: AgentPolicyTemplateInput
  walletId: string
  now: string
  decision?: TransferDecision
}): PolicyProfile {
  const signerClasses = input.policy.allowedSignerClasses ?? ['multisig']
  const policyProfileId =
    input.policy.policyProfileId ?? `policy_agent_${input.policy.agentId}`
  const transferPolicy = resolveAgentTransferPolicy(input.policy)
  const resolvedDecision =
    input.decision ??
    ({
      status: 'allowed',
      requiresApproval: false,
      effectiveMaxTransferAmount:
        transferPolicy.maxPerTransfer ?? input.policy.maxPerTransaction,
      reasonCode: 'policy.transfer_auto_approved',
    } satisfies TransferDecision)

  return {
    policyProfileId,
    version: 'v1',
    createdAt: input.now,
    updatedAt: input.now,
    owner: {
      organizationId: input.policy.organizationId,
      walletId: input.walletId,
    },
    mode: input.policy.mode ?? 'copilot',
    scope: {
      environments: [input.policy.environment],
      allowedChains: transferPolicy.allowedChains,
      allowedWalletIds: [input.walletId],
      allowedAssets: transferPolicy.allowedAssets,
    },
    permissions: {
      actions: {
        'asset.transfer': {
          enabled: resolvedDecision.status !== 'denied',
          maxPerTransaction: resolvedDecision.effectiveMaxTransferAmount,
          allowedSignerClasses: signerClasses,
          simulationRequired: true,
          approvalRequired: resolvedDecision.requiresApproval,
          allowActiveLimitedAutoApproval: !resolvedDecision.requiresApproval,
        },
      },
      allowedAssets: transferPolicy.allowedAssets,
      counterparty: {
        allowlistedRecipientOnly: true,
        approvedCounterpartyIds: transferPolicy.allowedRecipients.map(
          (recipient) => recipient.counterpartyId,
        ),
      },
      protocols: {},
      signer: {
        allowedSignerClasses: signerClasses,
      },
      simulation: {
        requireTransferSimulation: true,
        simulationFreshnessSeconds: 300,
        requireResultHashMatch: true,
      },
    },
    approvals: resolvedDecision.requiresApproval
      ? {
          'asset.transfer': {
            singleApprovalUnder: resolvedDecision.effectiveMaxTransferAmount,
            requiredRoles: ['manager'],
            approvalExpirySeconds: input.policy.approvalExpirySeconds ?? 900,
          },
        }
      : {},
    identity: {
      requireSanctionsScreeningBeforeTransfer:
        input.policy.requireSanctionsScreening ?? true,
    },
    trust: {
      minimumWalletTrustTier: input.policy.minimumWalletTrustTier,
    },
    emergency: {
      emergencyHaltEnabled: true,
    },
    umbra: input.policy.umbra,
  }
}

async function resolveAgentForRun(input: {
  lookup: AgentPolicyLookup
  session: SessionState
  run: RunState
  kernelInput: KernelInput
}): Promise<AgentPolicyLookupRecord | undefined> {
  if (input.run.actionType === 'wallet.create') {
    const subjectId =
      typeof input.kernelInput.payload?.subjectId === 'string'
        ? input.kernelInput.payload.subjectId
        : undefined
    return subjectId ? input.lookup.get(subjectId) : undefined
  }

  const actorMatch = await input.lookup.getByActorId(input.session.actorContext.actorId)
  if (actorMatch) {
    return actorMatch
  }

  const walletId = input.session.orgContext.walletIds?.[0]
  return walletId ? input.lookup.getByWalletId(walletId) : undefined
}

export function createAgentPolicyCandidateResolver(input: {
  agentRegistry: AgentPolicyLookup
  now?: () => string
}): (input: {
  session: SessionState
  run: RunState
  kernelInput: KernelInput
}) => Promise<PolicyProfile[]> {
  const now = input.now ?? (() => new Date().toISOString())

  return async ({ session, run, kernelInput }) => {
    const agent = await resolveAgentForRun({
      lookup: input.agentRegistry,
      session,
      run,
      kernelInput,
    })
    if (!agent) {
      return []
    }

    if (run.actionType === 'wallet.create') {
      return [
        compileAgentProvisioningPolicy({
          agentId: agent.agentId,
          organizationId: agent.organizationId,
          environment: agent.environment,
          allowedChains: agent.policyConfig.allowedChains,
          allowedSignerClasses:
            agent.policyConfig.allowedSignerClasses ?? ['multisig'],
          policyProfileId: `${agent.policyConfig.policyProfileId ?? `policy_agent_${agent.agentId}`}_provisioning`,
          now: now(),
        }),
      ]
    }

    if (run.actionType === 'asset.transfer' && agent.walletId) {
      const amount =
        typeof kernelInput.payload?.amount === 'string'
          ? kernelInput.payload.amount
          : '0'
      const counterpartyId =
        typeof kernelInput.payload?.counterpartyId === 'string'
          ? kernelInput.payload.counterpartyId
          : undefined
      const destinationAddress =
        typeof kernelInput.payload?.destinationAddress === 'string'
          ? kernelInput.payload.destinationAddress
          : ''
      const chainId =
        typeof kernelInput.payload?.chainId === 'string'
          ? kernelInput.payload.chainId
          : ''
      const assetSymbol =
        typeof kernelInput.payload?.assetSymbol === 'string'
          ? kernelInput.payload.assetSymbol
          : ''

      const decision = evaluateTransferRequest({
        policy: agent.policyConfig,
        amount,
        destinationAddress,
        chainId,
        assetSymbol,
        counterpartyId,
        trustTier: agent.trustTier,
      })

      return [
        compileAgentPolicy({
          policy: agent.policyConfig,
          walletId: agent.walletId,
          now: now(),
          decision,
        }),
      ]
    }

    return []
  }
}
