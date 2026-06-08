import { PublicKey } from '@solana/web3.js'
import type { WalletRecord } from '../../../runtime/contracts/wallet.js'
import {
  PALMOS_PAYMENT_RAIL,
  readPusdMintFromEnv,
  readSolanaRpcUrlFromEnv,
  SOLANA_LOCAL_CHAIN_ID,
  SOLANA_MAINNET_CHAIN_ID,
} from '../../integrations/pusd/constants.js'
import type {
  PalmosPaidServiceDefinition,
  PalmosServiceCatalog,
} from '../../integrations/pusd/serviceCatalog.js'
import type { OwsClient } from '../../integrations/ows/client.js'
import {
  normalizeAgentSettlementMode,
  type AgentRecord,
  type AgentSettlementMode,
} from '../../store/AgentRegistry.js'
import type { RegisteredPalmosServiceRecord } from '../../store/PalmosServiceRegistry.js'
import type { AgentSpendWorkspace } from '../../workspace/loadWorkspace.js'
import {
  evaluatePalmosServiceReadiness,
  type ServiceReadinessCheck,
} from './serviceReadiness.js'
import { readServiceEndpointAllowlist, type EndpointLookup } from './serviceEndpointSafety.js'
import { readLocalDemoSettlementPosture } from '../../app/localDemoSettlement.js'
import { readAgentPrivacyMode } from '../../app/agentPrivacyMode.js'

export type SettlementReadinessStatus = 'ready' | 'warning' | 'blocked'

export type SettlementReadinessCheck = {
  code: string
  message: string
  severity: SettlementReadinessStatus
}

export type AgentSettlementReadiness = {
  agentId: string
  displayName: string
  settlementMode: AgentSettlementMode
  privacyMode: 'disabled' | 'allowed' | 'required'
  privateSettlementReady: boolean
  status: SettlementReadinessStatus
  walletId?: string
  walletAddress?: string
  walletState?: string
  walletBackend?: string
  owsWalletName?: string
  owsSolanaAddress?: string
  checks: SettlementReadinessCheck[]
}

export type ServiceSettlementModeReadiness = {
  mode: AgentSettlementMode
  status: SettlementReadinessStatus
  checks: SettlementReadinessCheck[]
}

export type ServiceSettlementReadiness = {
  serviceId: string
  label: string
  vendorId: string
  paymentRail: string
  chainId: string
  assetSymbol: string
  expectedAmount: string
  recipient?: string
  registered: boolean
  verificationStatus?: string
  endpointUrl?: string
  modes: Record<AgentSettlementMode, ServiceSettlementModeReadiness>
}

export type DashboardSettlementReadinessReport = {
  ok: true
  generatedAt: string
  agents: AgentSettlementReadiness[]
  services: ServiceSettlementReadiness[]
  summary: {
    agents: {
      total: number
      ready: number
      warning: number
      blocked: number
    }
    services: {
      total: number
      readyForLocalDemo: number
      readyForRealSettlement: number
      blockedForRealSettlement: number
    }
  }
}

type Env = Record<string, string | undefined>

function isValidPublicKey(value: string | undefined): boolean {
  if (!value?.trim()) {
    return false
  }

  try {
    new PublicKey(value.trim())
    return true
  } catch {
    return false
  }
}

function readStatus(checks: SettlementReadinessCheck[]): SettlementReadinessStatus {
  if (checks.some((check) => check.severity === 'blocked')) {
    return 'blocked'
  }
  if (checks.some((check) => check.severity === 'warning')) {
    return 'warning'
  }
  return 'ready'
}

function check(
  code: string,
  message: string,
  severity: SettlementReadinessStatus,
): SettlementReadinessCheck {
  return {
    code,
    message,
    severity,
  }
}

function hasRealSolanaSigner(env: Env): boolean {
  return Boolean(
    env.PUSD_AGENT_PRIVATE_KEY?.trim() ||
      env.PUSD_AGENT_KEYPAIR_PATH?.trim() ||
      env.OWS_WALLET_PRIVATE_KEY?.trim(),
  )
}

