import { capturePortfolioSnapshotsForWorkspace } from '../../app/capturePortfolioSnapshotsForWorkspace.js'
import type { PortfolioReader } from '../../integrations/portfolio/types.js'
import type { AgentSpendWorkspace } from '../../workspace/loadWorkspace.js'
import type { Env } from './shared.js'

const DEFAULT_INTERVAL_MS = 300_000 // 5 minutes
const MIN_INTERVAL_MS = 15_000 // floor so we never hammer the RPC
const INITIAL_DELAY_MS = 5_000 // let the server finish booting first

// Resolves the capture cadence. Empty/unset → default; <= 0 or non-numeric →
// disabled; otherwise the configured value floored to MIN_INTERVAL_MS.
export function readSnapshotIntervalMs(env: Env): number {
  const raw = env.PALMOS_PORTFOLIO_SNAPSHOT_INTERVAL_MS?.trim()
  if (!raw) {
    return DEFAULT_INTERVAL_MS
  }
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0
  }
  return Math.max(parsed, MIN_INTERVAL_MS)
}

/**
 * Periodically capture portfolio snapshots so the assets-under-control history
 * chart self-populates while the dashboard runs — no manual CLI needed. Each run
 * stamps all agents with one shared timestamp (see the capture helper) so the
 * cross-agent history sums into a single point per run.
 *
 * Defensive by design: skips entirely when disabled / no reader / no registry,
 * never overlaps runs, swallows per-run errors, and unref()s its timers so it
 * never keeps the process alive on its own.
 */
export function startPortfolioSnapshotScheduler(input: {
  workspace: AgentSpendWorkspace
  portfolioReader?: PortfolioReader
  env: Env
  log?: (message: string) => void
}): { stop: () => void } {
  const intervalMs = readSnapshotIntervalMs(input.env)
  const registry = input.workspace.portfolioSnapshotRegistry
  const reader = input.portfolioReader
  if (intervalMs <= 0 || !reader || !registry) {
    return { stop: () => {} }
  }

  let running = false
  const runOnce = async (): Promise<void> => {
    if (running) {
      return
    }
    running = true
    try {
      const summary = await capturePortfolioSnapshotsForWorkspace({
        workspace: input.workspace,
        portfolioReader: reader,
        registry,
      })
      input.log?.(
        `[snapshots] captured ${summary.captured}/${summary.checkedAgents} (failed ${summary.failed}) at ${summary.capturedAt}`,
      )
    } catch (error) {
      input.log?.(
        `[snapshots] capture run failed: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      )
    } finally {
      running = false
    }
  }

  const initialTimer = setTimeout(() => void runOnce(), INITIAL_DELAY_MS)
  const intervalTimer = setInterval(() => void runOnce(), intervalMs)
  initialTimer.unref?.()
  intervalTimer.unref?.()

  return {
    stop: () => {
      clearTimeout(initialTimer)
      clearInterval(intervalTimer)
    },
  }
}
