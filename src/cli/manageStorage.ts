import { FilePusdReadinessReportRegistry } from '../store/PusdReadinessReportRegistry.js'
import { FileAgentControlEventRegistry } from '../store/AgentControlEventRegistry.js'
import { FileAgentCredentialRegistry } from '../store/AgentCredentialRegistry.js'
import { FileAgentRegistry } from '../store/AgentRegistry.js'
import { FileDashboardAuditLogRegistry } from '../store/DashboardAuditLogRegistry.js'
import { FileDashboardOperatorRegistry } from '../store/DashboardOperatorRegistry.js'
import { FileDashboardWorkspaceRegistry } from '../store/DashboardWorkspaceRegistry.js'
import { FileOwsAccessRegistry } from '../store/OwsAccessRegistry.js'
import { FilePaidCallRegistry } from '../store/PaidCallRegistry.js'
import { FilePalmosServiceRegistry } from '../store/PalmosServiceRegistry.js'
import { FileXMTPAlertRegistry } from '../store/XMTPAlertRegistry.js'
import {
  readProcessEnv,
  resolveDashboardBaseDir,
} from '../server/dashboard/config.js'
import { runDashboardStorageMaintenance } from '../server/dashboard/storageMaintenance.js'
import {
  createDashboardStorageBackup,
  inspectDashboardStorageBackup,
  restoreDashboardStorageBackup,
} from '../server/dashboard/storageBackup.js'
import {
  buildDashboardStorageStatus,
  type DashboardStorageContext,
} from '../server/dashboard/storageStatus.js'

type StorageCommand = {
  action: 'status' | 'maintenance' | 'backup' | 'restore-dry-run' | 'restore'
  baseDir: string
  outputDir?: string
  archivePath?: string
  confirm: boolean
  overwriteExisting: boolean
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
): StorageCommand {
  const positional = args.filter((value) => !value.startsWith('--'))
  const action = positional[0] ?? 'status'

  if (
    action !== 'status' &&
    action !== 'maintenance' &&
    action !== 'backup' &&
    action !== 'restore-dry-run' &&
    action !== 'restore'
  ) {
    throw new Error(
      'Usage: npm run palmos:storage -- status|maintenance|backup|restore-dry-run|restore [--base-dir <path>] [--output-dir <path>] [--archive <path>] [--confirm] [--overwrite-existing]',
    )
  }

  const archivePath = readFlag(args, 'archive')?.trim()
  if ((action === 'restore-dry-run' || action === 'restore') && !archivePath) {
    throw new Error(`${action} requires --archive <path>.`)
  }

  if (action === 'restore' && !hasFlag(args, 'confirm')) {
    throw new Error('restore requires --confirm.')
  }

  return {
    action,
    baseDir: readFlag(args, 'base-dir')?.trim() || resolveDashboardBaseDir(env),
    outputDir: readFlag(args, 'output-dir')?.trim(),
    archivePath,
    confirm: hasFlag(args, 'confirm'),
    overwriteExisting: hasFlag(args, 'overwrite-existing'),
  }
}

function loadStorageContext(command: StorageCommand): DashboardStorageContext {
  const env = readProcessEnv()

  return {
    env,
    baseDir: command.baseDir,
    workspace: {
      agentRegistry: new FileAgentRegistry(command.baseDir),
      paidCallRegistry: new FilePaidCallRegistry(command.baseDir),
      agentCredentialRegistry: new FileAgentCredentialRegistry(command.baseDir),
      serviceRegistry: new FilePalmosServiceRegistry(command.baseDir),
      dashboardOperatorRegistry: new FileDashboardOperatorRegistry(command.baseDir),
      dashboardWorkspaceRegistry: new FileDashboardWorkspaceRegistry(command.baseDir),
      dashboardAuditLogRegistry: new FileDashboardAuditLogRegistry(command.baseDir),
      controlEventRegistry: new FileAgentControlEventRegistry(command.baseDir),
      xmtpAlertRegistry: new FileXMTPAlertRegistry(command.baseDir),
      owsAccessRegistry: new FileOwsAccessRegistry(command.baseDir),
    },
    pusdReadinessReports: new FilePusdReadinessReportRegistry(command.baseDir),
  }
}

async function main(): Promise<void> {
  const env = readProcessEnv()
  const command = parseCommand(process.argv.slice(2), env)
  const context = loadStorageContext(command)

  if (command.action === 'restore-dry-run') {
    const result = await inspectDashboardStorageBackup({
      archivePath: command.archivePath!,
      targetBaseDir: command.baseDir,
    })
    console.log(
      JSON.stringify(
        {
          ok: result.ok,
          baseDir: command.baseDir,
          action: command.action,
          result,
        },
        null,
        2,
      ),
    )
    if (!result.ok) {
      process.exitCode = 1
    }
    return
  }

  if (command.action === 'restore') {
    const result = await restoreDashboardStorageBackup({
      archivePath: command.archivePath!,
      targetBaseDir: command.baseDir,
      confirm: command.confirm,
      overwriteExisting: command.overwriteExisting,
    })
    console.log(
      JSON.stringify(
        {
          ok: result.ok,
          baseDir: command.baseDir,
          action: command.action,
          result,
        },
        null,
        2,
      ),
    )
    if (!result.ok) {
      process.exitCode = 1
    }
    return
  }

  if (command.action === 'backup') {
    const result = await createDashboardStorageBackup(context, {
      outputDir: command.outputDir,
    })
    console.log(
      JSON.stringify(
        {
          ok: true,
          baseDir: command.baseDir,
          action: command.action,
          result,
        },
        null,
        2,
      ),
    )
    return
  }

  if (command.action === 'maintenance') {
    const result = await runDashboardStorageMaintenance(context)
    console.log(
      JSON.stringify(
        {
          ok: true,
          baseDir: command.baseDir,
          action: command.action,
          result,
        },
        null,
        2,
      ),
    )
    return
  }

  const status = await buildDashboardStorageStatus(context)
  console.log(JSON.stringify(status, null, 2))
  if (!status.ok) {
    process.exitCode = 1
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
            : 'Unable to complete PalmOS storage command.',
      },
      null,
      2,
    ),
  )
  process.exitCode = 1
})