function findWalletAddress(input: {
  agent: AgentRecord
  wallet?: WalletRecord
  owsClient?: OwsClient
  settlementMode: AgentSettlementMode
}): string | undefined {
  if (input.settlementMode === 'ows' && input.agent.owsWalletName) {
    return (
      input.owsClient?.getSolanaAddress(input.agent.owsWalletName)?.trim() ||
      input.wallet?.address?.trim()
    )
  }

  return (
    input.wallet?.address?.trim() ||
    (input.agent.owsWalletName
      ? input.owsClient?.getSolanaAddress(input.agent.owsWalletName)?.trim()
      : undefined)
  )
}

export function buildAgentSettlementReadiness(input: {
  agent: AgentRecord
  wallet?: WalletRecord
  owsClient?: OwsClient
  env: Env
}): AgentSettlementReadiness {
  const settlementMode = normalizeAgentSettlementMode(input.agent.settlementMode)
  const privacyMode = readAgentPrivacyMode(input.agent.policyConfig)
  const checks: SettlementReadinessCheck[] = []
  const walletAddress = findWalletAddress({ ...input, settlementMode })

  if (input.agent.status !== 'ready') {
    checks.push(
      check(
        'agent.not_ready',
        `Agent status is ${input.agent.status}; settlement should not run until the agent is ready.`,
        'blocked',
      ),
    )
  }

  if (settlementMode === 'local-demo') {
    const localDemoPosture = readLocalDemoSettlementPosture(input.env)
    checks.push(
      check(
        localDemoPosture.allowed
          ? 'settlement.local_demo_only'
          : 'settlement.local_demo_blocked',
        localDemoPosture.reason,
        localDemoPosture.allowed ? 'warning' : 'blocked',
      ),
    )
  }

  if (settlementMode === 'real-solana') {
    if (!input.agent.walletId) {
      checks.push(
        check(
          'wallet.missing',
          'Real Solana settlement requires an agent wallet.',
          'blocked',
        ),
      )
    }
    if (input.agent.walletId && !input.wallet) {
      checks.push(
        check(
          'wallet.not_found',
          `Wallet ${input.agent.walletId} was not found in storage.`,
          'blocked',
        ),
      )
    }
    if (!isValidPublicKey(walletAddress)) {
      checks.push(
        check(
          'wallet.invalid_address',
          'Real Solana settlement requires a valid payer wallet address.',
          'blocked',
        ),
      )
    }
    if (
      input.wallet?.state &&
      input.wallet.state !== 'active_limited' &&
      input.wallet.state !== 'active_full'
    ) {
      checks.push(
        check(
          'wallet.not_active',
          `Wallet state ${input.wallet.state} is not active for settlement.`,
          'blocked',
        ),
      )
    }
    if (!hasRealSolanaSigner(input.env)) {
      checks.push(
        check(
          'signer.not_configured',
          'Real Solana settlement requires PUSD_AGENT_PRIVATE_KEY or PUSD_AGENT_KEYPAIR_PATH.',
          'blocked',
        ),
      )
    }
    if (!isValidPublicKey(readPusdMintFromEnv(input.env))) {
      checks.push(
        check('pusd.invalid_mint', 'Configured PUSD mint is invalid.', 'blocked'),
      )
    }
    try {
      new URL(readSolanaRpcUrlFromEnv(input.env))
    } catch {
      checks.push(
        check('solana.invalid_rpc_url', 'Configured Solana RPC URL is invalid.', 'blocked'),
      )
    }
  }

  if (settlementMode === 'ows') {
    if (!input.owsClient) {
      checks.push(
        check('ows.client_missing', 'OWS settlement requires OWS client configuration.', 'blocked'),
      )
    }
    if (!input.agent.owsWalletName) {
      checks.push(
        check('ows.wallet_missing', 'OWS settlement requires an attached OWS wallet.', 'blocked'),
      )
    }
    if (input.agent.owsWalletName && !isValidPublicKey(walletAddress)) {
      checks.push(
        check(
          'ows.invalid_solana_address',
          'OWS wallet does not expose a valid Solana payer address.',
          'blocked',
        ),
      )
    }
  }

  if (privacyMode !== 'disabled') {
    if (input.agent.policyConfig.umbra?.mixerRequired !== true) {
      checks.push(
        check(
          'privacy.umbra_policy_missing',
          'Private mode requires an Umbra mixer policy attachment.',
          'blocked',
        ),
      )
    }
    if (!input.env.UMBRA_SECRET_KEY_BASE64?.trim()) {
      checks.push(
        check(
          'privacy.umbra_secret_missing',
          'Private mode requires UMBRA_SECRET_KEY_BASE64 before private settlement can execute.',
          privacyMode === 'required' ? 'blocked' : 'warning',
        ),
      )
    }
  }

  return {
    agentId: input.agent.agentId,
    displayName: input.agent.displayName,
    settlementMode,
    privacyMode,
    privateSettlementReady:
      privacyMode !== 'disabled' &&
      input.agent.policyConfig.umbra?.mixerRequired === true &&
      Boolean(input.env.UMBRA_SECRET_KEY_BASE64?.trim()),
    status: readStatus(checks),
    walletId: input.agent.walletId,
    walletAddress,
    walletState: input.wallet?.state ?? input.agent.walletState,
    walletBackend: input.agent.walletBackend,
    owsWalletName: input.agent.owsWalletName,
    owsSolanaAddress: input.agent.owsWalletName
      ? input.owsClient?.getSolanaAddress(input.agent.owsWalletName)
      : undefined,
    checks,
  }
}

