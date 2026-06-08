import type { WalletRecord } from '../../../runtime/contracts/wallet.js'
import type { AgentRecord } from '../../store/AgentRegistry.js'
import type { OwsAccessRecord } from '../../store/OwsAccessRegistry.js'
import type {
  ZerionClient,
  ZerionWalletSnapshot,
  ZerionWalletSyncStatus,
} from '../../integrations/zerion/client.js'

export type DashboardAgentWalletContext = {
  agentId: string
  agentName: string
  wallet: {
    walletId?: string
    address?: string
    state?: WalletRecord['state']
    walletType?: WalletRecord['walletType']
    backend?: AgentRecord['walletBackend']
    settlementMode?: AgentRecord['settlementMode']
    providerId?: string
    providerWalletId?: string
    providerWalletName?: string
    signerProfileId?: string
    signerHealthStatus?: WalletRecord['signerHealthStatus']
    trustStatus?: WalletRecord['trustStatus']
    policyAttachmentStatus?: WalletRecord['policyAttachmentStatus']
    supportedChains: string[]
  }
  controls: {
    allowedAssets: string[]
    allowedChains: string[]
    allowedSignerClasses: string[]
    allowedVendors: string[]
    privacyMode: 'required' | 'optional' | 'off'
  }
  portfolio: {
    sync: ZerionWalletSyncStatus
    totalValueUsd: number
    positionsCount: number
    topPositions: Array<{
      id?: string
      symbol?: string
      chainId?: string
      value?: number
      quantity?: number
    }>
  }
  activity: {
    transactionsCount: number
    latestTransactionAt?: string
    latestTransactionChain?: string
    recentTransactions: Array<{
      id?: string
      hash?: string
      chainId?: string
      operationType?: string
      minedAt?: string
      direction?: string
      value?: number
    }>
  }
  owsAccess?: {
    owsWalletId: string
    owsWalletName: string
    apiKeyId?: string
    apiKeyName?: string
  }
}

function readWalletAddress(input: {
  wallet?: WalletRecord
  agent: AgentRecord
}): string {
  return input.wallet?.address?.trim() || ''
}

function formatAllowedVendorLabels(agent: AgentRecord): string[] {
  return (agent.policyConfig.allowedVendors ?? []).map(
    (vendor) => vendor.label ?? vendor.vendorId,
  )
}

function readPrivacyMode(agent: AgentRecord): 'required' | 'optional' | 'off' {
  const umbra = agent.policyConfig.umbra
  if (umbra?.mixerRequired) {
    return 'required'
  }
  if (umbra) {
    return 'optional'
  }
  return 'off'
}

function parseMinedAt(value: string | undefined): number {
  const parsed = value ? Date.parse(value) : Number.NaN
  return Number.isFinite(parsed) ? parsed : 0
}

function buildDisabledSnapshot(input: {
  address: string
  chainId?: string
}): ZerionWalletSnapshot {
  return {
    address: input.address,
    positions: [],
    transactions: [],
    sync: {
      kind: 'disabled',
      chainId: input.chainId,
      message: 'Portfolio enrichment is not configured on the backend.',
    },
  }
}

async function loadZerionSnapshot(input: {
  zerionClient?: ZerionClient
  address: string
  chainId?: string
}): Promise<ZerionWalletSnapshot> {
  if (!input.zerionClient) {
    return buildDisabledSnapshot({
      address: input.address,
      chainId: input.chainId,
    })
  }

  return input.zerionClient.getWalletSnapshot(input.address, {
    chainId: input.chainId,
  })
}

export async function buildDashboardAgentWalletContext(input: {
  agent: AgentRecord
  wallet?: WalletRecord
  owsAccess?: OwsAccessRecord
  zerionClient?: ZerionClient
}): Promise<DashboardAgentWalletContext> {
  const preferredChainId = input.agent.policyConfig.allowedChains?.[0]
  const walletAddress = readWalletAddress({
    wallet: input.wallet,
    agent: input.agent,
  })
  const zerion = await loadZerionSnapshot({
    zerionClient: input.zerionClient,
    address: walletAddress,
    chainId: preferredChainId,
  })
  const recentTransactions = [...zerion.transactions]
    .sort((left, right) => parseMinedAt(right.minedAt) - parseMinedAt(left.minedAt))
    .slice(0, 5)
  const latestTransaction = recentTransactions[0]
  const totalValueUsd = zerion.positions.reduce(
    (sum, position) => sum + (Number.isFinite(position.value) ? (position.value ?? 0) : 0),
    0,
  )
  const topPositions = [...zerion.positions]
    .sort((left, right) => (right.value ?? 0) - (left.value ?? 0))
    .slice(0, 5)

  return {
    agentId: input.agent.agentId,
    agentName: input.agent.displayName,
    wallet: {
      walletId: input.agent.walletId,
      address: walletAddress || undefined,
      state: input.wallet?.state ?? input.agent.walletState,
      walletType: input.wallet?.walletType ?? input.agent.walletType,
      backend: input.agent.walletBackend,
      settlementMode: input.agent.settlementMode,
      providerId: input.wallet?.providerId,
      providerWalletId: input.wallet?.providerWalletId,
      providerWalletName:
        input.wallet?.providerWalletName ?? input.agent.owsWalletName,
      signerProfileId: input.wallet?.signerProfileId ?? input.agent.signerProfileId,
      signerHealthStatus: input.wallet?.signerHealthStatus,
      trustStatus: input.wallet?.trustStatus,
      policyAttachmentStatus: input.wallet?.policyAttachmentStatus,
      supportedChains: input.wallet?.supportedChains ?? [],
    },
    controls: {
      allowedAssets: input.agent.policyConfig.allowedAssets ?? [],
      allowedChains: input.agent.policyConfig.allowedChains ?? [],
      allowedSignerClasses: input.agent.policyConfig.allowedSignerClasses ?? [],
      allowedVendors: formatAllowedVendorLabels(input.agent),
      privacyMode: readPrivacyMode(input.agent),
    },
    portfolio: {
      sync: zerion.sync,
      totalValueUsd,
      positionsCount: zerion.positions.length,
      topPositions,
    },
    activity: {
      transactionsCount: zerion.transactions.length,
      latestTransactionAt: latestTransaction?.minedAt,
      latestTransactionChain: latestTransaction?.chainId,
      recentTransactions,
    },
    owsAccess: input.owsAccess
      ? {
          owsWalletId: input.owsAccess.owsWalletId,
          owsWalletName: input.owsAccess.owsWalletName,
          apiKeyId: input.owsAccess.apiKeyId,
          apiKeyName: input.owsAccess.apiKeyName,
        }
      : undefined,
  }
}
