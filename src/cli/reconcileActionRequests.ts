import { loadAgentSpendWorkspace } from '../workspace/loadWorkspace.js'
import { reconcilePaidCallActionRequests } from '../app/reconcileActionRequests.js'
import {
  readProcessEnv,
  resolveDashboardBaseDir,
} from '../server/dashboard/config.js'

type Command = {
  baseDir: string
  dryRun: boolean
  keepOrphans: boolean
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
    dryRun: hasFlag(args, 'dry-run'),
    keepOrphans: hasFlag(args, 'keep-orphans'),
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
    if (!workspace.actionRequestRegistry) {
      throw new Error('ActionRequest registry is not available in this workspace.')
    }

    const result = await reconcilePaidCallActionRequests({
      paidCalls: workspace.paidCallRegistry,
      actionRequests: workspace.actionRequestRegistry,
      dryRun: command.dryRun,
      removeOrphanMirrors: !command.keepOrphans,
    })

    console.log(
      JSON.stringify(
        {
          ok: true,
          baseDir: command.baseDir,
          storageDriver: workspace.storageDriver,
          dryRun: command.dryRun,
          keepOrphans: command.keepOrphans,
          ...result,
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
            : 'Unable to reconcile ActionRequest shadow records.',
      },
      null,
      2,
    ),
  )
  process.exitCode = 1
})
