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
