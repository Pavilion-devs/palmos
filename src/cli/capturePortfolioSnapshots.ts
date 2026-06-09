import { loadAgentSpendWorkspace } from '../workspace/loadWorkspace.js'
import { capturePortfolioSnapshot } from '../app/capturePortfolioSnapshot.js'
import { SolanaPortfolioReader } from '../integrations/portfolio/solanaPortfolioReader.js'
import {
  InMemoryPortfolioSnapshotRegistry,
  type PortfolioSnapshotRegistry,
} from '../store/PortfolioSnapshotRegistry.js'
import {
  readProcessEnv,
  resolveDashboardBaseDir,
} from '../server/dashboard/config.js'

type Command = {
  baseDir: string
  dryRun: boolean
  limit?: number
}

type CaptureResult =
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

function readFlag(args: string[], name: string): string | undefined {
  const exact = `--${name}`
  const prefixed = `--${name}=`
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index]
    if (!value) {
      continue
    }

    if (value === exact) {
      return args[index + 1]
    }

    if (value.startsWith(prefixed)) {
      return value.slice(prefixed.length)
    }
  }

  return undefined
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(`--${name}`)
}

function parseOptionalPositiveInt(value: string | undefined): number | undefined {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined
  }
  return Math.round(parsed)
}

function parseCommand(
  args: string[],
  env: Record<string, string | undefined>,
): Command {
  return {
    baseDir: readFlag(args, 'base-dir')?.trim() || resolveDashboardBaseDir(env),
    dryRun: hasFlag(args, 'dry-run'),
    limit: parseOptionalPositiveInt(readFlag(args, 'limit')),
  }
}

async function main(): Promise<void> {
  const env = readProcessEnv()
  const command = parseCommand(process.argv.slice(2), env)
  const workspace = loadAgentSpendWorkspace({
    baseDir: command.baseDir,
    env,
  })

  try {
    if (!workspace.portfolioSnapshotRegistry) {
      throw new Error(
        'PortfolioSnapshot registry is not available in this workspace.',
      )
    }

    const portfolioReader = SolanaPortfolioReader.fromEnv(env)
    // In dry-run, read + map but do not touch durable storage.
    const registry: PortfolioSnapshotRegistry = command.dryRun
      ? new InMemoryPortfolioSnapshotRegistry()
      : workspace.portfolioSnapshotRegistry

    const agents = await workspace.agentRegistry.list()
    const selectedAgents =
      command.limit == null ? agents : agents.slice(0, command.limit)

    const results: CaptureResult[] = []
    let captured = 0
    let failed = 0

    for (const agent of selectedAgents) {
      try {
        const wallet = agent.walletId
          ? await workspace.walletRegistry.get(agent.walletId)
          : undefined
        const record = await capturePortfolioSnapshot({
          agent,
          wallet,
          portfolioReader,
          registry,
        })
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

    console.log(
      JSON.stringify(
        {
          ok: true,
          baseDir: command.baseDir,
          storageDriver: workspace.storageDriver,
          dryRun: command.dryRun,
          limit: command.limit,
          checkedAgents: selectedAgents.length,
          captured,
          failed,
          results,
        },
        null,
        2,
      ),
    )
  } finally {
    await workspace.postgresPool?.end()
  }
}

void main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'Unable to capture portfolio snapshots.',
      },
      null,
      2,
    ),
  )
  process.exitCode = 1
})
