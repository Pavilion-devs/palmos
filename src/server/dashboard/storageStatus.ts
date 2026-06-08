import { readFile, readdir } from 'fs/promises'
import { join, relative } from 'path'
import type { AgentRegistry } from '../../store/AgentRegistry.js'
import type { AgentCredentialRegistry } from '../../store/AgentCredentialRegistry.js'
import type { AgentControlEventRegistry } from '../../store/AgentControlEventRegistry.js'
import type { DashboardAuditLogRegistry } from '../../store/DashboardAuditLogRegistry.js'
import type { DashboardOperatorRegistry } from '../../store/DashboardOperatorRegistry.js'
import type { DashboardWorkspaceRegistry } from '../../store/DashboardWorkspaceRegistry.js'
import type { OwsAccessRegistry } from '../../store/OwsAccessRegistry.js'
import type { PaidCallRegistry } from '../../store/PaidCallRegistry.js'
import type { PalmosServiceRegistry } from '../../store/PalmosServiceRegistry.js'
import type { XMTPAlertRegistry } from '../../store/XMTPAlertRegistry.js'
import type { PusdReadinessReportRegistry } from '../../store/PusdReadinessReportRegistry.js'
import type { Env } from './shared.js'

const DAY_MS = 24 * 60 * 60 * 1000

export type DashboardStorageWorkspace = {
  storageDriver?: 'file' | 'postgres'
  agentRegistry: AgentRegistry
  paidCallRegistry: PaidCallRegistry
  agentCredentialRegistry: AgentCredentialRegistry
  serviceRegistry: PalmosServiceRegistry
  dashboardOperatorRegistry: DashboardOperatorRegistry
  dashboardWorkspaceRegistry: DashboardWorkspaceRegistry
  dashboardAuditLogRegistry: DashboardAuditLogRegistry
  controlEventRegistry: AgentControlEventRegistry
  xmtpAlertRegistry: XMTPAlertRegistry
  owsAccessRegistry: OwsAccessRegistry
}

export type DashboardStorageContext = {
  env: Env
  baseDir: string
  workspace: DashboardStorageWorkspace
  pusdReadinessReports: PusdReadinessReportRegistry
}

type JsonFileHealth = {
  jsonFiles: number
  backupFiles: number
  tempFiles: number
  corruptedPrimaryFiles: string[]
  backupRecoveredFiles: string[]
}

function readPositiveInteger(
  value: string | undefined,
  fallback: number,
): number {
  const parsed = Number(value?.trim())
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback
}

function readPositiveDays(value: string | undefined, fallback: number): number {
  const parsed = Number(value?.trim())
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

async function canParseJsonFile(path: string): Promise<boolean> {
  try {
    JSON.parse(await readFile(path, 'utf8'))
    return true
  } catch {
    return false
  }
}

export async function scanDashboardJsonHealth(
  baseDir: string,
): Promise<JsonFileHealth> {
  const health: JsonFileHealth = {
    jsonFiles: 0,
    backupFiles: 0,
    tempFiles: 0,
    corruptedPrimaryFiles: [],
    backupRecoveredFiles: [],
  }

  async function visit(dir: string): Promise<void> {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        return
      }
      throw error
    }

    for (const entry of entries) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        await visit(path)
        continue
      }

      if (!entry.isFile()) {
        continue
      }

      if (entry.name.endsWith('.tmp')) {
        health.tempFiles += 1
        continue
      }

      if (entry.name.endsWith('.json.bak')) {
        health.backupFiles += 1
        continue
      }

      if (!entry.name.endsWith('.json')) {
        continue
      }

      health.jsonFiles += 1
      if (await canParseJsonFile(path)) {
        continue
      }

      const relativePath = relative(baseDir, path)
      health.corruptedPrimaryFiles.push(relativePath)
      if (await canParseJsonFile(`${path}.bak`)) {
        health.backupRecoveredFiles.push(relativePath)
      }
    }
  }

  await visit(baseDir)
  health.corruptedPrimaryFiles.sort()
  health.backupRecoveredFiles.sort()
  return health
}

export async function buildDashboardStorageStatus(
  context: DashboardStorageContext,
) {
  const [
    agents,
    paidCalls,
    credentials,
    services,
    operators,
    workspaces,
    audit,
    readiness,
    controlEvents,
    xmtpAlerts,
    owsAccess,
    jsonHealth,
  ] = await Promise.all([
    context.workspace.agentRegistry.list(),
    context.workspace.paidCallRegistry.list(),
    context.workspace.agentCredentialRegistry.list(),
    context.workspace.serviceRegistry.list(),
    context.workspace.dashboardOperatorRegistry.list(),
    context.workspace.dashboardWorkspaceRegistry.list(),
    context.workspace.dashboardAuditLogRegistry.list(),
    context.pusdReadinessReports.list(),
    context.workspace.controlEventRegistry.list(),
    context.workspace.xmtpAlertRegistry.list(),
    context.workspace.owsAccessRegistry.list(),
    scanDashboardJsonHealth(context.baseDir),
  ])

  const auditRetentionDays = readPositiveDays(
    context.env.PALMOS_AUDIT_RETENTION_DAYS,
    90,
  )
  const readinessRetentionDays = readPositiveDays(
    context.env.PALMOS_READINESS_RETENTION_DAYS,
    30,
  )

  return {
    ok: jsonHealth.corruptedPrimaryFiles.length === 0,
    baseDir: context.baseDir,
    storageEngine: context.workspace.storageDriver ?? 'file',
    counts: {
      agents: agents.length,
      paidCalls: paidCalls.length,
      credentials: credentials.length,
      services: services.length,
      operators: operators.length,
      workspaces: workspaces.length,
      audit: audit.length,
      pusdReadinessReports: readiness.length,
      controlEvents: controlEvents.length,
      xmtpAlerts: xmtpAlerts.length,
      owsAccess: owsAccess.length,
    },
    retention: {
      audit: {
        maxRecords: readPositiveInteger(
          context.env.PALMOS_AUDIT_RETENTION_MAX,
          1_000,
        ),
        maxAgeDays: auditRetentionDays,
        maxAgeMs: Math.round(auditRetentionDays * DAY_MS),
      },
      pusdReadiness: {
        maxRecords: readPositiveInteger(
          context.env.PALMOS_READINESS_RETENTION_MAX,
          200,
        ),
        maxAgeDays: readinessRetentionDays,
        maxAgeMs: Math.round(readinessRetentionDays * DAY_MS),
      },
    },
    files: jsonHealth,
  }
}
