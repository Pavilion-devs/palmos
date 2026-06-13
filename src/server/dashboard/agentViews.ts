import { FileWalletRegistry } from '../../../runtime/index.js'
import type { WalletRegistry } from '../../../runtime/wallets/WalletRegistry.js'
import type { ShowcaseSnapshot } from '../../projections/buildShowcaseSnapshot.js'
import {
  FileActionRequestRegistry,
  type ActionRequestRegistry,
} from '../../store/ActionRequestRegistry.js'
import {
  FileAgentRegistry,
  type AgentRecord,
  type AgentRegistry,
} from '../../store/AgentRegistry.js'
import {
  FilePaidCallRegistry,
  type PaidCallRegistry,
} from '../../store/PaidCallRegistry.js'
import {
  FileXMTPAlertRegistry,
  type XMTPAlertRegistry,
} from '../../store/XMTPAlertRegistry.js'
import type {
  PortfolioReader,
  WalletPortfolioSnapshot,
} from '../../integrations/portfolio/types.js'

export type DashboardAgentRoster = {
  generatedAt: string
  summary: ShowcaseSnapshot['summary']
  agents: Array<{
    agent: AgentRecord
  }>
}

export type DashboardAgentWalletList = {
  generatedAt: string
  agents: Array<{
    agent: AgentRecord
    portfolio: WalletPortfolioSnapshot
  }>
}

function buildDisabledSnapshot(input: {
  address: string
  chainId?: string
}): WalletPortfolioSnapshot {
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

async function loadPortfolioSnapshot(input: {
  portfolioReader?: PortfolioReader
  address: string
  chainId?: string
}): Promise<WalletPortfolioSnapshot> {
  if (!input.portfolioReader) {
    return buildDisabledSnapshot({
      address: input.address,
      chainId: input.chainId,
    })
  }

  return input.portfolioReader.getWalletSnapshot(input.address, {
    chainId: input.chainId,
  })
}

export async function buildDashboardAgentRoster(input: {
  baseDir: string
  agentRegistry?: AgentRegistry
  actionRequestRegistry?: ActionRequestRegistry
  paidCallRegistry?: PaidCallRegistry
  xmtpAlertRegistry?: XMTPAlertRegistry
}): Promise<DashboardAgentRoster> {
  const agentRegistry = input.agentRegistry ?? new FileAgentRegistry(input.baseDir)
  const actionRequestRegistry =
    input.actionRequestRegistry ?? new FileActionRequestRegistry(input.baseDir)
  const paidCallRegistry =
    input.paidCallRegistry ?? new FilePaidCallRegistry(input.baseDir)
  const xmtpAlertRegistry =
    input.xmtpAlertRegistry ?? new FileXMTPAlertRegistry(input.baseDir)
  const [agents, actionRequests, paidCalls, xmtpAlerts] = await Promise.all([
    agentRegistry.list(),
    actionRequestRegistry.list(),
    paidCallRegistry.list(),
    xmtpAlertRegistry.list(),
  ])
  const nativeActionRequests = actionRequests.filter(
    (record) => record.kind !== 'service.pay',
  )

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      agentCount: agents.length,
      executedCalls: paidCalls.filter((record) => record.status === 'executed').length,
      approvalPendingCalls:
        paidCalls.filter((record) => record.status === 'approval_pending').length +
        nativeActionRequests.filter(
          (record) => record.status === 'approval_pending',
        ).length,
      blockedOrFailedCalls:
        paidCalls.filter(
          (record) => record.status === 'blocked' || record.status === 'failed',
        ).length +
        nativeActionRequests.filter(
          (record) => record.status === 'blocked' || record.status === 'failed',
        ).length,
      staleAgents: agents.filter((agent) => agent.status === 'stale').length,
      xmtpAlertsSent: xmtpAlerts.filter((record) => record.status === 'sent').length,
      owsBackedAgents: agents.filter((agent) => agent.walletBackend === 'ows').length,
    },
    agents: agents.map((agent) => ({
      agent,
    })),
  }
}

export async function buildDashboardAgentWalletList(input: {
  baseDir: string
  portfolioReader?: PortfolioReader
  agentRegistry?: AgentRegistry
  walletRegistry?: WalletRegistry
}): Promise<DashboardAgentWalletList> {
  const agentRegistry = input.agentRegistry ?? new FileAgentRegistry(input.baseDir)
  const walletRegistry = input.walletRegistry ?? new FileWalletRegistry(input.baseDir)
  const [agents, wallets] = await Promise.all([
    agentRegistry.list(),
    walletRegistry.list(),
  ])
  const walletsById = new Map(
    wallets.map((wallet) => [wallet.walletId, wallet]),
  )

  return {
    generatedAt: new Date().toISOString(),
    agents: await Promise.all(
      agents.map(async (agent) => {
        const preferredChainId = agent.policyConfig?.allowedChains?.[0]
        const walletAddress = agent.walletId
          ? walletsById.get(agent.walletId)?.address?.trim()
          : undefined
        const portfolio = await loadPortfolioSnapshot({
          portfolioReader: input.portfolioReader,
          address: walletAddress ?? '',
          chainId: preferredChainId,
        })

        return {
          agent,
          portfolio,
        }
      }),
    ),
  }
}
