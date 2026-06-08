import { readFile } from 'fs/promises'
import { join } from 'path'
import { PublicKey } from '@solana/web3.js'
import {
  readPusdMintFromEnv,
  readSolanaRpcUrlFromEnv,
} from '../../integrations/pusd/constants.js'
import { PALMOS_POSTGRES_MIGRATION_VERSION } from '../../storage/postgres/schema.js'
import type { DashboardRouteContext } from './context.js'
import type { Env } from './shared.js'
import { buildDashboardStorageStatus } from './storageStatus.js'

export type DashboardSystemHealthStatus = 'passed' | 'warning' | 'failed'

export type DashboardSystemHealthCheck = {
  checkId: string
  status: DashboardSystemHealthStatus
  summary: string
  details?: Record<string, unknown>
}

export type DashboardSystemHealthReport = {
  ok: boolean
  generatedAt: string
  checks: DashboardSystemHealthCheck[]
}

function booleanEnv(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase()
  return normalized === '1' || normalized === 'true'
}

function readPositiveNumber(
  value: string | undefined,
  fallback: number,
): number {
  const parsed = Number(value?.trim())
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function isValidUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function isValidPublicKey(value: string): boolean {
  try {
    new PublicKey(value)
    return true
  } catch {
    return false
  }
}

export function buildPusdConfigHealthChecks(
  env: Env,
): DashboardSystemHealthCheck[] {
  const rpcUrl = readSolanaRpcUrlFromEnv(env)
  const mint = readPusdMintFromEnv(env)
  const merchantWallet = env.PUSD_MERCHANT_WALLET?.trim()
  const checks: DashboardSystemHealthCheck[] = []

  checks.push({
    checkId: 'pusd.rpc_url',
    status: isValidUrl(rpcUrl) ? 'passed' : 'failed',
    summary: isValidUrl(rpcUrl)
      ? 'Solana RPC URL is configured.'
      : 'Solana RPC URL is missing or invalid.',
    details: {
      rpcUrl,
    },
  })

  checks.push({
    checkId: 'pusd.mint',
    status: isValidPublicKey(mint) ? 'passed' : 'failed',
    summary: isValidPublicKey(mint)
      ? 'PUSD mint is a valid Solana public key.'
      : 'PUSD mint is not a valid Solana public key.',
    details: {
      mint,
    },
  })

  checks.push({
    checkId: 'pusd.default_recipient',
    status: merchantWallet
      ? isValidPublicKey(merchantWallet)
        ? 'passed'
        : 'failed'
      : 'warning',
    summary: merchantWallet
      ? isValidPublicKey(merchantWallet)
        ? 'Default PUSD recipient wallet is configured.'
        : 'Default PUSD recipient wallet is invalid.'
      : 'Default PUSD recipient wallet is not configured.',
    details: {
      configured: Boolean(merchantWallet),
    },
  })

  return checks
}

function buildRuntimeHealthChecks(
  context: DashboardRouteContext,
): DashboardSystemHealthCheck[] {
  return [
    {
      checkId: 'local_pusd_server',
      status: context.localServer ? 'passed' : 'warning',
      summary: context.localServer
        ? 'Local PUSD server is running for local-demo settlement.'
        : 'Local PUSD server is not running.',
      details: {
        localDemoBaseUrl: context.localDemoBaseUrl,
      },
    },
    {
      checkId: 'ows',
      status: context.owsClient ? 'passed' : 'warning',
      summary: context.owsClient
        ? 'OWS client is configured.'
        : 'OWS client is not configured.',
    },
    {
      checkId: 'xmtp',
      status: context.xmtpNotifier ? 'passed' : 'warning',
      summary: context.xmtpNotifier
        ? 'XMTP notifier is configured and initialized.'
        : 'XMTP notifier is not configured or failed initialization.',
    },
    {
      checkId: 'dashboard.auth',
      status:
        booleanEnv(context.env.PALMOS_PUBLIC_ACCESS_MODE) &&
        booleanEnv(context.env.PALMOS_DISABLE_DASHBOARD_AUTH)
          ? 'failed'
          : 'passed',
      summary:
        booleanEnv(context.env.PALMOS_PUBLIC_ACCESS_MODE) &&
        booleanEnv(context.env.PALMOS_DISABLE_DASHBOARD_AUTH)
          ? 'Dashboard auth is disabled while public access mode is enabled.'
          : 'Dashboard auth posture is acceptable for the current mode.',
      details: {
        publicAccessMode: booleanEnv(context.env.PALMOS_PUBLIC_ACCESS_MODE),
        dashboardAuthDisabled: booleanEnv(
          context.env.PALMOS_DISABLE_DASHBOARD_AUTH,
        ),
      },
    },
  ]
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function buildPostgresHealthChecks(
  context: DashboardRouteContext,
): Promise<DashboardSystemHealthCheck[]> {
  if (context.workspace.storageDriver !== 'postgres') {
    return []
  }

  const pool = context.workspace.postgresPool
  if (!pool) {
    return [
      {
        checkId: 'postgres.connection',
        status: 'failed',
        summary: 'Postgres storage is enabled but no pool is available.',
      },
    ]
  }

  try {
    await pool.query('select 1')
    const migrationResult = await pool.query<{ version: string }>(
      'select version from palmos_schema_migrations where version = $1 limit 1',
      [PALMOS_POSTGRES_MIGRATION_VERSION],
    )
    const migrationApplied = migrationResult.rows.some(
      (row) => row.version === PALMOS_POSTGRES_MIGRATION_VERSION,
    )

    return [
      {
        checkId: 'postgres.connection',
        status: migrationApplied ? 'passed' : 'failed',
        summary: migrationApplied
          ? 'Postgres connection and schema migration are healthy.'
          : 'Postgres is reachable but the expected schema migration is missing.',
        details: {
          migrationVersion: PALMOS_POSTGRES_MIGRATION_VERSION,
          migrationApplied,
        },
      },
    ]
  } catch (error) {
    return [
      {
        checkId: 'postgres.connection',
        status: 'failed',
        summary: 'Postgres connection or schema verification failed.',
        details: {
          error: errorMessage(error),
        },
      },
    ]
  }
}

type PostgresBackupStatusFile = {
  ok?: boolean
  createdAt?: string
  backupPath?: string
  retentionDays?: number
  error?: string
}

async function buildPostgresBackupHealthCheck(
  context: DashboardRouteContext,
  nowMs: number,
): Promise<DashboardSystemHealthCheck[]> {
  if (context.workspace.storageDriver !== 'postgres') {
    return []
  }

  const statusPath =
    context.env.PALMOS_POSTGRES_BACKUP_STATUS_PATH?.trim() ||
    join(context.baseDir, 'postgres-backup-status.json')
  const maxAgeHours = readPositiveNumber(
    context.env.PALMOS_POSTGRES_BACKUP_MAX_AGE_HOURS,
    36,
  )

  let status: PostgresBackupStatusFile
  try {
    status = JSON.parse(await readFile(statusPath, 'utf8'))
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return [
        {
          checkId: 'postgres.backup',
          status: 'warning',
          summary: 'Postgres backup status has not been reported yet.',
          details: {
            statusPath,
            maxAgeHours,
          },
        },
      ]
    }

    return [
      {
        checkId: 'postgres.backup',
        status: 'failed',
        summary: 'Postgres backup status could not be read.',
        details: {
          statusPath,
          error: errorMessage(error),
        },
      },
    ]
  }

  const createdAtMs = status.createdAt ? Date.parse(status.createdAt) : NaN
  if (!Number.isFinite(createdAtMs)) {
    return [
      {
        checkId: 'postgres.backup',
        status: 'failed',
        summary: 'Postgres backup status is missing a valid timestamp.',
        details: {
          statusPath,
          createdAt: status.createdAt,
        },
      },
    ]
  }

  const ageHours = Math.max(0, (nowMs - createdAtMs) / (60 * 60 * 1000))
  const isFresh = ageHours <= maxAgeHours
  const backupOk = status.ok !== false

  return [
    {
      checkId: 'postgres.backup',
      status: backupOk && isFresh ? 'passed' : 'failed',
      summary:
        backupOk && isFresh
          ? 'Postgres backup status is fresh.'
          : backupOk
            ? 'Postgres backup status is stale.'
            : 'Postgres backup job reported a failure.',
      details: {
        statusPath,
        createdAt: status.createdAt,
        ageHours: Math.round(ageHours * 100) / 100,
        maxAgeHours,
        backupPath: status.backupPath,
        retentionDays: status.retentionDays,
        error: status.error,
      },
    },
  ]
}

export async function buildDashboardSystemHealth(
  context: DashboardRouteContext,
  input: {
    now?: () => string
  } = {},
): Promise<DashboardSystemHealthReport> {
  const storageStatus = await buildDashboardStorageStatus(context)
  const now = input.now?.() ?? new Date().toISOString()
  const nowMs = Date.parse(now)
  const postgresChecks = await buildPostgresHealthChecks(context)
  const postgresBackupChecks = await buildPostgresBackupHealthCheck(
    context,
    Number.isFinite(nowMs) ? nowMs : Date.now(),
  )
  const checks: DashboardSystemHealthCheck[] = [
    {
      checkId: 'storage',
      status: storageStatus.ok ? 'passed' : 'failed',
      summary: storageStatus.ok
        ? `${storageStatus.storageEngine === 'postgres' ? 'Postgres' : 'File'} storage health checks passed.`
        : `${storageStatus.storageEngine === 'postgres' ? 'Postgres' : 'File'} storage health checks failed.`,
      details: {
        storageEngine: storageStatus.storageEngine,
        counts: storageStatus.counts,
        files: storageStatus.files,
      },
    },
    ...postgresChecks,
    ...postgresBackupChecks,
    ...buildPusdConfigHealthChecks(context.env),
    ...buildRuntimeHealthChecks(context),
  ]
  for (const check of checks) {
    if (check.status !== 'failed') {
      continue
    }
    if (check.checkId === 'postgres.connection') {
      context.operationalMetrics?.increment('dashboard.db_failures')
    }
    if (check.checkId === 'postgres.backup') {
      context.operationalMetrics?.increment('dashboard.backup_failures')
    }
  }

  return {
    ok: checks.every((check) => check.status !== 'failed'),
    generatedAt: now,
    checks,
  }
}
