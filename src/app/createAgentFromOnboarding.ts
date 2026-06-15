import { activateAgentWallet } from './activateAgentWallet.js'
import { createAgentCredential } from './createAgentCredential.js'
import { createAgentWallet } from './createAgentWallet.js'
import {
  formatPusdBaseUnits,
  parsePusdAmountToBaseUnits,
} from '../integrations/pusd/amount.js'
import {
  PUSD_SYMBOL,
  SOLANA_MAINNET_CHAIN_ID,
  readPusdNetworkFromEnv,
  type SolanaCluster,
} from '../integrations/pusd/constants.js'
import type { PalmosServiceCatalog } from '../integrations/pusd/serviceCatalog.js'
import type { AgentPolicyTemplateInput, AgentVendorRule } from '../policies/compileAgentPolicy.js'
import type { AgentRecord } from '../store/AgentRegistry.js'
import type {
  AgentCredentialRecord,
  AgentCredentialRegistry,
} from '../store/AgentCredentialRegistry.js'
import type { RegisteredPalmosServiceRecord } from '../store/PalmosServiceRegistry.js'
import {
  normalizeAgentSettlementMode,
  type AgentSettlementMode,
} from '../store/AgentRegistry.js'
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
  owsImportPrivateKey?: string
  organizationId: string
  treasuryId?: string
  servicePayToAddress: string
  // Solana cluster the agent's wallet + policy target. Defaults from
  // PUSD_SOLANA_NETWORK so a devnet proof doesn't fabricate mainnet/PUSD rails.
  solanaNetwork?: SolanaCluster
}

export type CreateAgentFromOnboardingDependencies = {
  workspace: AgentSpendWorkspace
  credentials: AgentCredentialRegistry
  serviceCatalog: PalmosServiceCatalog
  registeredServices?: RegisteredPalmosServiceRecord[]
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
  if (!value) {
    return fallback
  }

  try {
    const parsed = parsePusdAmountToBaseUnits(value)
    return parsed > 0n ? formatPusdBaseUnits(parsed) : fallback
  } catch {
    return fallback
  }
}

function normalizeVendorAlias(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, '_')
}