function mapServiceChecks(
  checks: ServiceReadinessCheck[],
  severity: SettlementReadinessStatus,
): SettlementReadinessCheck[] {
  return checks.map((item) => check(item.code, item.message, severity))
}

async function buildServiceModeReadiness(input: {
  mode: AgentSettlementMode
  service: PalmosPaidServiceDefinition<unknown>
  registeredService?: RegisteredPalmosServiceRecord
  recipient?: string
  env: Env
  lookup?: EndpointLookup
}): Promise<ServiceSettlementModeReadiness> {
  const checks: SettlementReadinessCheck[] = []
  const requiresRealReadiness = input.mode !== 'local-demo'
  const localDemoPosture =
    input.mode === 'local-demo'
      ? readLocalDemoSettlementPosture(input.env)
      : undefined
  if (localDemoPosture && !localDemoPosture.allowed) {
    checks.push(
      check(
        'settlement.local_demo_blocked',
        localDemoPosture.reason,
        'blocked',
      ),
    )
  }
  const serviceResult = await evaluatePalmosServiceReadiness({
    service: input.service,
    registeredService: input.registeredService,
    destinationAddress: input.recipient,
    endpointUrl: input.registeredService?.endpointUrl,
    requestedAmount: input.service.expectedAmount,
    requireVerified: requiresRealReadiness && input.registeredService != null,
    requireSafeEndpoint: requiresRealReadiness && input.registeredService != null,
    allowedHostnames: readServiceEndpointAllowlist(input.env),
    lookup: input.lookup,
  })

  if (!serviceResult.ok) {
    checks.push(
      ...mapServiceChecks(
        serviceResult.checks,
        requiresRealReadiness ? 'blocked' : 'warning',
      ),
    )
  }

  if (requiresRealReadiness && input.service.chainId === SOLANA_LOCAL_CHAIN_ID) {
    checks.push(
      check(
        'service.local_chain',
        'Real settlement cannot use a local Solana service chain.',
        'blocked',
      ),
    )
  }

  if (
    input.mode === 'ows' &&
    input.service.paymentRail === PALMOS_PAYMENT_RAIL &&
    input.service.chainId !== SOLANA_MAINNET_CHAIN_ID
  ) {
    checks.push(
      check(
        'ows.unsupported_chain',
        `OWS PUSD settlement is expected on ${SOLANA_MAINNET_CHAIN_ID}; service uses ${input.service.chainId}.`,
        'blocked',
      ),
    )
  }

  return {
    mode: input.mode,
    status: readStatus(checks),
    checks,
  }
}

