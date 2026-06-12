import { loadAgentSpendWorkspace } from '../workspace/loadWorkspace.js'
import { capturePortfolioSnapshotsForWorkspace } from '../app/capturePortfolioSnapshotsForWorkspace.js'
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

    const summary = await capturePortfolioSnapshotsForWorkspace({
      workspace,
      portfolioReader,
      registry,
      limit: command.limit,
    })

    console.log(
      JSON.stringify(
        {
          ok: true,
          baseDir: command.baseDir,
          storageDriver: workspace.storageDriver,
          dryRun: command.dryRun,
          limit: command.limit,
          capturedAt: summary.capturedAt,
          checkedAgents: summary.checkedAgents,
          captured: summary.captured,
          failed: summary.failed,
          results: summary.results,
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
