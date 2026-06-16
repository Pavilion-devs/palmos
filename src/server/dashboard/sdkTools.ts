import type { AgentRecord } from '../../store/AgentRegistry.js'
import type { AgentCredentialRecord } from '../../store/AgentCredentialRegistry.js'
import type { PalmosServiceCatalog } from '../../integrations/pusd/serviceCatalog.js'
import { evaluateSpendRequest } from '../../policies/compileAgentPolicy.js'
import type { DashboardAgentWalletContext } from './agentWalletContext.js'
import { sanitizeCredential, stripAgentSecrets } from './sanitizers.js'
import { readMaybeString, readRecord } from './shared.js'

export const SDK_TOOL_NAMES = [
  'list_services',
  'request_paid_service',
  'request_asset_transfer',
  'get_byreal_quote',
  'request_asset_swap',
  'list_byreal_positions',
  'list_byreal_pools',
  'request_liquidity_action',
  'check_policy',
  'get_agent_status',
  'get_wallet_context',
] as const

export type SdkToolName = (typeof SDK_TOOL_NAMES)[number]

export type SdkAuthenticatedAgent = {
  agent: AgentRecord
  credential: AgentCredentialRecord
}

export type SdkServiceSummary = {
  serviceId: string
  label: string
  vendorId: string
  chainId: string
  assetSymbol: string
  expectedAmount: string
  paymentRail: string
  allowed: boolean
}

export type SdkPolicyCheckInput = {
  serviceId?: string
  amount?: string
}

export type SdkPolicyCheckResult = {
  ok: true
  agentId: string
  serviceId: string
  vendorId: string
  amount: string
  allowed: boolean
  status: 'allowed' | 'restricted' | 'denied'
  requiresApproval: boolean
  reasonCode: string
  effectiveMaxPerTransaction: string
}

