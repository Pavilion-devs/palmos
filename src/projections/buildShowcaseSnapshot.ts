import { mkdir } from 'fs/promises'
import { join } from 'path'
import { FileWalletRegistry } from '../../runtime/index.js'
import type { WalletRegistry } from '../../runtime/wallets/WalletRegistry.js'
import { writeJsonFile } from '../../runtime/runtime/jsonFile.js'
import {
  FileActionRequestRegistry,
  type ActionRequestRecord,
  type ActionRequestRegistry,
} from '../store/ActionRequestRegistry.js'
import {
  FileAgentRegistry,
  type AgentRecord,
  type AgentRegistry,
} from '../store/AgentRegistry.js'
import {
  FileAgentControlEventRegistry,
  type AgentControlEventRegistry,
} from '../store/AgentControlEventRegistry.js'
import {
  FilePaidCallRegistry,
  type PaidCallRecord,
  type PaidCallRegistry,
} from '../store/PaidCallRegistry.js'
import {
  FileXMTPAlertRegistry,
  type XMTPAlertRecord,
  type XMTPAlertRegistry,
} from '../store/XMTPAlertRegistry.js'
import {
  FilePusdReadinessReportRegistry,
  type PusdReadinessReportRecord,
  type PusdReadinessReportRegistry,
} from '../store/PusdReadinessReportRegistry.js'
import {
  FileOwsAccessRegistry,
  type OwsAccessRecord,
  type OwsAccessRegistry,
} from '../store/OwsAccessRegistry.js'
import { buildAgentAuditSnapshot } from '../audit/buildAgentAuditSnapshot.js'
import type {
  PortfolioReader,
  WalletPortfolioSnapshot,
} from '../integrations/portfolio/types.js'

export type SafeOwsAccessRecord = Omit<OwsAccessRecord, 'apiKeyToken'>

export type ShowcaseSnapshot = {
  generatedAt: string
  baseDir: string
  headline: string
  summary: {
    agentCount: number
    executedCalls: number
    approvalPendingCalls: number
    blockedOrFailedCalls: number
    staleAgents: number
    xmtpAlertsSent: number
    owsBackedAgents: number
  }
  pusdReadiness?: {
    latest?: PusdReadinessReportRecord
    recent: PusdReadinessReportRecord[]
  }
  agents: Array<{
    agent: AgentRecord
    paidCalls: PaidCallRecord[]
    actionRequests: ActionRequestRecord[]
    xmtpAlerts: XMTPAlertRecord[]
    owsAccess?: SafeOwsAccessRecord
    audit: Awaited<ReturnType<typeof buildAgentAuditSnapshot>>
    portfolio?: WalletPortfolioSnapshot
  }>
}

