import { activateAgentWallet } from './activateAgentWallet.js'
import { createAgentCredential } from './createAgentCredential.js'
import { createAgentWallet } from './createAgentWallet.js'
import {
  PUSD_SYMBOL,
  SOLANA_MAINNET_CHAIN_ID,
} from '../integrations/pusd/constants.js'
import type { PalmosServiceCatalog } from '../integrations/pusd/serviceCatalog.js'
import type { AgentPolicyTemplateInput, AgentVendorRule } from '../policies/compileAgentPolicy.js'
import type { AgentRecord } from '../store/AgentRegistry.js'
import type {
  AgentCredentialRecord,
  AgentCredentialRegistry,
} from '../store/AgentCredentialRegistry.js'
import type { AgentSpendWorkspace } from '../workspace/loadWorkspace.js'

export type CreateAgentFromOnboardingInput = {
  agentName?: string
  agentTask?: string
  maxPerCall?: string
  sessionBudget?: string
  autoApproveUnder?: string
  allowedVendors?: string[]
  walletMode?: string
  managerAddress?: string
  organizationId: string
  treasuryId?: string
  servicePayToAddress: string
}

export type CreateAgentFromOnboardingDependencies = {
  workspace: AgentSpendWorkspace
  credentials: AgentCredentialRegistry
  serviceCatalog: PalmosServiceCatalog
  now?: () => string
  createId?: (prefix: string) => string
}

function createId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32)
}

function normalizePositiveAmount(
  value: string | undefined,
  fallback: string,
): string {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback
  }

  return parsed.toFixed(6).replace(/\.?0+$/, '')
}

function normalizeVendorAlias(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, '_')
}

function resolveAllowedVendorIds(
  allowedVendors: string[] | undefined,
  serviceCatalog: PalmosServiceCatalog,
): string[] {
  const aliases = new Map<string, string>([
    ['local.palmos.ops', 'ops_research_vendor'],
    ['local_palmos_ops', 'ops_research_vendor'],
    ['local.palmos.ops_brief', 'ops_research_vendor'],
    ['local_palmos_ops_brief', 'ops_research_vendor'],
    ['local.pusd.ops_brief', 'ops_research_vendor'],
    ['local_pusd_ops_brief', 'ops_research_vendor'],
    ['ops_research_vendor', 'ops_research_vendor'],
    ['local.palmos.spot_price', 'local_pusd_demo'],
    ['local_palmos_spot_price', 'local_pusd_demo'],
    ['local.pusd.spot_price', 'local_pusd_demo'],
    ['local_pusd_spot_price', 'local_pusd_demo'],
    ['local_pusd_demo', 'local_pusd_demo'],
  ])

  for (const service of Object.values(serviceCatalog)) {
    aliases.set(normalizeVendorAlias(service.serviceId), service.vendorId)
    aliases.set(normalizeVendorAlias(service.vendorId), service.vendorId)
  }

  const resolved = (allowedVendors ?? [])
    .map((vendor) => aliases.get(normalizeVendorAlias(vendor)))
    .filter((vendorId): vendorId is string => Boolean(vendorId))

  if (resolved.length > 0) {
    return Array.from(new Set(resolved))
  }

  return Array.from(
    new Set(Object.values(serviceCatalog).map((service) => service.vendorId)),
  )
}

function buildVendorRules(input: {
  allowedVendors?: string[]
  serviceCatalog: PalmosServiceCatalog
  servicePayToAddress: string
}): AgentVendorRule[] {
  const requestedVendorIds = resolveAllowedVendorIds(
    input.allowedVendors,
    input.serviceCatalog,
  )
  const catalogRules: AgentVendorRule[] = Object.values(input.serviceCatalog).map((service) => ({
    vendorId: service.vendorId,
    label: service.label,
    destinationAddress: input.servicePayToAddress,
    chainId: service.chainId,
  }))

  return requestedVendorIds
    .map((vendorId) => catalogRules.find((rule) => rule.vendorId === vendorId))
    .filter((rule): rule is AgentVendorRule => rule != null)
}

function readWalletMode(value: string | undefined): 'ops' {
  void value
  return 'ops'
}

export async function createAgentFromOnboarding(
  deps: CreateAgentFromOnboardingDependencies,
  input: CreateAgentFromOnboardingInput,
): Promise<{
  agent: AgentRecord
  credential: AgentCredentialRecord
  token: string
}> {
  const displayName = input.agentName?.trim() || 'PalmOS Agent'
  const slug = slugify(displayName) || 'agent'
  const agentId = deps.createId?.(slug) ?? createId(slug)
  const maxPerTransaction = normalizePositiveAmount(input.maxPerCall, '0.05')
  const sessionBudget = normalizePositiveAmount(input.sessionBudget, '1')
  const autoApproveUnder = normalizePositiveAmount(
    input.autoApproveUnder,
    '0.05',
  )
  const allowedVendors = buildVendorRules({
    allowedVendors: input.allowedVendors,
    serviceCatalog: deps.serviceCatalog,
    servicePayToAddress: input.servicePayToAddress,
  })
  const policyConfig: AgentPolicyTemplateInput = {
    agentId,
    organizationId: input.organizationId,
    environment: 'production',
    walletType: readWalletMode(input.walletMode),
    allowedChains: [SOLANA_MAINNET_CHAIN_ID],
    allowedAssets: [PUSD_SYMBOL],
    allowedSignerClasses: ['multisig'],
    allowedVendors,
    autoApproveUnder,
    maxPerTransaction,
    sessionBudget,
    heartbeatTimeoutSeconds: 900,
  }
  const created = await createAgentWallet(
    {
      kernel: deps.workspace.kernel,
      agentRegistry: deps.workspace.agentRegistry,
      walletRegistry: deps.workspace.walletRegistry,
      owsClient: deps.workspace.owsClient,
      owsAccessRegistry: deps.workspace.owsAccessRegistry,
      now: deps.now,
    },
    {
      agentId,
      displayName,
      organizationId: input.organizationId,
      treasuryId: input.treasuryId,
      environment: 'production',
      managerActorId: 'manager_dashboard',
      managerRoleIds: ['manager'],
      walletType: policyConfig.walletType,
      subjectType: 'team',
      policyConfig,
      xmtpInboxId: input.managerAddress,
    },
  )
  const agent = await activateAgentWallet(
    {
      agentRegistry: deps.workspace.agentRegistry,
      walletRegistry: deps.workspace.walletRegistry,
      now: deps.now,
    },
    {
      agentId: created.agent.agentId,
      targetState: 'active_limited',
    },
  )
  const { credential, token } = await createAgentCredential(
    {
      credentials: deps.credentials,
      now: deps.now,
      createId: deps.createId,
    },
    {
      agentId: agent.agentId,
      label: 'Default SDK key',
    },
  )

  return {
    agent,
    credential,
    token,
  }
}