export const SDK_TOOL_DEFINITIONS = [
  {
    name: 'list_services',
    description: 'List PalmOS paid services visible to the authenticated agent.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    },
  },
  {
    name: 'request_paid_service',
    description: 'Request a governed paid service call through PalmOS.',
    inputSchema: {
      type: 'object',
      required: ['serviceId'],
      additionalProperties: false,
      properties: {
        serviceId: { type: 'string' },
        request: { type: 'object' },
        amount: { type: 'string' },
        note: { type: 'string' },
        idempotencyKey: { type: 'string' },
      },
    },
  },
  {
    name: 'request_asset_transfer',
    description: 'Request a native governed wallet transfer through PalmOS.',
    inputSchema: {
      type: 'object',
      required: ['destinationAddress', 'chainId', 'assetSymbol', 'amount'],
      additionalProperties: false,
      properties: {
        destinationAddress: { type: 'string' },
        chainId: { type: 'string' },
        assetSymbol: { type: 'string' },
        amount: { type: 'string' },
        counterpartyId: { type: 'string' },
        note: { type: 'string' },
        idempotencyKey: { type: 'string' },
      },
    },
  },
  {
    name: 'get_byreal_quote',
    description:
      'Get a live Byreal swap quote on Solana (expected output, price impact, route). Read-only — moves no funds and needs no approval.',
    inputSchema: {
      type: 'object',
      required: ['inputMint', 'outputMint', 'amount'],
      additionalProperties: false,
      properties: {
        inputMint: { type: 'string' },
        outputMint: { type: 'string' },
        amount: { type: 'string' },
        slippageBps: { type: 'number' },
        swapMode: { type: 'string', enum: ['in', 'out'] },
      },
    },
  },
  {
    name: 'request_asset_swap',
    description:
      'Request a governed token swap on Byreal (Solana) through PalmOS. Enforced against the agent policy (allowed assets, spend limit, approval threshold) and settled via the OWS vault.',
    inputSchema: {
      type: 'object',
      required: ['inputMint', 'outputMint', 'inputAssetSymbol', 'outputAssetSymbol', 'amount'],
      additionalProperties: false,
      properties: {
        inputMint: { type: 'string' },
        outputMint: { type: 'string' },
        inputAssetSymbol: { type: 'string' },
        outputAssetSymbol: { type: 'string' },
        amount: { type: 'string' },
        slippageBps: { type: 'number' },
        swapMode: { type: 'string', enum: ['in', 'out'] },
        chainId: {
          type: 'string',
          description:
            "Settlement chain for the policy gate, e.g. 'solana-mainnet'. Defaults to the agent's first allowed chain.",
        },
        note: { type: 'string' },
        idempotencyKey: { type: 'string' },
      },
    },
  },
  {
    name: 'list_byreal_positions',
    description:
      "List the agent's Byreal CLMM liquidity positions on Solana (read-only). Use the returned nftMint to increase/decrease/close a position.",
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        pool: { type: 'string' },
        status: { type: 'number', enum: [0, 1] },
      },
    },
  },
  {
    name: 'list_byreal_pools',
    description:
      "List Byreal CLMM pools on Solana (read-only, keyless). Each pool returns its id, both token mints + symbols + decimals, current_price, tvlUsd, feeRateBps, apr, and allowedByPolicy — whether THIS agent's policy permits providing liquidity in it. Use this to discover a pool, its token mints, and its live price (e.g. to size a range) directly — you never need to look these up anywhere else.",
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: {
          type: 'string',
          description: 'Optional case-insensitive filter on the pair or a token symbol/mint, e.g. "SOL/USDC" or "USDC".',
        },
        sortField: {
          type: 'string',
          enum: ['tvl', 'volumeUsd24h', 'feeUsd24h', 'apr24h'],
          description: 'Sort key (default tvl).',
        },
        allowedOnly: {
          type: 'boolean',
          description: 'When true, return only pools this agent is allowed to provide liquidity in.',
        },
        limit: { type: 'number', description: 'Max pools to return (default 20).' },
      },
    },
  },
  {
    name: 'request_liquidity_action',
    description:
      "Request a governed Byreal CLMM liquidity action on Solana through PalmOS: open, increase, decrease, or close a position. Enforced against the agent policy (deposits are limited like a spend; withdrawals return the agent's own funds) and settled via the OWS vault. For open/increase, pass rangePercent (e.g. 12) to set a ±% range around the live price automatically — no price lookup needed — or pass explicit priceLower/priceUpper. Use list_byreal_pools to find the pool and its mints.",
    inputSchema: {
      type: 'object',
      required: ['op'],
      additionalProperties: false,
      properties: {
        op: { type: 'string', enum: ['open', 'increase', 'decrease', 'close'] },
        pool: { type: 'string' },
        priceLower: { type: 'string', description: 'Absolute lower price bound (open/increase). Omit if you pass rangePercent.' },
        priceUpper: { type: 'string', description: 'Absolute upper price bound (open/increase). Omit if you pass rangePercent.' },
        rangePercent: {
          type: 'number',
          description:
            'Open/increase: a concentrated range of ±this percent around the live pool price, computed server-side. Pass this INSTEAD of priceLower/priceUpper so you never need to know the current price.',
        },
        nftMint: { type: 'string' },
        base: {
          type: 'string',
          description:
            'For open/increase: the MINT address of the token you are supplying (must be one of the pool mints). Required with autoSwap.',
        },
        baseAssetSymbol: { type: 'string' },
        amount: {
          type: 'string',
          description: 'UI amount of `base` to supply. With autoSwap, use this (not amountUsd).',
        },
        amountUsd: {
          type: 'string',
          description: 'USD-notional deposit. NOT supported together with autoSwap — use amount + base instead.',
        },
        percentage: { type: 'number' },
        outputMint: { type: 'string' },
        autoSwap: {
          type: 'boolean',
          description:
            'Zap: supply from one token and auto-swap the other side. Requires amount + base (a pool mint); rejects amountUsd.',
        },
        slippageBps: { type: 'number' },
        chainId: {
          type: 'string',
          description:
            "Settlement chain for the policy gate, e.g. 'solana-mainnet'. Defaults to the agent's first allowed chain.",
        },
        note: { type: 'string' },
        idempotencyKey: { type: 'string' },
      },
    },
  },
  {
    name: 'check_policy',
    description: 'Check whether a service payment is allowed before execution.',
    inputSchema: {
      type: 'object',
      required: ['serviceId'],
      additionalProperties: false,
      properties: {
        serviceId: { type: 'string' },
        amount: { type: 'string' },
      },
    },
  },
  {
    name: 'get_agent_status',
    description: 'Return authenticated agent and credential status.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    },
  },
  {
    name: 'get_wallet_context',
    description:
      'Return the authenticated agent wallet, on-chain balances and portfolio, recent activity, and the policy controls the agent must act within.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    },
  },
] satisfies Array<{
  name: SdkToolName
  description: string
  inputSchema: Record<string, unknown>
}>

export function isSdkToolName(value: string): value is SdkToolName {
  return SDK_TOOL_NAMES.includes(value as SdkToolName)
}

