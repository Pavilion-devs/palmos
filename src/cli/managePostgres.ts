import { FileRunRegistry, FileSessionRegistry, FileWalletRegistry } from '../../runtime/index.js'
import { FileAgentControlEventRegistry } from '../store/AgentControlEventRegistry.js'
import { FileAgentCredentialRegistry } from '../store/AgentCredentialRegistry.js'
import { FileAgentRegistry } from '../store/AgentRegistry.js'
import { FileDashboardAuditLogRegistry } from '../store/DashboardAuditLogRegistry.js'
import { FileDashboardOperatorRegistry } from '../store/DashboardOperatorRegistry.js'
import { FileDashboardWorkspaceRegistry } from '../store/DashboardWorkspaceRegistry.js'
import { FileOwsAccessRegistry } from '../store/OwsAccessRegistry.js'
import { FilePaidCallRegistry } from '../store/PaidCallRegistry.js'
import { FilePalmosServiceRegistry } from '../store/PalmosServiceRegistry.js'
import { FilePusdReadinessReportRegistry } from '../store/PusdReadinessReportRegistry.js'
import { FileXMTPAlertRegistry } from '../store/XMTPAlertRegistry.js'
import {
  createPostgresPool,
  listPalmosPostgresMigrations,
  runPalmosPostgresMigrations,
  verifyPostgresConnection,
} from '../storage/postgres/client.js'
import {
  PostgresAgentControlEventRegistry,
  PostgresAgentCredentialRegistry,
  PostgresAgentRegistry,
  PostgresDashboardAuditLogRegistry,
  PostgresDashboardOperatorRegistry,
  PostgresDashboardWorkspaceRegistry,
  PostgresOwsAccessRegistry,
  PostgresPaidCallRegistry,
  PostgresPalmosServiceRegistry,
  PostgresPusdReadinessReportRegistry,
  PostgresRunRegistry,
  PostgresSessionRegistry,
  PostgresWalletRegistry,
  PostgresXMTPAlertRegistry,
} from '../storage/postgres/registries.js'

type Command = 'verify' | 'migrate' | 'import-file'

function readCommand(): Command {
  const command = process.argv[2]
  if (
    command === 'verify' ||
    command === 'migrate' ||
    command === 'import-file'
  ) {
    return command
  }
  throw new Error('Usage: npm run palmos:postgres -- verify|migrate|import-file')
}

function readBaseDir(): string {
  const fromFlag = process.argv.find((arg) => arg.startsWith('--base-dir='))
  return (
    fromFlag?.slice('--base-dir='.length).trim() ||
    process.env.AGENT_SPEND_OS_BASE_DIR?.trim() ||
    '/tmp/palmos-live'
  )
}