export async function buildShowcaseSnapshot(input: {
  baseDir: string
  portfolioReader?: PortfolioReader
  agentRegistry?: AgentRegistry
  walletRegistry?: WalletRegistry
  actionRequestRegistry?: ActionRequestRegistry
  paidCallRegistry?: PaidCallRegistry
  controlEventRegistry?: AgentControlEventRegistry
  xmtpAlertRegistry?: XMTPAlertRegistry
  owsAccessRegistry?: OwsAccessRegistry
  pusdReadinessRegistry?: PusdReadinessReportRegistry
}): Promise<ShowcaseSnapshot> {
  const agentRegistry = input.agentRegistry ?? new FileAgentRegistry(input.baseDir)
  const walletRegistry = input.walletRegistry ?? new FileWalletRegistry(input.baseDir)
  const actionRequestRegistry =
    input.actionRequestRegistry ?? new FileActionRequestRegistry(input.baseDir)
  const paidCallRegistry =
    input.paidCallRegistry ?? new FilePaidCallRegistry(input.baseDir)
  const controlEventRegistry =
    input.controlEventRegistry ?? new FileAgentControlEventRegistry(input.baseDir)
  const xmtpAlertRegistry =
    input.xmtpAlertRegistry ?? new FileXMTPAlertRegistry(input.baseDir)
  const owsAccessRegistry =
    input.owsAccessRegistry ?? new FileOwsAccessRegistry(input.baseDir)
  const pusdReadinessRegistry =
    input.pusdReadinessRegistry ??
    new FilePusdReadinessReportRegistry(input.baseDir)
  const [agents, wallets, actionRequests, paidCalls, controlEvents, xmtpAlerts, owsAccess] = await Promise.all([
    agentRegistry.list(),
    walletRegistry.list(),
    actionRequestRegistry.list(),
    paidCallRegistry.list(),
    controlEventRegistry.list(),
    xmtpAlertRegistry.list(),
    owsAccessRegistry.list(),
  ])
  const readinessReports = await pusdReadinessRegistry.list()
  const walletsById = new Map(
    wallets.map((wallet) => [wallet.walletId, wallet]),
  )
  const nativeActionRequests = actionRequests.filter(
    (record) => record.kind !== 'service.pay',
  )

  const agentSnapshots = await Promise.all(
    agents.map(async (agent) => {
      const audit = await buildAgentAuditSnapshot({
        baseDir: input.baseDir,
        agentId: agent.agentId,
        agentRegistry,
        controlEventRegistry,
        paidCallRegistry,
        xmtpAlertRegistry,
      })
      const preferredChainId = agent.policyConfig?.allowedChains?.[0]
      const walletAddress = agent.walletId
        ? walletsById.get(agent.walletId)?.address?.trim()
        : undefined
      const portfolio: WalletPortfolioSnapshot | undefined = input.portfolioReader
        ? await input.portfolioReader.getWalletSnapshot(walletAddress ?? '', {
            chainId: preferredChainId,
          })
        : {
            address: walletAddress ?? '',
            positions: [],
            transactions: [],
            sync: {
              kind: 'disabled',
              chainId: preferredChainId,
              message: 'Portfolio enrichment is not configured on the backend.',
            },
          }
      const owsAccessRecord = owsAccess.find((record) => record.agentId === agent.agentId)
      return {
        agent,
        paidCalls: paidCalls.filter((record) => record.agentId === agent.agentId),
        actionRequests: nativeActionRequests.filter(
          (record) => record.agentId === agent.agentId,
        ),
        xmtpAlerts: xmtpAlerts.filter((record) => record.agentId === agent.agentId),
        owsAccess: owsAccessRecord
          ? {
              agentId: owsAccessRecord.agentId,
              createdAt: owsAccessRecord.createdAt,
              updatedAt: owsAccessRecord.updatedAt,
              runtimeWalletId: owsAccessRecord.runtimeWalletId,
              owsWalletId: owsAccessRecord.owsWalletId,
              owsWalletName: owsAccessRecord.owsWalletName,
              vaultPath: owsAccessRecord.vaultPath,
              apiKeyId: owsAccessRecord.apiKeyId,
              apiKeyName: owsAccessRecord.apiKeyName,
            }
          : undefined,
        audit,
        portfolio,
      }
    }),
  )

  return {
    generatedAt: new Date().toISOString(),
    baseDir: input.baseDir,
    headline: 'Give agents wallets, not blank checks.',
    summary: {
      agentCount: agents.length,
      executedCalls: paidCalls.filter((record) => record.status === 'executed').length,
      approvalPendingCalls:
        paidCalls.filter((record) => record.status === 'approval_pending').length +
        nativeActionRequests.filter(
          (record) => record.status === 'approval_pending',
        ).length,
      blockedOrFailedCalls: paidCalls.filter((record) =>
        record.status === 'blocked' || record.status === 'failed',
      ).length + nativeActionRequests.filter((record) =>
        record.status === 'blocked' || record.status === 'failed',
      ).length,
      staleAgents: agents.filter((agent) => agent.status === 'stale').length,
      xmtpAlertsSent: xmtpAlerts.filter((record) => record.status === 'sent').length,
      owsBackedAgents: agents.filter((agent) => agent.walletBackend === 'ows').length,
    },
    pusdReadiness: {
      latest: readinessReports[0],
      recent: readinessReports.slice(0, 10),
    },
    agents: agentSnapshots,
  }
}

export async function writeShowcaseSnapshot(input: {
  baseDir: string
  snapshot: ShowcaseSnapshot
}): Promise<string> {
  const outputDir = join(input.baseDir, 'dashboard')
  await mkdir(outputDir, { recursive: true })
  const outputPath = join(outputDir, 'showcase-snapshot.json')
  await writeJsonFile(outputPath, input.snapshot)
  return outputPath
}