export function readSdkToolInput(value: unknown): Record<string, unknown> {
  const record = readRecord(value)
  if (record.input && typeof record.input === 'object' && !Array.isArray(record.input)) {
    return record.input as Record<string, unknown>
  }

  return record
}

export function buildSdkServiceSummaries(input: {
  agent: AgentRecord
  serviceCatalog: PalmosServiceCatalog
}): SdkServiceSummary[] {
  const allowedVendorIds = new Set(
    input.agent.policyConfig.allowedVendors.map((vendor) => vendor.vendorId),
  )

  return Object.values(input.serviceCatalog)
    .filter((service) => service.visible !== false)
    .map((service) => ({
      serviceId: service.serviceId,
      label: service.label,
      vendorId: service.vendorId,
      chainId: service.chainId,
      assetSymbol: service.assetSymbol,
      expectedAmount: service.expectedAmount,
      paymentRail: service.paymentRail,
      allowed: allowedVendorIds.has(service.vendorId),
    }))
}

export function buildSdkAgentStatus(input: SdkAuthenticatedAgent) {
  return {
    ok: true,
    agent: stripAgentSecrets(input.agent),
    credential: sanitizeCredential(input.credential),
    status: {
      agentId: input.agent.agentId,
      agentStatus: input.agent.status,
      credentialStatus: input.credential.status,
      trustTier: input.agent.trustTier,
      settlementMode: input.agent.settlementMode,
      walletState: input.agent.walletState,
      lastCheckInAt: input.agent.lastCheckInAt,
    },
  }
}

export function readSdkPolicyCheckInput(value: unknown): SdkPolicyCheckInput {
  const input = readSdkToolInput(value)
  return {
    serviceId: readMaybeString(input.serviceId),
    amount: readMaybeString(input.amount),
  }
}

function readSwapMode(value: unknown): 'in' | 'out' | undefined {
  return value === 'in' || value === 'out' ? value : undefined
}

function readMaybeNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value)
  }
  return undefined
}

export type SdkSwapRequestInput = {
  inputMint?: string
  outputMint?: string
  inputAssetSymbol?: string
  outputAssetSymbol?: string
  amount?: string
  slippageBps?: number
  swapMode?: 'in' | 'out'
  chainId?: string
  note?: string
  idempotencyKey?: string
}

export function readSdkSwapRequestInput(value: unknown): SdkSwapRequestInput {
  const input = readSdkToolInput(value)
  return {
    inputMint: readMaybeString(input.inputMint),
    outputMint: readMaybeString(input.outputMint),
    inputAssetSymbol: readMaybeString(input.inputAssetSymbol),
    outputAssetSymbol: readMaybeString(input.outputAssetSymbol),
    amount: readMaybeString(input.amount),
    slippageBps: readMaybeNumber(input.slippageBps),
    swapMode: readSwapMode(input.swapMode),
    chainId: readMaybeString(input.chainId),
    note: readMaybeString(input.note),
    idempotencyKey: readMaybeString(input.idempotencyKey),
  }
}

export type SdkQuoteRequestInput = {
  inputMint?: string
  outputMint?: string
  amount?: string
  slippageBps?: number
  swapMode?: 'in' | 'out'
}

export function readSdkQuoteRequestInput(value: unknown): SdkQuoteRequestInput {
  const input = readSdkToolInput(value)
  return {
    inputMint: readMaybeString(input.inputMint),
    outputMint: readMaybeString(input.outputMint),
    amount: readMaybeString(input.amount),
    slippageBps: readMaybeNumber(input.slippageBps),
    swapMode: readSwapMode(input.swapMode),
  }
}

function readBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (value === 'true') return true
  if (value === 'false') return false
  return undefined
}

function readLiquidityOp(value: unknown): 'open' | 'increase' | 'decrease' | 'close' | undefined {
  return value === 'open' || value === 'increase' || value === 'decrease' || value === 'close'
    ? value
    : undefined
}

export type SdkLiquidityRequestInput = {
  op?: 'open' | 'increase' | 'decrease' | 'close'
  pool?: string
  priceLower?: string
  priceUpper?: string
  rangePercent?: number
  nftMint?: string
  base?: string
  baseAssetSymbol?: string
  amount?: string
  amountUsd?: string
  percentage?: number
  outputMint?: string
  autoSwap?: boolean
  slippageBps?: number
  chainId?: string
  note?: string
  idempotencyKey?: string
}

