import type { DashboardStorageContext } from './storageStatus.js'

const DAY_MS = 24 * 60 * 60 * 1000

function readPositiveInteger(
  value: string | undefined,
  fallback: number,
): number {
  const parsed = Number(value?.trim())
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback
}

function readOptionalAgeMs(
  value: string | undefined,
  fallbackDays: number,
): number {
  const parsed = Number(value?.trim())
  const days = Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackDays
  return Math.round(days * DAY_MS)
}

export async function runDashboardStorageMaintenance(
  context: DashboardStorageContext,
) {
  const audit = await context.workspace.dashboardAuditLogRegistry.prune({
    maxRecords: readPositiveInteger(
      context.env.PALMOS_AUDIT_RETENTION_MAX,
      1_000,
    ),
    maxAgeMs: readOptionalAgeMs(context.env.PALMOS_AUDIT_RETENTION_DAYS, 90),
  })
  const pusdReadiness = await context.pusdReadinessReports.prune({
    maxRecords: readPositiveInteger(
      context.env.PALMOS_READINESS_RETENTION_MAX,
      200,
    ),
    maxAgeMs: readOptionalAgeMs(
      context.env.PALMOS_READINESS_RETENTION_DAYS,
      30,
    ),
  })

  return {
    audit,
    pusdReadiness,
  }
}