async function importFileWorkspace(input: {
  baseDir: string
  pool: ReturnType<typeof createPostgresPool>
}): Promise<Record<string, number>> {
  const fileAgents = new FileAgentRegistry(input.baseDir)
  const fileWallets = new FileWalletRegistry(input.baseDir)
  const fileCredentials = new FileAgentCredentialRegistry(input.baseDir)
  const fileServices = new FilePalmosServiceRegistry(input.baseDir)
  const filePaidCalls = new FilePaidCallRegistry(input.baseDir)
  const fileAudit = new FileDashboardAuditLogRegistry(input.baseDir)
  const fileOperators = new FileDashboardOperatorRegistry(input.baseDir)
  const fileWorkspaces = new FileDashboardWorkspaceRegistry(input.baseDir)
  const fileControlEvents = new FileAgentControlEventRegistry(input.baseDir)
  const fileXmtpAlerts = new FileXMTPAlertRegistry(input.baseDir)
  const fileOwsAccess = new FileOwsAccessRegistry(input.baseDir)
  const fileReadiness = new FilePusdReadinessReportRegistry(input.baseDir)
  const fileSessions = new FileSessionRegistry(input.baseDir)
  const fileRuns = new FileRunRegistry(input.baseDir)

  const pgAgents = new PostgresAgentRegistry(input.pool)
  const pgWallets = new PostgresWalletRegistry(input.pool)
  const pgCredentials = new PostgresAgentCredentialRegistry(input.pool)
  const pgServices = new PostgresPalmosServiceRegistry(input.pool)
  const pgPaidCalls = new PostgresPaidCallRegistry(input.pool)
  const pgAudit = new PostgresDashboardAuditLogRegistry(input.pool)
  const pgOperators = new PostgresDashboardOperatorRegistry(input.pool)
  const pgWorkspaces = new PostgresDashboardWorkspaceRegistry(input.pool)
  const pgControlEvents = new PostgresAgentControlEventRegistry(input.pool)
  const pgXmtpAlerts = new PostgresXMTPAlertRegistry(input.pool)
  const pgOwsAccess = new PostgresOwsAccessRegistry(input.pool)
  const pgReadiness = new PostgresPusdReadinessReportRegistry(input.pool)
  const pgSessions = new PostgresSessionRegistry(input.pool)
  const pgRuns = new PostgresRunRegistry(input.pool)

  const counts: Record<string, number> = {}

  const workspaces = await fileWorkspaces.list()
  for (const record of workspaces) await pgWorkspaces.put(record)
  counts.workspaces = workspaces.length

  const operators = await fileOperators.list()
  for (const record of operators) await pgOperators.put(record)
  counts.operators = operators.length

  const wallets = await fileWallets.list()
  for (const record of wallets) await pgWallets.put(record)
  counts.wallets = wallets.length

  const agents = await fileAgents.list()
  for (const record of agents) await pgAgents.put(record)
  counts.agents = agents.length

  const credentials = await fileCredentials.list()
  for (const record of credentials) await pgCredentials.put(record)
  counts.credentials = credentials.length

  const services = await fileServices.list()
  for (const record of services) await pgServices.put(record)
  counts.services = services.length

  const paidCalls = await filePaidCalls.list()
  for (const record of paidCalls) await pgPaidCalls.put(record)
  counts.paidCalls = paidCalls.length

  const audit = await fileAudit.list()
  for (const record of audit) await pgAudit.put(record)
  counts.audit = audit.length

  const controlEvents = await fileControlEvents.list()
  for (const record of controlEvents) await pgControlEvents.put(record)
  counts.controlEvents = controlEvents.length

  const xmtpAlerts = await fileXmtpAlerts.list()
  for (const record of xmtpAlerts) await pgXmtpAlerts.put(record)
  counts.xmtpAlerts = xmtpAlerts.length

  const owsAccess = await fileOwsAccess.list()
  for (const record of owsAccess) await pgOwsAccess.put(record)
  counts.owsAccess = owsAccess.length

  const readiness = await fileReadiness.list()
  for (const record of readiness) await pgReadiness.put(record)
  counts.readinessReports = readiness.length

  const sessions = await fileSessions.list()
  for (const record of sessions) await pgSessions.put(record)
  counts.sessions = sessions.length

  let runCount = 0
  for (const session of sessions) {
    for (const runId of session.runIds) {
      const run = await fileRuns.get(runId)
      if (run) {
        await pgRuns.put(run)
        runCount += 1
      }
    }
  }
  counts.runs = runCount

  return counts
}

async function main(): Promise<void> {
  const command = readCommand()
  const baseDir = readBaseDir()
  const pool = createPostgresPool()

  try {
    await verifyPostgresConnection(pool)

    if (command === 'verify') {
      console.log(
        JSON.stringify(
          {
            ok: true,
            command,
            migrations: await listPalmosPostgresMigrations(pool),
          },
          null,
          2,
        ),
      )
      return
    }

    const migration = await runPalmosPostgresMigrations(pool)

    if (command === 'migrate') {
      console.log(JSON.stringify({ ok: true, command, migration }, null, 2))
      return
    }

    const imported = await importFileWorkspace({ baseDir, pool })
    console.log(
      JSON.stringify(
        {
          ok: true,
          command,
          baseDir,
          migration,
          imported,
        },
        null,
        2,
      ),
    )
  } finally {
    await pool.end()
  }
}

void main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : 'Postgres management failed.',
  )
  process.exit(1)
})