function resolveAllowedVendorIds(
  allowedVendors: string[] | undefined,
  serviceCatalog: PalmosServiceCatalog,
): string[] {
  const aliases = new Map<string, string>([
    ['palmos.launch.audit', 'palmos_launch_auditor'],
    ['palmos_launch_audit', 'palmos_launch_auditor'],
    ['palmos_launch_auditor', 'palmos_launch_auditor'],
    ['palmos.intel.onchain_flow', 'palmos_intel_vendor'],
    ['palmos_intel_onchain_flow', 'palmos_intel_vendor'],
    ['palmos_intel_vendor', 'palmos_intel_vendor'],
    ['palmos.research.defi_risk', 'palmos_research_vendor'],
    ['palmos_research_defi_risk', 'palmos_research_vendor'],
    ['palmos_research_vendor', 'palmos_research_vendor'],
    ['palmos.ops.vendor_brief', 'palmos_ops_vendor'],
    ['palmos_ops_vendor_brief', 'palmos_ops_vendor'],
    ['palmos_ops_vendor', 'palmos_ops_vendor'],
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
  registeredServices?: RegisteredPalmosServiceRecord[]
  servicePayToAddress: string
}): AgentVendorRule[] {
  const requestedVendorIds = resolveAllowedVendorIds(
    input.allowedVendors,
    input.serviceCatalog,
  )
  const registeredByServiceId = new Map(
    (input.registeredServices ?? []).map((service) => [
      service.serviceId,
      service,
    ]),
  )
  const registeredByVendorId = new Map(
    (input.registeredServices ?? []).map((service) => [
      service.vendorId,
      service,
    ]),
  )
  const catalogRules: AgentVendorRule[] = Object.values(input.serviceCatalog).map((service) => ({
    vendorId: service.vendorId,
    label: service.label,
    destinationAddress:
      registeredByServiceId.get(service.serviceId)?.destinationAddress ??
      registeredByVendorId.get(service.vendorId)?.destinationAddress ??
      input.servicePayToAddress,
    chainId: service.chainId,
  }))

  return requestedVendorIds
    .map((vendorId) => catalogRules.find((rule) => rule.vendorId === vendorId))
    .filter((rule): rule is AgentVendorRule => rule != null)
}

function readWalletMode(_value: string | undefined): 'ops' {
  return 'ops'
}

function readSettlementMode(value: string | undefined): AgentSettlementMode {
  const normalized = value?.trim().toLowerCase()
  if (normalized === '2' || normalized === 'ows') {
    return 'ows'
  }
  if (
    normalized === '3' ||
    normalized === 'real-solana' ||
    normalized === 'real_solana' ||
    normalized === 'solana' ||
    normalized === 'mainnet'
  ) {
    return 'real-solana'
  }

  return normalizeAgentSettlementMode(normalized)
}

export async function createAgentFromOnboarding(
  deps: CreateAgentFromOnboardingDependencies,
  input: CreateAgentFromOnboardingInput,
): Promise<{
  agent: AgentRecord
  credential: AgentCredentialRecord
  token: string
  /** Recovery phrase for a freshly-created OWS wallet — present once, for backup. */
  walletRecoveryPhrase?: string
}> {
  const displayName = input.agentName?.trim() || 'PalmOS Agent'
  const slug = slugify(displayName) || 'agent'
  const agentId = deps.createId?.(slug) ?? createId(slug)
  const maxPerTransaction = normalizePositiveAmount(input.maxPerCall, '2')
  const sessionBudget = normalizePositiveAmount(input.sessionBudget, '2')
  const autoApproveUnder = normalizePositiveAmount(
    input.autoApproveUnder,
    '0.05',
  )
  const allowedVendors = buildVendorRules({
    allowedVendors: input.allowedVendors,
    serviceCatalog: deps.serviceCatalog,
    registeredServices: deps.registeredServices,
    servicePayToAddress: input.servicePayToAddress,
  })
  // Target cluster drives the agent's rails. On mainnet we keep PUSD; on
  // devnet/local we expose SOL + USDC (PUSD has no devnet mint) so the rails
  // match the real fundable wallet instead of lying about mainnet/PUSD.
  const solanaNetwork = input.solanaNetwork ?? readPusdNetworkFromEnv()
  const allowedAssets: string[] =
    solanaNetwork === SOLANA_MAINNET_CHAIN_ID
      ? [PUSD_SYMBOL]
      : ['SOL', 'USDC']
  const policyConfig: AgentPolicyTemplateInput = {
    agentId,
    organizationId: input.organizationId,
    environment: 'production',
    walletType: readWalletMode(input.walletMode),
    allowedChains: [solanaNetwork],
    allowedAssets,
    allowedSignerClasses: ['multisig'],
    allowedVendors,
    autoApproveUnder,
    maxPerTransaction,
    sessionBudget,
    heartbeatTimeoutSeconds: 900,
  }
  const settlementMode = readSettlementMode(input.walletMode)
  const created = await createAgentWallet(
    {
      kernel: deps.workspace.kernel,
      agentRegistry: deps.workspace.agentRegistry,
      walletRegistry: deps.workspace.walletRegistry,
      actionRequests: deps.workspace.actionRequestRegistry,
      owsClient: settlementMode === 'ows' ? deps.workspace.owsClient : undefined,
      owsAccessRegistry:
        settlementMode === 'ows' ? deps.workspace.owsAccessRegistry : undefined,
      now: deps.now,
      createId: deps.createId,
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
      settlementMode,
      subjectType: 'team',
      policyConfig,
      xmtpInboxId: input.managerAddress,
      owsImportPrivateKey:
        settlementMode === 'ows' ? input.owsImportPrivateKey : undefined,
      owsImportChain: settlementMode === 'ows' ? 'solana' : undefined,
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
    walletRecoveryPhrase: created.walletRecoveryPhrase,
  }
}