export async function buildServiceSettlementReadiness(input: {
  service: PalmosPaidServiceDefinition<unknown>
  registeredService?: RegisteredPalmosServiceRecord
  env: Env
  defaultRecipient?: string
  lookup?: EndpointLookup
}): Promise<ServiceSettlementReadiness> {
  const recipient =
    input.registeredService?.destinationAddress?.trim() ??
    input.defaultRecipient?.trim()
  const modes = {
    'local-demo': await buildServiceModeReadiness({
      mode: 'local-demo',
      service: input.service,
      registeredService: input.registeredService,
      recipient,
      env: input.env,
      lookup: input.lookup,
    }),
    'real-solana': await buildServiceModeReadiness({
      mode: 'real-solana',
      service: input.service,
      registeredService: input.registeredService,
      recipient,
      env: input.env,
      lookup: input.lookup,
    }),
    ows: await buildServiceModeReadiness({
      mode: 'ows',
      service: input.service,
      registeredService: input.registeredService,
      recipient,
      env: input.env,
      lookup: input.lookup,
    }),
  }

  return {
    serviceId: input.service.serviceId,
    label: input.service.label,
    vendorId: input.service.vendorId,
    paymentRail: input.service.paymentRail,
    chainId: input.service.chainId,
    assetSymbol: input.service.assetSymbol,
    expectedAmount: input.service.expectedAmount,
    recipient,
    registered: Boolean(input.registeredService),
    verificationStatus:
      input.registeredService?.verificationStatus ??
      input.service.verificationStatus,
    endpointUrl: input.registeredService?.endpointUrl,
    modes,
  }
}

export async function buildDashboardSettlementReadiness(input: {
  workspace: AgentSpendWorkspace
  serviceCatalog: PalmosServiceCatalog
  owsClient?: OwsClient
  env: Env
  defaultRecipient?: string
  lookup?: EndpointLookup
  now?: () => string
}): Promise<DashboardSettlementReadinessReport> {
  const [agents, services] = await Promise.all([
    input.workspace.agentRegistry.list(),
    input.workspace.serviceRegistry.list(),
  ])
  const registeredById = new Map(
    services.map((service) => [service.serviceId, service]),
  )

  const agentReadiness = await Promise.all(
    agents.map(async (agent) => {
      const wallet = agent.walletId
        ? await input.workspace.walletRegistry.get(agent.walletId)
        : undefined
      return buildAgentSettlementReadiness({
        agent,
        wallet,
        owsClient: input.owsClient,
        env: input.env,
      })
    }),
  )

  const serviceReadiness = await Promise.all(
    Object.values(input.serviceCatalog)
      .filter((service) => service.visible !== false)
      .map((service) =>
        buildServiceSettlementReadiness({
          service,
          registeredService: registeredById.get(service.serviceId),
          env: input.env,
          defaultRecipient: input.defaultRecipient,
          lookup: input.lookup,
        }),
      ),
  )

  return {
    ok: true,
    generatedAt: input.now?.() ?? new Date().toISOString(),
    agents: agentReadiness,
    services: serviceReadiness,
    summary: {
      agents: {
        total: agentReadiness.length,
        ready: agentReadiness.filter((item) => item.status === 'ready').length,
        warning: agentReadiness.filter((item) => item.status === 'warning').length,
        blocked: agentReadiness.filter((item) => item.status === 'blocked').length,
      },
      services: {
        total: serviceReadiness.length,
        readyForLocalDemo: serviceReadiness.filter(
          (item) => item.modes['local-demo'].status !== 'blocked',
        ).length,
        readyForRealSettlement: serviceReadiness.filter(
          (item) =>
            item.modes['real-solana'].status === 'ready' ||
            item.modes.ows.status === 'ready',
        ).length,
        blockedForRealSettlement: serviceReadiness.filter(
          (item) =>
            item.modes['real-solana'].status === 'blocked' &&
            item.modes.ows.status === 'blocked',
        ).length,
      },
    },
  }
}
