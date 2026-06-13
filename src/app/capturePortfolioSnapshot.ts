import type { WalletRecord } from '../../runtime/contracts/wallet.js'
import type { AgentRecord } from '../store/AgentRegistry.js'
import type { PortfolioReader } from '../integrations/portfolio/types.js'
import type {
  PortfolioSnapshotRecord,
  PortfolioSnapshotRegistry,
} from '../store/PortfolioSnapshotRegistry.js'

export type CapturePortfolioSnapshotInput = {
  agent: AgentRecord
  wallet?: WalletRecord
  portfolioReader: PortfolioReader
  registry: PortfolioSnapshotRegistry
  now?: () => string
  createId?: (prefix: string) => string
}

function createSnapshotId(
  input: Pick<CapturePortfolioSnapshotInput, 'createId'>,
): string {
  return input.createId
    ? input.createId('portfolio_snapshot')
    : `portfolio_snapshot_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function nowIso(input: Pick<CapturePortfolioSnapshotInput, 'now'>): string {
  return input.now?.() ?? new Date().toISOString()
}

// Take one live portfolio read and freeze it as a persisted snapshot. This is
// purely additive: it does not change live-read behavior, it just records a
// point-in-time copy of balances/positions and their USD total so history and
// "what did this wallet hold at time T" can be reconstructed later.
export async function capturePortfolioSnapshot(
  input: CapturePortfolioSnapshotInput,
): Promise<PortfolioSnapshotRecord> {
  const preferredChainId = input.agent.policyConfig.allowedChains?.[0]
  const address = input.wallet?.address?.trim() ?? ''
  const snapshot = await input.portfolioReader.getWalletSnapshot(address, {
    chainId: preferredChainId,
  })

  // Sum only finite position values, exactly like buildDashboardAgentWalletContext.
  const totalValueUsd = snapshot.positions.reduce(
    (sum, position) =>
      sum + (Number.isFinite(position.value) ? (position.value ?? 0) : 0),
    0,
  )

  const record: PortfolioSnapshotRecord = {
    snapshotId: createSnapshotId(input),
    agentId: input.agent.agentId,
    walletId: input.agent.walletId,
    address: snapshot.address,
    chainId: preferredChainId,
    capturedAt: nowIso(input),
    totalValueUsd,
    valuationComplete: snapshot.valuationComplete !== false,
    positionsCount: snapshot.positions.length,
    positions: snapshot.positions.map((position) => ({
      symbol: position.symbol,
      chainId: position.chainId,
      quantity: position.quantity,
      value: position.value,
    })),
    syncKind: snapshot.sync.kind,
    syncMessage: snapshot.sync.message,
  }

  await input.registry.put(record)
  return record
}
