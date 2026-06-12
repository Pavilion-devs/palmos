import type { PortfolioReader } from '../integrations/portfolio/types.js'
import type { PortfolioSnapshotRegistry } from '../store/PortfolioSnapshotRegistry.js'
import type { AgentSpendWorkspace } from '../workspace/loadWorkspace.js'
import { capturePortfolioSnapshot } from './capturePortfolioSnapshot.js'

export type WorkspaceSnapshotCaptureResult =
  | {
      agentId: string
      outcome: 'captured'
      snapshotId: string
      syncKind: string
      totalValueUsd: number
      positionsCount: number
    }
  | {
      agentId: string
      outcome: 'failed'
      error: string
    }

export type WorkspaceSnapshotCaptureSummary = {
  capturedAt: string
  checkedAgents: number
  captured: number
  failed: number
  results: WorkspaceSnapshotCaptureResult[]
}

/**
 * Capture one portfolio snapshot per agent across the workspace.
 *
 * Every agent in a single run is stamped with ONE shared `capturedAt`. This is
 * deliberate: the cross-agent assets-under-control history endpoint groups by
 * exact `capturedAt`, so a shared timestamp collapses the run into a single
 * summed point. Without it, each agent lands on a slightly different millisecond
 * and the chart degrades into a per-agent sawtooth instead of true AUC-over-time.
 *
 * Per-agent failures (e.g. an agent with a non-Solana / demo address) are caught
 * and reported, never thrown — one bad wallet must not abort the whole run.
 */
export async function capturePortfolioSnapshotsForWorkspace(input: {
  workspace: AgentSpendWorkspace
  portfolioReader: PortfolioReader
  registry: PortfolioSnapshotRegistry
  now?: () => string
  limit?: number
}): Promise<WorkspaceSnapshotCaptureSummary> {
  const capturedAt = input.now?.() ?? new Date().toISOString()
  const agents = await input.workspace.agentRegistry.list()
  const selectedAgents =
    input.limit == null ? agents : agents.slice(0, input.limit)

  const results: WorkspaceSnapshotCaptureResult[] = []
  let captured = 0
  let failed = 0

  for (const agent of selectedAgents) {
    try {
      const wallet = agent.walletId
        ? await input.workspace.walletRegistry.get(agent.walletId)
        : undefined
      const record = await capturePortfolioSnapshot({
        agent,
        wallet,
        portfolioReader: input.portfolioReader,
        registry: input.registry,
        now: () => capturedAt,
      })

      // Stamp the funding moment once, the first time a positive balance is
      // observed. Best-effort + optimistic so a concurrent agent write is never
      // clobbered and a lost race just defers to the next capture.
      if (
        !agent.firstFundedAt &&
        Number.isFinite(record.totalValueUsd) &&
        record.totalValueUsd > 0
      ) {
        await input.workspace.agentRegistry.putIfUpdatedAt(
          {
            ...agent,
            firstFundedAt: capturedAt,
            firstFundedValueUsd: record.totalValueUsd,
            updatedAt: capturedAt,
          },
          agent.updatedAt,
        )
      }

      captured += 1
      results.push({
        agentId: agent.agentId,
        outcome: 'captured',
        snapshotId: record.snapshotId,
        syncKind: record.syncKind,
        totalValueUsd: record.totalValueUsd,
        positionsCount: record.positionsCount,
      })
    } catch (error) {
      failed += 1
      results.push({
        agentId: agent.agentId,
        outcome: 'failed',
        error:
          error instanceof Error
            ? error.message
            : 'Unable to capture portfolio snapshot.',
      })
    }
  }

  return {
    capturedAt,
    checkedAgents: selectedAgents.length,
    captured,
    failed,
    results,
  }
}
