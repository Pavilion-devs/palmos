import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { FileWalletRegistry } from '../../runtime/index.js'
import {
  FileAgentRegistry,
  type AgentRecord,
} from '../store/AgentRegistry.js'
import {
  FileAgentControlEventRegistry,
} from '../store/AgentControlEventRegistry.js'
import {
  FilePaidCallRegistry,
  type PaidCallRecord,
} from '../store/PaidCallRegistry.js'
import {
  FileXMTPAlertRegistry,
  type XMTPAlertRecord,
} from '../store/XMTPAlertRegistry.js'
import { FileOwsAccessRegistry, type OwsAccessRecord } from '../store/OwsAccessRegistry.js'
import { buildAgentAuditSnapshot } from '../audit/buildAgentAuditSnapshot.js'
import type { ZerionClient, ZerionWalletSnapshot } from '../integrations/zerion/client.js'

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
  agents: Array<{
    agent: AgentRecord
    paidCalls: PaidCallRecord[]
    xmtpAlerts: XMTPAlertRecord[]
    owsAccess?: SafeOwsAccessRecord
    audit: Awaited<ReturnType<typeof buildAgentAuditSnapshot>>
    zerion?: ZerionWalletSnapshot
  }>
}

export async function buildShowcaseSnapshot(input: {
  baseDir: string
  zerionClient?: ZerionClient
}): Promise<ShowcaseSnapshot> {
  const agentRegistry = new FileAgentRegistry(input.baseDir)
  const walletRegistry = new FileWalletRegistry(input.baseDir)
  const paidCallRegistry = new FilePaidCallRegistry(input.baseDir)
  const controlEventRegistry = new FileAgentControlEventRegistry(input.baseDir)
  const xmtpAlertRegistry = new FileXMTPAlertRegistry(input.baseDir)
  const owsAccessRegistry = new FileOwsAccessRegistry(input.baseDir)
  const [agents, wallets, paidCalls, controlEvents, xmtpAlerts, owsAccess] = await Promise.all([
    agentRegistry.list(),
    walletRegistry.list(),
    paidCallRegistry.list(),
    controlEventRegistry.list(),
    xmtpAlertRegistry.list(),
    owsAccessRegistry.list(),
  ])
  const walletsById = new Map(
    wallets.map((wallet) => [wallet.walletId, wallet]),
  )

  const agentSnapshots = await Promise.all(
    agents.map(async (agent) => {
      const audit = await buildAgentAuditSnapshot({
        baseDir: input.baseDir,
        agentId: agent.agentId,
      })
      const preferredChainId = agent.policyConfig?.allowedChains?.[0]
      const walletAddress = agent.walletId
        ? walletsById.get(agent.walletId)?.address?.trim()
        : undefined
      const zerion: ZerionWalletSnapshot | undefined = input.zerionClient
        ? await input.zerionClient.getWalletSnapshot(walletAddress ?? '', {
            chainId: preferredChainId,
          })
        : {
            address: walletAddress ?? '',
            positions: [],
            transactions: [],
            sync: {
              kind: 'disabled',
              chainId: preferredChainId,
              message: 'Zerion enrichment is not configured on the backend.',
            },
          }
      const owsAccessRecord = owsAccess.find((record) => record.agentId === agent.agentId)
      return {
        agent,
        paidCalls: paidCalls.filter((record) => record.agentId === agent.agentId),
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
        zerion,
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
      approvalPendingCalls: paidCalls.filter((record) => record.status === 'approval_pending').length,
      blockedOrFailedCalls: paidCalls.filter((record) =>
        record.status === 'blocked' || record.status === 'failed',
      ).length,
      staleAgents: agents.filter((agent) => agent.status === 'stale').length,
      xmtpAlertsSent: xmtpAlerts.filter((record) => record.status === 'sent').length,
      owsBackedAgents: agents.filter((agent) => agent.walletBackend === 'ows').length,
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
  await writeFile(outputPath, JSON.stringify(input.snapshot, null, 2), 'utf8')
  return outputPath
}