export function readSdkLiquidityRequestInput(value: unknown): SdkLiquidityRequestInput {
  const input = readSdkToolInput(value)
  return {
    op: readLiquidityOp(input.op),
    pool: readMaybeString(input.pool),
    priceLower: readMaybeString(input.priceLower),
    priceUpper: readMaybeString(input.priceUpper),
    rangePercent: readMaybeNumber(input.rangePercent),
    nftMint: readMaybeString(input.nftMint),
    base: readMaybeString(input.base),
    baseAssetSymbol: readMaybeString(input.baseAssetSymbol),
    amount: readMaybeString(input.amount),
    amountUsd: readMaybeString(input.amountUsd),
    percentage: readMaybeNumber(input.percentage),
    outputMint: readMaybeString(input.outputMint),
    autoSwap: readBoolean(input.autoSwap),
    slippageBps: readMaybeNumber(input.slippageBps),
    chainId: readMaybeString(input.chainId),
    note: readMaybeString(input.note),
    idempotencyKey: readMaybeString(input.idempotencyKey),
  }
}

export type SdkListPositionsInput = {
  pool?: string
  status?: 0 | 1
}

export function readSdkListPositionsInput(value: unknown): SdkListPositionsInput {
  const input = readSdkToolInput(value)
  const statusNum = readMaybeNumber(input.status)
  return {
    pool: readMaybeString(input.pool),
    status: statusNum === 1 ? 1 : statusNum === 0 ? 0 : undefined,
  }
}

export type SdkListPoolsInput = {
  query?: string
  sortField?: 'tvl' | 'volumeUsd24h' | 'feeUsd24h' | 'apr24h'
  allowedOnly?: boolean
  limit?: number
}

export function readSdkListPoolsInput(value: unknown): SdkListPoolsInput {
  const input = readSdkToolInput(value)
  const sf = readMaybeString(input.sortField)
  const sortField =
    sf === 'volumeUsd24h' || sf === 'feeUsd24h' || sf === 'apr24h'
      ? sf
      : sf === 'tvl'
        ? 'tvl'
        : undefined
  return {
    query: readMaybeString(input.query),
    sortField,
    allowedOnly: readBoolean(input.allowedOnly),
    limit: readMaybeNumber(input.limit),
  }
}

export function buildSdkPolicyCheck(input: {
  agent: AgentRecord
  serviceCatalog: PalmosServiceCatalog
  serviceId: string
  amount?: string
}): SdkPolicyCheckResult | undefined {
  const service = input.serviceCatalog[input.serviceId]
  if (!service) {
    return undefined
  }

  const amount = input.amount ?? service.expectedAmount
  const decision = evaluateSpendRequest({
    policy: input.agent.policyConfig,
    amount,
    vendorId: service.vendorId,
    trustTier: input.agent.trustTier,
  })

  return {
    ok: true,
    agentId: input.agent.agentId,
    serviceId: service.serviceId,
    vendorId: service.vendorId,
    amount,
    allowed: decision.status !== 'denied',
    status: decision.status,
    requiresApproval: decision.requiresApproval,
    reasonCode: decision.reasonCode,
    effectiveMaxPerTransaction: decision.effectiveMaxPerTransaction,
  }
}

// Agent-facing wallet context. Unlike the dashboard projection (built for the
// operator), this is what the agent sees about its OWN wallet: balances and
// activity plus the policy controls it must act within. It reuses the dashboard
// projection for wallet/portfolio/activity and adds the spend limits an agent
// needs to reason about what it is allowed to do.
export type SdkWalletContext = {
  ok: true
  agentId: string
  wallet: DashboardAgentWalletContext['wallet']
  portfolio: DashboardAgentWalletContext['portfolio']
  activity: DashboardAgentWalletContext['activity']
  controls: DashboardAgentWalletContext['controls'] & {
    maxPerTransaction?: AgentRecord['policyConfig']['maxPerTransaction']
    autoApproveUnder?: AgentRecord['policyConfig']['autoApproveUnder']
    sessionBudget?: AgentRecord['policyConfig']['sessionBudget']
  }
}

export function buildSdkWalletContext(input: {
  agent: AgentRecord
  walletContext: DashboardAgentWalletContext
}): SdkWalletContext {
  const { agent, walletContext } = input
  return {
    ok: true,
    agentId: agent.agentId,
    wallet: walletContext.wallet,
    portfolio: walletContext.portfolio,
    activity: walletContext.activity,
    controls: {
      ...walletContext.controls,
      maxPerTransaction: agent.policyConfig.maxPerTransaction,
      autoApproveUnder: agent.policyConfig.autoApproveUnder,
      sessionBudget: agent.policyConfig.sessionBudget,
    },
  }
}
