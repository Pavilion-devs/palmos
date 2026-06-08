import { FilePaidCallRegistry } from '../store/PaidCallRegistry.js'
import {
  createSolanaSettlementVerifier,
  reconcilePaidCallSettlements,
} from '../app/reconcileSettlements.js'
import {
  readProcessEnv,
  resolveDashboardBaseDir,
} from '../server/dashboard/config.js'

type Command = {
  baseDir: string
  verifySolana: boolean
  dryRun: boolean
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

function parseCommand(
  args: string[],
  env: Record<string, string | undefined>,
): Command {
  return {
    baseDir: readFlag(args, 'base-dir')?.trim() || resolveDashboardBaseDir(env),
    verifySolana: hasFlag(args, 'verify-solana'),
    dryRun: hasFlag(args, 'dry-run'),
  }
}

async function main(): Promise<void> {
  const env = readProcessEnv()
  const command = parseCommand(process.argv.slice(2), env)
  const registry = new FilePaidCallRegistry(command.baseDir)
  const verifier = command.verifySolana
    ? createSolanaSettlementVerifier({ env })
    : undefined

  const result = await reconcilePaidCallSettlements({
    registry: command.dryRun
      ? {
          get: (executionId) => registry.get(executionId),
          list: () => registry.list(),
          remove: (executionId) => registry.remove(executionId),
          put: async () => undefined,
          putIfStatus: async () => false,
        }
      : registry,
    verifier,
  })

  console.log(
    JSON.stringify(
      {
        ok: true,
        baseDir: command.baseDir,
        dryRun: command.dryRun,
        verifySolana: command.verifySolana,
        checked: result.checked,
        changed: result.changed,
        skipped: result.skipped,
        results: result.results.map((item) => ({
          executionId: item.executionId,
          changed: item.changed,
          skipped: item.skipped,
          reason: item.reason,
          confirmationStatus: item.record.settlement?.confirmationStatus,
          reconciliationStatus: item.record.settlement?.reconciliationStatus,
          reconciledAt: item.record.settlement?.reconciledAt,
          error: item.record.settlement?.reconciliationError,
        })),
      },
      null,
      2,
    ),
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
